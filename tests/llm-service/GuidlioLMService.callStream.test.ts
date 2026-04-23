import { describe, it, expect, beforeEach, vi } from "vitest";
import { GuidlioLMService } from "../../src/llm-service/GuidlioLMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { LLMTransientError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockLogger } from "../fixtures/mockLogger";
import { makePrompt } from "../fixtures/prompts";

describe("GuidlioLMService — callStream", () => {
	let reg: PromptRegistry;

	beforeEach(() => {
		reg = new PromptRegistry();
		reg.register(makePrompt({ promptId: "p1", version: "1" }));
	});

	function makeStreamService(chunks: Array<{ text: string; delta: string }>, log = makeMockLogger()) {
		const provider = makeMockProvider({
			streamImpl: async () => ({
				stream: (async function* () {
					for (const c of chunks) yield c;
				})(),
			}),
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, logger: log });
		return { svc, provider, log };
	}

	it("S-01: basic stream yields chunks in order with accumulated text and incremental delta", async () => {
		const chunks = [
			{ text: "he", delta: "he" },
			{ text: "hello", delta: "llo" },
		];
		const { svc } = makeStreamService(chunks);
		const result = await svc.callStream({ promptId: "p1" });
		const collected: Array<{ text: string; delta: string }> = [];
		for await (const chunk of result.stream) {
			collected.push(chunk);
		}
		expect(collected).toHaveLength(2);
		expect(collected[0].delta).toBe("he");
		expect(collected[1].delta).toBe("llo");
	});

	it("S-02: cache param provided — logger warns and provider is still called", async () => {
		const { svc, log, provider } = makeStreamService([{ text: "x", delta: "x" }]);
		await svc.callStream({ promptId: "p1", cache: { mode: "read_through", ttlSeconds: 60 } });
		expect(log.warn).toHaveBeenCalled();
		expect(provider.callStream).toHaveBeenCalledOnce();
	});

	it("S-03: idempotencyKey provided — logger warns", async () => {
		const { svc, log } = makeStreamService([{ text: "x", delta: "x" }]);
		await svc.callStream({ promptId: "p1", idempotencyKey: "key123" });
		expect(log.warn).toHaveBeenCalled();
	});

	it("S-04: provider throws LLMTransientError — propagates immediately without retry", async () => {
		const provider = makeMockProvider({
			streamImpl: async () => {
				throw new LLMTransientError("timeout", "mock", "mock-model");
			},
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3 });
		await expect(svc.callStream({ promptId: "p1" })).rejects.toBeInstanceOf(LLMTransientError);
		// callStream is invoked only once — no retry
		expect(provider.callStream).toHaveBeenCalledOnce();
	});

	it("S-06: result has traceId, promptId, promptVersion, model but no durationMs", async () => {
		const { svc } = makeStreamService([]);
		const result = await svc.callStream({ promptId: "p1" });
		expect(result.traceId).toBeDefined();
		expect(result.promptId).toBe("p1");
		expect(result.promptVersion).toBeDefined();
		expect(result.model).toBeDefined();
		// durationMs should not be present on LLMStreamResult
		expect((result as Record<string, unknown>).durationMs).toBeUndefined();
	});
});
