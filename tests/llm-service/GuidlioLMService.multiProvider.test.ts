import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GuidlioLMService } from "../../src/llm-service/GuidlioLMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { LLMTransientError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockLogger } from "../fixtures/mockLogger";
import { makePrompt } from "../fixtures/prompts";

describe("GuidlioLMService — Multi-provider scenarios", () => {
	let reg: PromptRegistry;
	let providerA: ReturnType<typeof makeMockProvider>;
	let providerB: ReturnType<typeof makeMockProvider>;
	let log: ReturnType<typeof makeMockLogger>;

	beforeEach(() => {
		reg = new PromptRegistry();
		providerA = makeMockProvider({ name: "providerA", supports: (m) => m.startsWith("model-a-") });
		providerB = makeMockProvider({ name: "providerB", supports: (m) => m.startsWith("model-b-") });
		log = makeMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function makeSvc(overrides: Partial<Parameters<typeof GuidlioLMService["prototype"]["constructor"]>[0]> = {}) {
		return new GuidlioLMService({ providers: [providerA, providerB], promptRegistry: reg, logger: log, ...overrides });
	}

	it("MP-01: model-a-v1 — providerA handles; providerB never called", async () => {
		reg.register(makePrompt({ promptId: "mp1", version: "1", modelDefaults: { model: "model-a-v1" } }));
		const svc = makeSvc();
		await svc.callText({ promptId: "mp1" });
		expect(providerA.call).toHaveBeenCalledOnce();
		expect(providerB.call).not.toHaveBeenCalled();
	});

	it("MP-02: model-b-v1 — providerB handles; providerA never called", async () => {
		reg.register(makePrompt({ promptId: "mp2", version: "1", modelDefaults: { model: "model-b-v1" } }));
		const svc = makeSvc();
		await svc.callText({ promptId: "mp2" });
		expect(providerB.call).toHaveBeenCalledOnce();
		expect(providerA.call).not.toHaveBeenCalled();
	});

	it("MP-03: defaultProvider:providerA with model-b-v1 — providerA used unconditionally", async () => {
		reg.register(makePrompt({ promptId: "mp3", version: "1", modelDefaults: { model: "model-b-v1" } }));
		const svc = makeSvc({ defaultProvider: "providerA" });
		await svc.callText({ promptId: "mp3" });
		expect(providerA.call).toHaveBeenCalledOnce();
		expect(providerB.call).not.toHaveBeenCalled();
	});

	it("MP-04: defaultProvider not found — auto-selects by supportsModel", async () => {
		reg.register(makePrompt({ promptId: "mp4", version: "1", modelDefaults: { model: "model-b-v1" } }));
		const svc = makeSvc({ defaultProvider: "does-not-exist" });
		await svc.callText({ promptId: "mp4" });
		expect(providerB.call).toHaveBeenCalledOnce();
		expect(log.warn).toHaveBeenCalled();
	});

	it("MP-05: both providers support same model prefix — first-registered (providerA) wins", async () => {
		const pA2 = makeMockProvider({ name: "providerA2", supports: (m) => m.startsWith("shared-") });
		const pB2 = makeMockProvider({ name: "providerB2", supports: (m) => m.startsWith("shared-") });
		reg.register(makePrompt({ promptId: "mp5", version: "1", modelDefaults: { model: "shared-v1" } }));
		const svc = new GuidlioLMService({ providers: [pA2, pB2], promptRegistry: reg });
		await svc.callText({ promptId: "mp5" });
		expect(pA2.call).toHaveBeenCalledOnce();
		expect(pB2.call).not.toHaveBeenCalled();
	});

	it("MP-06: model unsupported by both + strictProviderSelection:false — providerA used as fallback", async () => {
		reg.register(makePrompt({ promptId: "mp6", version: "1", modelDefaults: { model: "unknown-v1" } }));
		const svc = makeSvc({ strictProviderSelection: false });
		await svc.callText({ promptId: "mp6" });
		expect(providerA.call).toHaveBeenCalledOnce();
		expect(log.warn).toHaveBeenCalled();
	});

	it("MP-07: model unsupported by both + strictProviderSelection:true — throws listing providers", async () => {
		reg.register(makePrompt({ promptId: "mp7", version: "1", modelDefaults: { model: "unknown-v1" } }));
		const svc = makeSvc({ strictProviderSelection: true });
		await expect(svc.callText({ promptId: "mp7" })).rejects.toThrow(/No registered provider supports model/);
	});

	it("MP-08: providerA throws transient on first attempt — retried on same providerA, not switched to providerB", async () => {
		vi.useFakeTimers();
		let aAttempts = 0;
		const pA = makeMockProvider({
			name: "providerA",
			supports: (m) => m.startsWith("model-a-"),
			callImpl: async () => {
				aAttempts++;
				if (aAttempts < 2) throw new LLMTransientError("rate limit", "providerA", "model-a-v1");
				return { text: "ok", raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" };
			},
		});
		const pB = makeMockProvider({ name: "providerB", supports: (m) => m.startsWith("model-b-") });
		reg.register(makePrompt({ promptId: "mp8", version: "1", modelDefaults: { model: "model-a-v1" } }));
		const svc = new GuidlioLMService({ providers: [pA, pB], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		const p = svc.callText({ promptId: "mp8" });
		await vi.advanceTimersByTimeAsync(10_000);
		await p;
		expect(aAttempts).toBe(2);
		expect(pB.call).not.toHaveBeenCalled();
	});

	it("MP-09: embed with model-a-v1 routes to providerA; providerB never touched", async () => {
		const svc = makeSvc();
		await svc.embed({ text: "hello", model: "model-a-v1" });
		expect(providerA.embed).toHaveBeenCalledOnce();
		expect(providerB.embed).not.toHaveBeenCalled();
	});

	it("MP-10: callText then callJSON to different models — each selects own provider", async () => {
		reg.register(makePrompt({ promptId: "textP", version: "1", modelDefaults: { model: "model-a-v1" } }));
		reg.register(makePrompt({ promptId: "jsonP", version: "1", output: { type: "json" }, modelDefaults: { model: "model-b-v1" } }));
		providerB = makeMockProvider({
			name: "providerB",
			supports: (m) => m.startsWith("model-b-"),
			callImpl: async () => ({ text: '{"key":"val"}', raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" }),
		});
		const svc = new GuidlioLMService({ providers: [providerA, providerB], promptRegistry: reg });
		await svc.callText({ promptId: "textP" });
		await svc.callJSON({ promptId: "jsonP" });
		expect(providerA.call).toHaveBeenCalledOnce();
		expect(providerB.call).toHaveBeenCalledOnce();
	});

	it("MP-11: callStream model selection consistent with callText", async () => {
		reg.register(makePrompt({ promptId: "sp", version: "1", modelDefaults: { model: "model-a-v1" } }));
		const svc = makeSvc();
		await svc.callStream({ promptId: "sp" });
		expect(providerA.callStream).toHaveBeenCalledOnce();
		expect(providerB.callStream).not.toHaveBeenCalled();
	});
});
