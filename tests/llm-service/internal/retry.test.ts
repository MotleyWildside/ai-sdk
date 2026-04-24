import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { callWithRetries } from "../../../src/llm-service/internal/retry";
import { LLMTransientError, LLMPermanentError } from "../../../src/llm-service/errors";
import { makeMockLogger } from "../../fixtures/mockLogger";

const baseConfig = {
	providers: [] as never[],
	maxAttempts: 3,
	retryBaseDelayMs: 100,
	maxDelayMs: 30_000,
};

const baseCtx = { model: "m", providerName: "p" };

describe("callWithRetries", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns on first success", async () => {
		const fn = vi.fn(async () => "result");
		const p = callWithRetries(fn, baseConfig, null, baseCtx);
		await vi.advanceTimersByTimeAsync(0);
		expect(await p).toBe("result");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries on LLMTransientError, returns on eventual success", async () => {
		let calls = 0;
		const fn = vi.fn(async () => {
			calls++;
			if (calls < 3) throw new LLMTransientError({ message: "t", provider: "p", model: "m" });
			return "ok";
		});
		const p = callWithRetries(fn, baseConfig, null, baseCtx);
		await vi.advanceTimersByTimeAsync(100_000);
		expect(await p).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("throws LLMTransientError after maxAttempts exhausted", async () => {
		const fn = vi.fn(async () => { throw new LLMTransientError({ message: "err", provider: "p", model: "m" }); });
		const rejectPromise = expect(
			callWithRetries(fn, { ...baseConfig, maxAttempts: 2 }, null, baseCtx)
		).rejects.toBeInstanceOf(LLMTransientError);
		await vi.advanceTimersByTimeAsync(100_000);
		await rejectPromise;
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("does NOT retry on LLMPermanentError", async () => {
		const fn = vi.fn(async () => { throw new LLMPermanentError({ message: "perm", provider: "p", model: "m" }); });
		await expect(callWithRetries(fn, baseConfig, null, baseCtx)).rejects.toBeInstanceOf(LLMPermanentError);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("does NOT retry on generic Error", async () => {
		const fn = vi.fn(async () => { throw new Error("generic"); });
		await expect(callWithRetries(fn, baseConfig, null, baseCtx)).rejects.toThrow("generic");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("maxAttempts:1 — no retry, throws immediately", async () => {
		const fn = vi.fn(async () => { throw new LLMTransientError({ message: "t", provider: "p", model: "m" }); });
		await expect(callWithRetries(fn, { ...baseConfig, maxAttempts: 1 }, null, baseCtx)).rejects.toBeInstanceOf(LLMTransientError);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("maxDelayMs caps delay — test completes within bounded time", async () => {
		let calls = 0;
		const fn = vi.fn(async () => {
			calls++;
			if (calls < 3) throw new LLMTransientError({ message: "t", provider: "p", model: "m" });
			return "done";
		});
		const p = callWithRetries(fn, { ...baseConfig, retryBaseDelayMs: 10_000, maxDelayMs: 50, maxAttempts: 3 }, null, baseCtx);
		// With maxDelayMs:50 the total sleep should be <= 100ms, well under 1s
		await vi.advanceTimersByTimeAsync(200);
		expect(await p).toBe("done");
	});

	it("logs retry events via logger.llmCall with retry:true", async () => {
		let calls = 0;
		const log = makeMockLogger();
		const fn = vi.fn(async () => {
			calls++;
			if (calls < 3) throw new LLMTransientError({ message: "t", provider: "p", model: "m" });
			return "ok";
		});
		const p = callWithRetries(fn, baseConfig, log, baseCtx);
		await vi.advanceTimersByTimeAsync(100_000);
		await p;
		const retryCalls = log.llmCall.mock.calls.filter(([e]) => e.retry === true);
		expect(retryCalls.length).toBeGreaterThanOrEqual(1);
	});
});
