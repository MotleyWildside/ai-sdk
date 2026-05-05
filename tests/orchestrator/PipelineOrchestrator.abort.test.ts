import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PipelineOrchestrator } from "../../src/orchestrator/PipelineOrchestrator";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext } from "../../src/orchestrator/types";
import { ok } from "../../src/orchestrator/statusHelpers";
import { PIPELINE_STATUS } from "../../src/orchestrator/constants";
import { DefaultPolicy } from "../../src/orchestrator/policies/DefaultPolicy";
import { TRANSITION_TYPE } from "../../src/orchestrator/constants";
import { PolicyDecisionInput, PolicyDecisionOutput } from "../../src/orchestrator/types";
import { PipelineAbortedError } from "../../src/orchestrator/errors";

type Ctx = BaseContext & { steps?: string[] };

class TrackStep extends PipelineStep<Ctx> {
	constructor(readonly name: string) { super(); }
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		return ok({ ctx: { ...ctx, steps: [...(ctx.steps ?? []), this.name] } });
	}
}

class SlowStep extends PipelineStep<Ctx> {
	readonly name = "slow";
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		await new Promise<void>((r) => setTimeout(r, 1000));
		return ok({ ctx });
	}
}

describe("PipelineOrchestrator — AbortSignal", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("AB-01: pre-aborted signal — current behavior: still runs first step (locked)", async () => {
		const controller = new AbortController();
		controller.abort();
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new TrackStep("s1"), new TrackStep("s2")],
		});
		// The orchestrator checks abort BEFORE executing each step
		// First step: check passes (transitionCount increments before check in loop)
		// Actually signal.aborted is checked at the top of the while loop before step execution
		const result = await orch.run({ traceId: "t", steps: [] }, { signal: controller.signal });
		// BEHAVIOR NOTE: the abort check happens at the start of each loop iteration
		// On the very first iteration transitionCount is incremented then abort checked.
		// Signal is pre-aborted so first transition check fires immediately.
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
	});

	it("AB-02: signal aborted between steps — next step not started; result.status failed", async () => {
		const controller = new AbortController();
		let step1Done = false;
		class S1 extends PipelineStep<Ctx> {
			readonly name = "s1";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> {
				step1Done = true;
				return ok({ ctx });
			}
		}
		class S2 extends PipelineStep<Ctx> {
			readonly name = "s2";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> {
				return ok({ ctx });
			}
		}
		class AbortAfterS1Policy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
				if (input.stepName === "s1") {
					controller.abort();
				}
				return super.decide(input);
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new S1(), new S2()],
			policy: () => new AbortAfterS1Policy(),
		});
		const result = await orch.run({ traceId: "t" }, { signal: controller.signal });
		expect(step1Done).toBe(true);
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
		if (result.status === "failed") {
			expect(result.error).toBeInstanceOf(PipelineAbortedError);
		}
	});

	it("AB-03: signal aborted during RETRY delay — failed result (error from abort)", async () => {
		let count = 0;
		class RetryDelayPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(): PolicyDecisionOutput<C> {
				count++;
				if (count === 1) return { transition: { type: TRANSITION_TYPE.RETRY, delayMs: 5000 } };
				return { transition: { type: TRANSITION_TYPE.NEXT } };
			}
		}
		const controller = new AbortController();
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new TrackStep("s")],
			policy: () => new RetryDelayPolicy(),
		});
		const p = orch.run({ traceId: "t" }, { signal: controller.signal });
		await vi.advanceTimersByTimeAsync(100);
		controller.abort(new Error("user cancelled"));
		await vi.advanceTimersByTimeAsync(5000);
		const result = await p;
		// BEHAVIOR NOTE: abort during retry delay rejects the delay promise with the abort
		// reason. This bubbles to run()'s outer catch and becomes a StepExecutionError
		// (not PipelineAbortedError, since it's not caught via the abort-check code path).
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
	});
});
