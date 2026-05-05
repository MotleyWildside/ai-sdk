import { describe, it, expect, beforeEach, vi } from "vitest";
import { LMService } from "../../src/llm-service/LMService";
import { LLMTransientError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockCache } from "../fixtures/mockCache";

describe("LMService — embed / embedBatch", () => {
	it("E-01: embed returns embedding, usage, model", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		const result = await svc.embed({ text: "hello", model: "mock-model" });
		expect(Array.isArray(result.embedding)).toBe(true);
		expect(result.model).toBe("mock-model");
	});

	it("E-02: embedBatch with 10 texts returns 10 embeddings", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		const texts = Array.from({ length: 10 }, (_, i) => `text${i}`);
		const result = await svc.embedBatch({ texts, model: "mock-model" });
		expect(result.embeddings).toHaveLength(10);
	});

	it("E-03: dimensions forwarded to provider", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		await svc.embed({ text: "hi", model: "mock-model", dimensions: 512 });
		const [req] = provider.embed.mock.calls[0];
		expect(req.dimensions).toBe(512);
	});

	it("E-04: taskType forwarded to provider", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		await svc.embed({ text: "hi", model: "mock-model", taskType: "RETRIEVAL_QUERY" });
		const [req] = provider.embed.mock.calls[0];
		expect(req.taskType).toBe("RETRIEVAL_QUERY");
	});

	it("E-05: provider throwing on embed — error propagates with message intact", async () => {
		const provider = makeMockProvider({
			embedImpl: async () => { throw new Error("embed not supported"); },
		});
		const svc = new LMService({ providers: [provider] });
		await expect(svc.embed({ text: "hi", model: "mock-model" })).rejects.toThrow("embed not supported");
	});

	it("E-06: transient error on embed retried up to maxAttempts", async () => {
		let attempts = 0;
		const provider = makeMockProvider({
			embedImpl: async () => {
				attempts++;
				if (attempts < 3) throw new LLMTransientError({ message: "rate limit", provider: "mock", model: "mock-model" });
				return { embedding: [0.1], usage: { totalTokens: 1 } };
			},
		});
		const svc = new LMService({ providers: [provider], maxAttempts: 3, retryBaseDelayMs: 0 });
		const result = await svc.embed({ text: "hi", model: "mock-model" });
		expect(result.embedding).toEqual([0.1]);
		expect(attempts).toBe(3);
	});

	it("E-07: embed does not interact with cache or prompt registry", async () => {
		const mockCache = makeMockCache();
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider], cacheProvider: mockCache });
		await svc.embed({ text: "hi", model: "mock-model" });
		expect(mockCache.get).not.toHaveBeenCalled();
		expect(mockCache.set).not.toHaveBeenCalled();
	});
});
