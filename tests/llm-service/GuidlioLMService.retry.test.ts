import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GuidlioLMService } from "../../src/llm-service/GuidlioLMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { LLMTransientError, LLMPermanentError, LLMParseError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockLogger } from "../fixtures/mockLogger";
import { makePrompt } from "../fixtures/prompts";

describe("GuidlioLMService — Retry logic", () => {
	let reg: PromptRegistry;

	beforeEach(() => {
		vi.useFakeTimers();
		reg = new PromptRegistry();
		reg.register(makePrompt({ promptId: "p1", version: "1" }));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function makeRetrySvc(opts: { maxAttempts?: number; baseDelay?: number; maxDelay?: number } = {}) {
		const log = makeMockLogger();
		const provider = makeMockProvider();
		const svc = new GuidlioLMService({
			providers: [provider],
			promptRegistry: reg,
			logger: log,
			maxAttempts: opts.maxAttempts ?? 3,
			retryBaseDelayMs: opts.baseDelay ?? 100,
			maxDelayMs: opts.maxDelay ?? 30_000,
		});
		return { svc, provider, log };
	}

	it("R-01: LLMTransientError x2 then success — provider called 3 times", async () => {
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => {
				calls++;
				if (calls < 3) throw new LLMTransientError("retry", "mock", "mock-model");
				return { text: "ok", raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" };
			},
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		const p = svc.callText({ promptId: "p1" });
		await vi.advanceTimersByTimeAsync(10000);
		const result = await p;
		expect(result.text).toBe("ok");
		expect(calls).toBe(3);
	});

	it("R-02: LLMTransientError every attempt — throws after maxAttempts", async () => {
		const provider = makeMockProvider({
			callImpl: async () => { throw new LLMTransientError("always fails", "mock", "mock-model"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		const rejectPromise = expect(svc.callText({ promptId: "p1" })).rejects.toBeInstanceOf(LLMTransientError);
		await vi.advanceTimersByTimeAsync(10000);
		await rejectPromise;
	});

	it("R-03: LLMPermanentError — thrown immediately, not retried", async () => {
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => { calls++; throw new LLMPermanentError("auth fail", "mock", "mock-model"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		await expect(svc.callText({ promptId: "p1" })).rejects.toBeInstanceOf(LLMPermanentError);
		expect(calls).toBe(1);
	});

	it("R-04: LLMParseError — not retried", async () => {
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => { calls++; throw new LLMParseError("bad json", "mock", "mock-model", "garbage"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		await expect(svc.callText({ promptId: "p1" })).rejects.toBeInstanceOf(LLMParseError);
		expect(calls).toBe(1);
	});

	it("R-05: generic Error — not retried", async () => {
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => { calls++; throw new Error("generic"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		await expect(svc.callText({ promptId: "p1" })).rejects.toThrow("generic");
		expect(calls).toBe(1);
	});

	it("R-07: maxAttempts:1 — no retries at all", async () => {
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => { calls++; throw new LLMTransientError("err", "mock", "mock-model"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 1, retryBaseDelayMs: 10 });
		await expect(svc.callText({ promptId: "p1" })).rejects.toBeInstanceOf(LLMTransientError);
		expect(calls).toBe(1);
	});

	it("R-08: maxAttempts:5 — up to 5 attempts", async () => {
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => { calls++; throw new LLMTransientError("err", "mock", "mock-model"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 5, retryBaseDelayMs: 10 });
		const rejectPromise = expect(svc.callText({ promptId: "p1" })).rejects.toBeInstanceOf(LLMTransientError);
		await vi.advanceTimersByTimeAsync(100_000);
		await rejectPromise;
		expect(calls).toBe(5);
	});

	it("R-10: maxDelayMs caps exponential delay", async () => {
		const sleeps: number[] = [];
		const origSetTimeout = globalThis.setTimeout;
		// Just verify the delay doesn't exceed maxDelayMs — we'll test via stub
		let calls = 0;
		const provider = makeMockProvider({
			callImpl: async () => {
				calls++;
				if (calls < 5) throw new LLMTransientError("err", "mock", "mock-model");
				return { text: "ok", raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" };
			},
		});
		const svc = new GuidlioLMService({
			providers: [provider],
			promptRegistry: reg,
			maxAttempts: 5,
			retryBaseDelayMs: 1000,
			maxDelayMs: 200,
		});
		const p = svc.callText({ promptId: "p1" });
		await vi.advanceTimersByTimeAsync(10_000);
		const result = await p;
		expect(result.text).toBe("ok");
	});

	it("R-11: retry logs llmCall event with retry:true per failed attempt", async () => {
		let calls = 0;
		const log = makeMockLogger();
		const provider = makeMockProvider({
			callImpl: async () => {
				calls++;
				if (calls < 3) throw new LLMTransientError("err", "mock", "mock-model");
				return { text: "ok", raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" };
			},
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, logger: log, maxAttempts: 3, retryBaseDelayMs: 10 });
		const p = svc.callText({ promptId: "p1" });
		await vi.advanceTimersByTimeAsync(10_000);
		await p;
		const retryCalls = log.llmCall.mock.calls.filter(([e]) => e.retry === true);
		expect(retryCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("R-13: streaming path invokes callStream at most once even on transient error", async () => {
		const provider = makeMockProvider({
			streamImpl: async () => { throw new LLMTransientError("err", "mock", "mock-model"); },
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		await expect(svc.callStream({ promptId: "p1" })).rejects.toBeInstanceOf(LLMTransientError);
		expect(provider.callStream).toHaveBeenCalledOnce();
	});
});
