import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoggerPipelineObserver } from "../../../src/orchestrator/observers/LoggerPipelineObserver";
import { NoopPipelineObserver } from "../../../src/orchestrator/observers/NoopPipelineObserver";

// LoggerPipelineObserver calls the package-level `logger` singleton.
// We spy on its pipelineEvent method.
import { logger } from "../../../src/logger/logger";

describe("LoggerPipelineObserver", () => {
	let spy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		spy = vi.spyOn(logger, "pipelineEvent").mockImplementation(() => {});
	});

	it("LO-01: onRunStart calls pipelineEvent with event and traceId", () => {
		const obs = new LoggerPipelineObserver();
		obs.onRunStart({ traceId: "t" });
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ traceId: "t" }));
	});

	it("LO-01b: onStepStart calls pipelineEvent with stepName", () => {
		const obs = new LoggerPipelineObserver();
		obs.onStepStart({ traceId: "t", stepName: "myStep" });
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ stepName: "myStep" }));
	});

	it("LO-01c: onStepFinish includes outcome and durationMs", () => {
		const obs = new LoggerPipelineObserver();
		obs.onStepFinish({ traceId: "t", stepName: "s", outcome: { type: "ok" }, durationMs: 42 });
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 42, outcome: "ok" }));
	});

	it("LO-01d: onRunFinish includes outcome", () => {
		const obs = new LoggerPipelineObserver();
		obs.onRunFinish({ traceId: "t", outcome: "ok", durationMs: 100 });
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ outcome: "ok" }));
	});

	it("LO-01e: onError includes error object", () => {
		const obs = new LoggerPipelineObserver();
		const err = new Error("boom");
		obs.onError({ traceId: "t", error: err });
		expect(spy).toHaveBeenCalledWith(expect.objectContaining({ error: err }));
	});

	it("LO-02: onTransition event includes transition type human-readable", () => {
		const obs = new LoggerPipelineObserver();
		obs.onTransition({ traceId: "t", stepName: "s", transition: { type: "next" } });
		const [args] = spy.mock.calls[spy.mock.calls.length - 1];
		expect(args.event).toContain("next");
	});
});

describe("NoopPipelineObserver", () => {
	it("LO-03: all methods return undefined and do not throw", () => {
		const obs = new NoopPipelineObserver();
		expect(obs.onRunStart({ traceId: "t" })).toBeUndefined();
		expect(obs.onStepStart({ traceId: "t", stepName: "s" })).toBeUndefined();
		expect(obs.onStepFinish({ traceId: "t", stepName: "s", outcome: { type: "ok" }, durationMs: 0 })).toBeUndefined();
		expect(obs.onRunFinish({ traceId: "t", outcome: "ok", durationMs: 0 })).toBeUndefined();
		expect(obs.onError({ traceId: "t", error: new Error("e") })).toBeUndefined();
		expect(obs.onTransition?.({ traceId: "t", stepName: "s", transition: { type: "next" } })).toBeUndefined();
	});
});
