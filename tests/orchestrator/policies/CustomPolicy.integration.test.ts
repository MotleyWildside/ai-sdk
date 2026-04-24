import { describe, it, expect } from "vitest";
import { GuidlioOrchestrator } from "../../../src/orchestrator/GuidlioOrchestrator";
import { DefaultPolicy } from "../../../src/orchestrator/policies/DefaultPolicy";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext, PolicyDecisionInput, PolicyDecisionOutput, StepOutcomeFailed, StepOutcomeOk } from "../../../src/orchestrator/types";
import { ok, failed } from "../../../src/orchestrator/statusHelpers";
import { TRANSITION_TYPE, PIPELINE_STATUS } from "../../../src/orchestrator/constants";
import { Transition } from "../../../src/orchestrator/types";

type Ctx = BaseContext;

class CircuitBreakerPolicy<C extends BaseContext> extends DefaultPolicy<C> {
	private consecutiveFailures = 0;

	protected override fail(outcome: StepOutcomeFailed, input: PolicyDecisionInput<C>): Transition {
		this.consecutiveFailures++;
		if (this.consecutiveFailures >= 3) {
			return { type: TRANSITION_TYPE.DEGRADE, reason: "circuit-open" };
		}
		// Retry instead of hard-fail so we accumulate consecutive failures
		return { type: TRANSITION_TYPE.RETRY, delayMs: 0 };
	}

	protected override ok(_outcome: StepOutcomeOk, _input: PolicyDecisionInput<C>): Transition {
		this.consecutiveFailures = 0;
		return { type: TRANSITION_TYPE.NEXT };
	}

	override reset(): void {
		this.consecutiveFailures = 0;
	}
}

class FailOnceStep extends PipelineStep<Ctx> {
	readonly name: string;
	private runCount = 0;
	constructor(name: string, private readonly failTimes: number) {
		super();
		this.name = name;
	}
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		this.runCount++;
		if (this.runCount <= this.failTimes) {
			return failed({ ctx, error: new Error("fail"), retryable: false });
		}
		return ok({ ctx });
	}
}

class AlwaysFailStep extends PipelineStep<Ctx> {
	constructor(readonly name: string) { super(); }
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		return failed({ ctx, error: new Error("always fail"), retryable: false });
	}
}

class OkStep extends PipelineStep<Ctx> {
	constructor(readonly name: string) { super(); }
	async run(ctx: Ctx): Promise<StepResult<Ctx>> { return ok({ ctx }); }
}

describe("CustomPolicy (CircuitBreakerPolicy) integration", () => {
	it("CPL-01: custom policy returns degrade after 3 failures", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new AlwaysFailStep("s")],
			policy: () => new CircuitBreakerPolicy(),
			maxTransitions: 20,
		});
		// After 3 failures, circuit opens with degrade
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
		if (result.status === "ok") {
			expect(result.degraded?.reason).toBe("circuit-open");
		}
	});

	it("CPL-02: ok resets failure counter; subsequent failures restart fresh count (not degrade)", async () => {
		const policy = new CircuitBreakerPolicy<Ctx>();
		const failOutcome = { type: "failed" as const, error: new Error("x"), retryable: false };
		const okOutcome = { type: "ok" as const };
		const makeInput = (outcome: StepOutcomeFailed | StepOutcomeOk): PolicyDecisionInput<Ctx> => ({
			stepName: "s",
			stepResult: { ctx: { traceId: "t" }, outcome },
			traceId: "t",
		});
		// Accumulate 2 failures (below degrade threshold of 3)
		policy.decide(makeInput(failOutcome));
		policy.decide(makeInput(failOutcome));
		// ok resets counter to 0
		policy.decide(makeInput(okOutcome));
		// Next fail is first of new sequence — should be RETRY (counter = 1, < 3)
		// not DEGRADE (counter would have been 3 without reset)
		const r = policy.decide(makeInput(failOutcome)) as { transition: { type: string } };
		expect(r.transition.type).toBe(TRANSITION_TYPE.RETRY);
		// After 2 more fails we reach 3 total → DEGRADE
		policy.decide(makeInput(failOutcome));
		const r3 = policy.decide(makeInput(failOutcome)) as { transition: { type: string } };
		expect(r3.transition.type).toBe(TRANSITION_TYPE.DEGRADE);
	});

	it("CPL-03: policy factory used — two sequential runs don't share state", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new AlwaysFailStep("s")],
			policy: () => new CircuitBreakerPolicy(),
			maxTransitions: 20,
		});
		// First run reaches degrade after 3 failures
		const r1 = await orch.run({ traceId: "t1" });
		expect(r1.status).toBe(PIPELINE_STATUS.OK);
		// Second run should also start fresh (factory creates new instance)
		const r2 = await orch.run({ traceId: "t2" });
		expect(r2.status).toBe(PIPELINE_STATUS.OK);
		if (r1.status === "ok" && r2.status === "ok") {
			expect(r1.degraded?.reason).toBe("circuit-open");
			expect(r2.degraded?.reason).toBe("circuit-open");
		}
	});

	it("CPL-05: custom policy returns contextAdjustment alongside transition", async () => {
		class AdjustPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
				return {
					transition: { type: TRANSITION_TYPE.NEXT },
					contextAdjustment: { type: "patch", patch: { extra: "injected" } as Partial<C> },
				};
			}
		}
		type AdjCtx = BaseContext & { extra?: string };
		const orch = new GuidlioOrchestrator<AdjCtx>({
			steps: [{
				name: "s",
				run: async (ctx) => ok({ ctx }),
			} as unknown as PipelineStep<AdjCtx>],
			policy: () => new AdjustPolicy<AdjCtx>(),
		});
		// Use a proper step class instead
		class S extends PipelineStep<AdjCtx> {
			readonly name = "s";
			async run(ctx: AdjCtx): Promise<StepResult<AdjCtx>> { return ok({ ctx }); }
		}
		const orch2 = new GuidlioOrchestrator<AdjCtx>({
			steps: [new S()],
			policy: () => new AdjustPolicy<AdjCtx>(),
		});
		const result = await orch2.run({ traceId: "t" });
		if (result.status === "ok") {
			expect(result.ctx.extra).toBe("injected");
		}
	});
});
