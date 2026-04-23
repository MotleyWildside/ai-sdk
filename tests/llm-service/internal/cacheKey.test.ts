import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildCacheKey } from "../../../src/llm-service/internal/cacheKey";
import { makePrompt } from "../../fixtures/prompts";

const baseParams = {
	promptId: "p1",
	variables: { x: 1 },
	model: "gpt-4o",
	temperature: 0.5,
	maxTokens: 100,
	topP: 0.9,
	seed: 42,
	idempotencyKey: "idem-123",
};

const basePrompt = { promptId: "p1", version: "1" };
const baseModel = "gpt-4o";

describe("buildCacheKey", () => {
	it("CK-01: same inputs produce same hash", () => {
		const k1 = buildCacheKey(baseParams, basePrompt, baseModel);
		const k2 = buildCacheKey(baseParams, basePrompt, baseModel);
		expect(k1).toBe(k2);
	});

	it("CK-02a: different promptId → different hash", () => {
		const k1 = buildCacheKey(baseParams, basePrompt, baseModel);
		const k2 = buildCacheKey(baseParams, { ...basePrompt, promptId: "p2" }, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02b: different version → different hash", () => {
		const k1 = buildCacheKey(baseParams, basePrompt, baseModel);
		const k2 = buildCacheKey(baseParams, { ...basePrompt, version: "2" }, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02c: different variables → different hash", () => {
		const k1 = buildCacheKey(baseParams, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, variables: { x: 2 } }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02d: different resolvedModel → different hash", () => {
		const k1 = buildCacheKey(baseParams, basePrompt, "gpt-4o");
		const k2 = buildCacheKey(baseParams, basePrompt, "gpt-3.5-turbo");
		expect(k1).not.toBe(k2);
	});

	it("CK-02e: different temperature → different hash", () => {
		const k1 = buildCacheKey({ ...baseParams, temperature: 0.5 }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, temperature: 0.6 }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02f: different maxTokens → different hash", () => {
		const k1 = buildCacheKey({ ...baseParams, maxTokens: 100 }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, maxTokens: 200 }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02g: different topP → different hash", () => {
		const k1 = buildCacheKey({ ...baseParams, topP: 0.9 }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, topP: 0.8 }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02h: different seed → different hash", () => {
		const k1 = buildCacheKey({ ...baseParams, seed: 42 }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, seed: 99 }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-02i: different idempotencyKey → different hash", () => {
		const k1 = buildCacheKey({ ...baseParams, idempotencyKey: "a" }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, idempotencyKey: "b" }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-03: temperature:0 vs undefined → different hashes", () => {
		const k1 = buildCacheKey({ ...baseParams, temperature: 0 }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, temperature: undefined }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});

	it("CK-05: identical Zod schemas with same shape produce same fingerprint segment", () => {
		const schema1 = z.object({ name: z.string() });
		const schema2 = z.object({ name: z.string() });
		const k1 = buildCacheKey({ ...baseParams, jsonSchema: schema1 }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams, jsonSchema: schema2 }, basePrompt, baseModel);
		expect(k1).toBe(k2);
	});

	it("CK-06: undefined jsonSchema → different from any schema present", () => {
		const schema = z.object({ x: z.number() });
		const k1 = buildCacheKey({ ...baseParams, jsonSchema: schema }, basePrompt, baseModel);
		const k2 = buildCacheKey({ ...baseParams }, basePrompt, baseModel);
		expect(k1).not.toBe(k2);
	});
});
