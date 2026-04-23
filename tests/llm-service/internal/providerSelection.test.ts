import { describe, it, expect, vi } from "vitest";
import { selectProvider } from "../../../src/llm-service/internal/providerSelection";
import { makeMockProvider } from "../../fixtures/mockProvider";
import { makeMockLogger } from "../../fixtures/mockLogger";

describe("selectProvider", () => {
	function makeMap(...providers: ReturnType<typeof makeMockProvider>[]) {
		const m = new Map();
		for (const p of providers) m.set(p.name, p);
		return m;
	}

	it("returns defaultProvider if registered", () => {
		const pA = makeMockProvider({ name: "pA" });
		const map = makeMap(pA);
		const result = selectProvider(map, "any-model", { providers: [pA], defaultProvider: "pA" }, null);
		expect(result.name).toBe("pA");
	});

	it("warns and falls back when defaultProvider not found", () => {
		const pA = makeMockProvider({ name: "pA", supports: () => true });
		const map = makeMap(pA);
		const log = makeMockLogger();
		const result = selectProvider(map, "any-model", { providers: [pA], defaultProvider: "missing" }, log);
		expect(log.warn).toHaveBeenCalled();
		expect(result.name).toBe("pA");
	});

	it("selects first provider where supportsModel returns true", () => {
		const pA = makeMockProvider({ name: "pA", supports: (m) => m.startsWith("gpt-") });
		const pB = makeMockProvider({ name: "pB", supports: (m) => m.startsWith("gemini-") });
		const map = makeMap(pA, pB);
		const result = selectProvider(map, "gemini-pro", { providers: [pA, pB] }, null);
		expect(result.name).toBe("pB");
	});

	it("strictProviderSelection:true — throws when no provider matches", () => {
		const pA = makeMockProvider({ name: "pA", supports: () => false });
		const map = makeMap(pA);
		expect(() =>
			selectProvider(map, "unknown-model", { providers: [pA], strictProviderSelection: true }, null),
		).toThrow(/No registered provider supports model/);
	});

	it("strictProviderSelection:false — warns and returns first provider as fallback", () => {
		const pA = makeMockProvider({ name: "pA", supports: () => false });
		const map = makeMap(pA);
		const log = makeMockLogger();
		const result = selectProvider(map, "unknown-model", { providers: [pA] }, log);
		expect(log.warn).toHaveBeenCalled();
		expect(result.name).toBe("pA");
	});

	it("throws when no providers are available (empty map)", () => {
		const map = new Map();
		expect(() =>
			selectProvider(map, "any-model", { providers: [] }, null),
		).toThrow(/No LLM providers available/);
	});
});
