import { describe, it, expect, vi } from "vitest";
import { PipelineOrchestrator } from "../../src/orchestrator/PipelineOrchestrator";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext } from "../../src/orchestrator/types";
import { ok, failed } from "../../src/orchestrator/statusHelpers";
import { NoopPipelineObserver } from "../../src/orchestrator/observers/NoopPipelineObserver";
import { makeMockObserver } from "../fixtures/mockObserver";

type Ctx = BaseContext;

class OkStep extends PipelineStep<Ctx> {
	constructor(readonly name: string) { super(); }
	async run(ctx: Ctx): Promise<StepResult<Ctx>> { return ok({ ctx }); }
}

class FailStep extends PipelineStep<Ctx> {
	readonly name = "fail";
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		return failed({ ctx, error: new Error("step failed"), retryable: false });
	}
}

class ThrowingObserver extends NoopPipelineObserver {
	override onStepStart(): void {
		throw new Error("observer error");
	}
}

describe("PipelineOrchestrator — Observer", () => {
	it("OB-02: NoopPipelineObserver used by default — run completes", async () => {
		const orch = new PipelineOrchestrator<Ctx>({ steps: [new OkStep("s")] });
		await expect(orch.run({ traceId: "t" })).resolves.toBeDefined();
	});

	it("OB-03: observer throws in onStepStart — becomes failed result (caught by run's try/catch)", async () => {
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new OkStep("s")],
			observer: new ThrowingObserver(),
		});
		// BEHAVIOR NOTE: observer errors thrown inside executeStep bubble up to run()'s
		// outer try/catch and become a StepExecutionError result, not an uncaught exception.
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe("failed");
	});

	it("OB-04: observer without onTransition does not crash", async () => {
		const obs = makeMockObserver();
		// Make onTransition undefined to simulate optional
		(obs as { onTransition?: unknown }).onTransition = undefined;
		const orch = new PipelineOrchestrator<Ctx>({ steps: [new OkStep("s")], observer: obs });
		await expect(orch.run({ traceId: "t" })).resolves.toBeDefined();
	});

	it("OB-05: onError fires exactly once on failed run", async () => {
		const obs = makeMockObserver();
		const orch = new PipelineOrchestrator<Ctx>({ steps: [new FailStep()], observer: obs });
		await orch.run({ traceId: "t" });
		expect(obs.onError).toHaveBeenCalledOnce();
	});

	it("OB-06: onStepFinish durationMs is non-negative", async () => {
		const obs = makeMockObserver();
		const orch = new PipelineOrchestrator<Ctx>({ steps: [new OkStep("s")], observer: obs });
		await orch.run({ traceId: "t" });
		const [args] = obs.onStepFinish.mock.calls[0];
		expect(typeof args.durationMs).toBe("number");
		expect(args.durationMs).toBeGreaterThanOrEqual(0);
	});
});
