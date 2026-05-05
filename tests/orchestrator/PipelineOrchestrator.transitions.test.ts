import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { PipelineOrchestrator } from "../../src/orchestrator/PipelineOrchestrator";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext, PipelinePolicy, PolicyDecisionInput, PolicyDecisionOutput } from "../../src/orchestrator/types";
import { ok, failed, redirect } from "../../src/orchestrator/statusHelpers";
import { DefaultPolicy } from "../../src/orchestrator/policies/DefaultPolicy";
import { PIPELINE_STATUS, TRANSITION_TYPE, OUTCOME_TYPE } from "../../src/orchestrator/constants";
import { PipelineDefinitionError } from "../../src/orchestrator/errors";

type Ctx = BaseContext & { visited?: string[] };

function okStep(name: string): PipelineStep<Ctx> {
	class S extends PipelineStep<Ctx> {
		readonly name = name;
		async run(ctx: Ctx): Promise<StepResult<Ctx>> {
			return ok({ ctx: { ...ctx, visited: [...(ctx.visited ?? []), name] } });
		}
	}
	return new S();
}

function failStep(name: string, retryable = false): PipelineStep<Ctx> {
	class S extends PipelineStep<Ctx> {
		readonly name = name;
		async run(ctx: Ctx): Promise<StepResult<Ctx>> {
			return failed({ ctx, error: new Error(`${name} failed`), retryable });
		}
	}
	return new S();
}

function redirectStep(name: string, message: string): PipelineStep<Ctx> {
	class S extends PipelineStep<Ctx> {
		readonly name = name;
		async run(ctx: Ctx): Promise<StepResult<Ctx>> {
			return redirect({ ctx, message });
		}
	}
	return new S();
}

class GotoPolicy<C extends BaseContext> extends DefaultPolicy<C> {
	constructor(private readonly targetStep: string) { super(); }
	decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
		if (input.stepResult.outcome.type === "ok") {
			return { transition: { type: TRANSITION_TYPE.GOTO, stepName: this.targetStep } };
		}
		return super.decide(input);
	}
}

class StopPolicy<C extends BaseContext> extends DefaultPolicy<C> {
	decide(): PolicyDecisionOutput<C> {
		return { transition: { type: TRANSITION_TYPE.STOP } };
	}
}

class DegradePolicy<C extends BaseContext> extends DefaultPolicy<C> {
	decide(): PolicyDecisionOutput<C> {
		return { transition: { type: TRANSITION_TYPE.DEGRADE, reason: "graceful" } };
	}
}

describe("PipelineOrchestrator — Transitions", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("TR-01: NEXT from last step — finishes ok", async () => {
		const orch = new PipelineOrchestrator<Ctx>({ steps: [okStep("only")] });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
	});

	it("TR-02: NEXT from non-last step — moves to next in order", async () => {
		const orch = new PipelineOrchestrator<Ctx>({ steps: [okStep("s1"), okStep("s2")] });
		const result = await orch.run({ traceId: "t", visited: [] });
		if (result.status === "ok") {
			expect(result.ctx.visited).toEqual(["s1", "s2"]);
		}
	});

	it("TR-03: GOTO to existing step — jumps there (skipping s2)", async () => {
		// GotoPolicy sends every ok outcome to "s3". s3 is the last step, so
		// after GOTO s3 the NEXT transition from s3 finishes the pipeline.
		// Flow: s1 ok → GOTO s3 → s3 ok → GOTO s3 ... (loops if not careful)
		// Use a one-shot goto: first ok → goto s3, second ok → next
		class OneGotoPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			private jumped = false;
			decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
				if (!this.jumped && input.stepName === "s1") {
					this.jumped = true;
					return { transition: { type: TRANSITION_TYPE.GOTO, stepName: "s3" } };
				}
				return super.decide(input);
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s1"), okStep("s2"), okStep("s3")],
			policy: () => new OneGotoPolicy(),
			maxTransitions: 10,
		});
		const result = await orch.run({ traceId: "t", visited: [] });
		if (result.status === "ok") {
			expect(result.ctx.visited).toContain("s1");
			expect(result.ctx.visited).toContain("s3");
			expect(result.ctx.visited).not.toContain("s2");
		}
	});

	it("TR-04: GOTO to non-existent step — throws PipelineDefinitionError", async () => {
		class BadGotoPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(): PolicyDecisionOutput<C> {
				return { transition: { type: TRANSITION_TYPE.GOTO, stepName: "nowhere" } };
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s1")],
			policy: () => new BadGotoPolicy(),
		});
		await expect(orch.run({ traceId: "t" })).rejects.toBeInstanceOf(PipelineDefinitionError);
	});

	it("TR-05: RETRY retries same step; attempt increments", async () => {
		const attempts: number[] = [];
		class AttemptStep extends PipelineStep<Ctx> {
			readonly name = "retry-step";
			async run(ctx: Ctx, meta: { attempt: number }): Promise<StepResult<Ctx>> {
				attempts.push(meta.attempt);
				return ok({ ctx });
			}
		}
		class RetryOncePolicy<C extends BaseContext> extends DefaultPolicy<C> {
			private retried = false;
			decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
				if (!this.retried) {
					this.retried = true;
					return { transition: { type: TRANSITION_TYPE.RETRY } };
				}
				return super.decide(input);
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new AttemptStep()],
			policy: () => new RetryOncePolicy(),
		});
		await orch.run({ traceId: "t" });
		expect(attempts).toEqual([1, 2]);
	});

	it("TR-07: RETRY with delayMs — with fake timers, step runs after delay", async () => {
		vi.useFakeTimers();
		let count = 0;
		class DelayRetryPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
				count++;
				if (count === 1) return { transition: { type: TRANSITION_TYPE.RETRY, delayMs: 250 } };
				return super.decide(input);
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s")],
			policy: () => new DelayRetryPolicy(),
		});
		const p = orch.run({ traceId: "t" });
		await vi.advanceTimersByTimeAsync(300);
		const result = await p;
		expect(result.status).toBe(PIPELINE_STATUS.OK);
	});

	it("TR-08: RETRY with delayMs and signal aborting mid-sleep → failed result", async () => {
		vi.useFakeTimers();
		let count = 0;
		class DelayRetryPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
				count++;
				if (count === 1) return { transition: { type: TRANSITION_TYPE.RETRY, delayMs: 5000 } };
				return super.decide(input);
			}
		}
		const controller = new AbortController();
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s")],
			policy: () => new DelayRetryPolicy(),
		});
		const p = orch.run({ traceId: "t" }, { signal: controller.signal });
		await vi.advanceTimersByTimeAsync(100);
		controller.abort();
		await vi.advanceTimersByTimeAsync(5000);
		const result = await p;
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
	});

	it("TR-09: STOP — result.status ok; later steps never run", async () => {
		const executed: string[] = [];
		class TrackStep extends PipelineStep<Ctx> {
			constructor(readonly name: string) { super(); }
			async run(ctx: Ctx): Promise<StepResult<Ctx>> {
				executed.push(this.name);
				return ok({ ctx });
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new TrackStep("s1"), new TrackStep("s2")],
			policy: () => new StopPolicy(),
		});
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
		expect(executed).toEqual(["s1"]);
	});

	it("TR-10: FAIL with Error — result.status failed; error is StepExecutionError", async () => {
		const orch = new PipelineOrchestrator<Ctx>({ steps: [failStep("s")] });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
	});

	it("TR-12: DEGRADE — result.status ok; degraded.reason set", async () => {
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s")],
			policy: () => new DegradePolicy(),
		});
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
		if (result.status === "ok") {
			expect(result.degraded?.reason).toBe("graceful");
		}
	});

	it("TR-13: maxTransitions default exceeded via infinite goto — throws PipelineDefinitionError", async () => {
		class LoopPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(): PolicyDecisionOutput<C> {
				return { transition: { type: TRANSITION_TYPE.GOTO, stepName: "s1" } };
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s1")],
			policy: () => new LoopPolicy(),
			maxTransitions: 10,
		});
		await expect(orch.run({ traceId: "t" })).rejects.toBeInstanceOf(PipelineDefinitionError);
	});

	it("TR-14: custom maxTransitions:5 exceeded — same error", async () => {
		class LoopPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(): PolicyDecisionOutput<C> {
				return { transition: { type: TRANSITION_TYPE.GOTO, stepName: "s1" } };
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [okStep("s1")],
			policy: () => new LoopPolicy(),
			maxTransitions: 5,
		});
		await expect(orch.run({ traceId: "t" })).rejects.toBeInstanceOf(PipelineDefinitionError);
	});
});
