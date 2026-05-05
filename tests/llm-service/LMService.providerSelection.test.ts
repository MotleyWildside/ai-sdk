import { describe, it, expect, beforeEach } from "vitest";
import { LMService } from "../../src/llm-service/LMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockLogger } from "../fixtures/mockLogger";
import { makePrompt } from "../fixtures/prompts";

describe("LMService — Provider selection (single provider)", () => {
	let reg: PromptRegistry;

	beforeEach(() => {
		reg = new PromptRegistry();
		reg.register(makePrompt({ promptId: "p1", version: "1", modelDefaults: { model: "gpt-4o" } }));
	});

	it("PS-01: defaultProvider resolves — used even if supportsModel returns false", async () => {
		const pA = makeMockProvider({ name: "providerA", supports: () => false });
		const log = makeMockLogger();
		const svc = new LMService({ providers: [pA], promptRegistry: reg, defaultProvider: "providerA", logger: log });
		await svc.callText({ promptId: "p1" });
		expect(pA.call).toHaveBeenCalledOnce();
	});

	it("PS-02: defaultProvider name not found — logger warns; falls back to auto-select", async () => {
		const pA = makeMockProvider({ name: "providerA", supports: () => true });
		const log = makeMockLogger();
		const svc = new LMService({ providers: [pA], promptRegistry: reg, defaultProvider: "does-not-exist", logger: log });
		await svc.callText({ promptId: "p1" });
		expect(log.warn).toHaveBeenCalled();
		expect(pA.call).toHaveBeenCalledOnce();
	});

	it("PS-03: no defaultProvider — model 'gpt-4o', provider supports 'gpt-' prefix", async () => {
		const pA = makeMockProvider({ name: "openai", supports: (m) => m.startsWith("gpt-") });
		const svc = new LMService({ providers: [pA], promptRegistry: reg });
		await svc.callText({ promptId: "p1" });
		expect(pA.call).toHaveBeenCalledOnce();
	});

	it("PS-04: model supported by none + strictProviderSelection:true — throws", async () => {
		const pA = makeMockProvider({ name: "gemini", supports: () => false });
		const svc = new LMService({ providers: [pA], promptRegistry: reg, strictProviderSelection: true });
		await expect(svc.callText({ promptId: "p1" })).rejects.toThrow(/No registered provider supports model/);
	});

	it("PS-05: model supported by none + strictProviderSelection:false — warns; uses first provider", async () => {
		const pA = makeMockProvider({ name: "fallback", supports: () => false });
		const log = makeMockLogger();
		const svc = new LMService({ providers: [pA], promptRegistry: reg, strictProviderSelection: false, logger: log });
		await svc.callText({ promptId: "p1" });
		expect(log.warn).toHaveBeenCalled();
		expect(pA.call).toHaveBeenCalledOnce();
	});
});
