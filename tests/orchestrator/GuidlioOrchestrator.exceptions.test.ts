import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { GuidlioOrchestrator } from "../../src/orchestrator/GuidlioOrchestrator";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext } from "../../src/orchestrator/types";
import { ok, failed } from "../../src/orchestrator/statusHelpers";
import { RetryPolicy } from "../../src/orchestrator/policies/RetryPolicy";
import { PipelineDefinitionError, StepExecutionError } from "../../src/orchestrator/errors";
import { PIPELINE_STATUS } from "../../src/orchestrator/constants";
import { makeMockObserver } from "../fixtures/mockObserver";

type Ctx = BaseContext;

class ThrowingStep extends PipelineStep<Ctx> {
	readonly name = "thrower";
	async run(): Promise<StepResult<Ctx>> {
		throw new Error("bang");
	}
}

class RetryableFailStep extends PipelineStep<Ctx> {
	readonly name = "retry-step";
	private attempts = 0;
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		this.attempts++;
		return failed({ ctx, error: new Error("fail"), retryable: true });
	}
	getAttempts() { return this.attempts; }
}

class SlowStep extends PipelineStep<Ctx> {
	readonly name = "slow";
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		await new Promise((r) => setTimeout(r, 300));
		return ok({ ctx });
	}
}

describe("GuidlioOrchestrator — Exception handling", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("EX-01: step throws — converted to failed outcome with retryable:false", async () => {
		const obs = makeMockObserver();
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new ThrowingStep()], observer: obs });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
		expect(obs.onError).toHaveBeenCalled();
	});

	it("EX-02: thrown step with DefaultPolicy — result.status failed; error is StepExecutionError", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new ThrowingStep()] });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
		if (result.status === "failed") {
			expect(result.error).toBeInstanceOf(StepExecutionError);
		}
	});

	it("EX-03: step throws + RetryPolicy — NOT retried (retryable defaults to false on exception)", async () => {
		let calls = 0;
		class CountThrowStep extends PipelineStep<Ctx> {
			readonly name = "count-throw";
			async run(): Promise<never> { calls++; throw new Error("oops"); }
		}
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new CountThrowStep()],
			policy: () => new RetryPolicy({ maxAttempts: 3 }),
		});
		await orch.run({ traceId: "t" });
		expect(calls).toBe(1);
	});

	it("EX-04: explicit failed({ retryable:true }) with RetryPolicy — retried up to maxAttempts", async () => {
		const step = new RetryableFailStep();
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [step],
			policy: () => new RetryPolicy({ maxAttempts: 3, backoffMs: () => 0 }),
		});
		await orch.run({ traceId: "t" });
		expect(step.getAttempts()).toBe(3);
	});

	it("EX-05: step throws PipelineDefinitionError — caught by executeStep, becomes failed result (NOT re-thrown)", async () => {
		// BEHAVIOR NOTE: PipelineDefinitionError thrown inside a step is caught by executeStep
		// and converted to a failed outcome. Only PipelineDefinitionErrors thrown by the
		// orchestrator's own logic (e.g., GOTO to unknown step) propagate as uncaught.
		class BadStep extends PipelineStep<Ctx> {
			readonly name = "bad";
			async run(): Promise<never> {
				throw new PipelineDefinitionError("programmer error");
			}
		}
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new BadStep()] });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe("failed");
		if (result.status === "failed") {
			expect(result.error.message).toContain("programmer error");
		}
	});

	it("EX-06: stepTimeoutMs exceeded — converts to failed outcome", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new SlowStep()],
			stepTimeoutMs: 50,
		});
		const p = orch.run({ traceId: "t" });
		await vi.advanceTimersByTimeAsync(200);
		const result = await p;
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
	});

	it("EX-08: observer.onError called with the thrown error", async () => {
		const obs = makeMockObserver();
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new ThrowingStep()], observer: obs });
		await orch.run({ traceId: "t" });
		expect(obs.onError).toHaveBeenCalled();
		const [args] = obs.onError.mock.calls[0];
		expect(args.error).toBeInstanceOf(Error);
	});
});
