import { describe, it, expect, vi } from "vitest";
import { GuidlioOrchestrator } from "../../src/orchestrator/GuidlioOrchestrator";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext } from "../../src/orchestrator/types";
import { ok } from "../../src/orchestrator/statusHelpers";
import { PIPELINE_STATUS } from "../../src/orchestrator/constants";
import { makeMockObserver } from "../fixtures/mockObserver";

type Ctx = BaseContext & { value?: number };

class OkStep extends PipelineStep<Ctx> {
	constructor(readonly name: string, private mutation?: (ctx: Ctx) => Ctx) {
		super();
	}
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		return ok({ ctx: this.mutation ? this.mutation(ctx) : ctx });
	}
}

describe("GuidlioOrchestrator — run happy path", () => {
	it("O-01: single-step pipeline returns ok status", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep("step1")],
		});
		const result = await orch.run({ traceId: "t1" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
	});

	it("O-02: three-step linear pipeline — all ok; final ctx accumulates changes", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [
				new OkStep("s1", (c) => ({ ...c, value: 1 })),
				new OkStep("s2", (c) => ({ ...c, value: (c.value ?? 0) + 1 })),
				new OkStep("s3", (c) => ({ ...c, value: (c.value ?? 0) + 1 })),
			],
		});
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
		if (result.status === "ok") {
			expect(result.ctx.value).toBe(3);
		}
	});

	it("O-03: initialCtx.traceId preserved on result ctx", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new OkStep("s")] });
		const result = await orch.run({ traceId: "my-trace" });
		expect(result.ctx.traceId).toBe("my-trace");
	});

	it("O-04: opts.traceId differs from ctx.traceId — opts wins", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new OkStep("s")] });
		const result = await orch.run({ traceId: "ctx-trace" }, { traceId: "opts-trace" });
		expect(result.ctx.traceId).toBe("opts-trace");
	});

	it("O-05: neither traceId provided — auto-generated UUID", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new OkStep("s")] });
		// BaseContext requires traceId but getTraceId auto-generates if empty
		const result = await orch.run({ traceId: "" });
		expect(result.ctx.traceId).toBeTruthy();
	});

	it("O-07: observer.onRunStart and onRunFinish called once each", async () => {
		const obs = makeMockObserver();
		const orch = new GuidlioOrchestrator<Ctx>({ steps: [new OkStep("s")], observer: obs });
		await orch.run({ traceId: "t" });
		expect(obs.onRunStart).toHaveBeenCalledOnce();
		expect(obs.onRunFinish).toHaveBeenCalledOnce();
	});

	it("O-08: observer.onStepStart/onStepFinish called once per executed step", async () => {
		const obs = makeMockObserver();
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep("s1"), new OkStep("s2"), new OkStep("s3")],
			observer: obs,
		});
		await orch.run({ traceId: "t" });
		expect(obs.onStepStart).toHaveBeenCalledTimes(3);
		expect(obs.onStepFinish).toHaveBeenCalledTimes(3);
	});

	it("O-09: observer.onTransition called for every transition", async () => {
		const obs = makeMockObserver();
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep("s1"), new OkStep("s2")],
			observer: obs,
		});
		await orch.run({ traceId: "t" });
		expect(obs.onTransition).toHaveBeenCalledTimes(2);
	});
});
