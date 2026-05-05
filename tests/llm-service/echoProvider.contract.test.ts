import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { z } from "zod";
import { LMService } from "../../src/llm-service/LMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { LLMParseError, LLMTransientError } from "../../src/llm-service/errors";
import { EchoProvider } from "../fixtures/echoProvider";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makePrompt, makeJsonPrompt } from "../fixtures/prompts";

describe("EchoProvider — contract tests", () => {
	let reg: PromptRegistry;
	let echo: EchoProvider;

	beforeEach(() => {
		reg = new PromptRegistry();
		echo = new EchoProvider();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("EC-01: callText with echo-1 model — end-to-end success; text = JSON(messages)", async () => {
		reg.register(makePrompt({ promptId: "ec1", version: "1", userPrompt: "Hi" }));
		const svc = new LMService({ providers: [echo], promptRegistry: reg });
		const result = await svc.callText({ promptId: "ec1", model: "echo-1" });
		const msgs = JSON.parse(result.text);
		expect(Array.isArray(msgs)).toBe(true);
		expect(msgs[0].role).toBe("user");
	});

	it("EC-02: callStream yields two chunks in order", async () => {
		reg.register(makePrompt({ promptId: "ec2", version: "1" }));
		const svc = new LMService({ providers: [echo], promptRegistry: reg });
		const { stream } = await svc.callStream({ promptId: "ec2", model: "echo-1" });
		const chunks: string[] = [];
		for await (const chunk of stream) {
			chunks.push(chunk.delta);
		}
		expect(chunks[0]).toBe("e");
		expect(chunks[1]).toBe("cho");
	});

	it("EC-03: embed respects dimensions", async () => {
		const svc = new LMService({ providers: [echo] });
		const result = await svc.embed({ text: "hi", model: "echo-v1", dimensions: 8 });
		expect(result.embedding).toHaveLength(8);
	});

	it("EC-04: embedBatch with 5 texts returns 5 embeddings", async () => {
		const svc = new LMService({ providers: [echo] });
		const result = await svc.embedBatch({ texts: ["a", "b", "c", "d", "e"], model: "echo-v1" });
		expect(result.embeddings).toHaveLength(5);
	});

	it("EC-05: callJSON — provider returns valid JSON string; .data is parsed", async () => {
		const customEcho = new EchoProvider();
		// Override call to return JSON string of a simple object
		vi.spyOn(customEcho, "call").mockResolvedValue({
			text: '{"name":"Alice"}',
			raw: {},
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});
		reg.register(makeJsonPrompt({ promptId: "ec5", version: "1", userPrompt: "?" }));
		const svc = new LMService({ providers: [customEcho], promptRegistry: reg });
		const result = await svc.callJSON({ promptId: "ec5", model: "echo-1" });
		expect((result.data as { name: string }).name).toBe("Alice");
	});

	it("EC-06: callJSON — provider returns garbage; LLMParseError surfaced", async () => {
		const customEcho = new EchoProvider();
		vi.spyOn(customEcho, "call").mockResolvedValue({
			text: "not json at all",
			raw: {},
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		});
		reg.register(makeJsonPrompt({ promptId: "ec6", version: "1" }));
		const svc = new LMService({ providers: [customEcho], promptRegistry: reg });
		await expect(svc.callJSON({ promptId: "ec6", model: "echo-1" })).rejects.toThrow(LLMParseError);
	});

	it("EC-07: provider throws LLMTransientError once then succeeds — 2 calls total", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const customEcho = new EchoProvider();
		vi.spyOn(customEcho, "call").mockImplementation(async () => {
			calls++;
			if (calls === 1) throw new LLMTransientError({ message: "rate limit", provider: "echo", model: "echo-1" });
			return { text: "ok", raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" };
		});
		reg.register(makePrompt({ promptId: "ec7", version: "1" }));
		const svc = new LMService({ providers: [customEcho], promptRegistry: reg, maxAttempts: 3, retryBaseDelayMs: 10 });
		const p = svc.callText({ promptId: "ec7", model: "echo-1" });
		await vi.advanceTimersByTimeAsync(10_000);
		await p;
		expect(calls).toBe(2);
	});

	it("EC-08: strictProviderSelection:true, model 'gpt-4o' (not echo-) — throws", async () => {
		reg.register(makePrompt({ promptId: "ec8", version: "1", modelDefaults: { model: "gpt-4o" } }));
		const svc = new LMService({ providers: [echo], promptRegistry: reg, strictProviderSelection: true });
		await expect(svc.callText({ promptId: "ec8" })).rejects.toThrow(/No registered provider/);
	});

	it("EC-09: EchoProvider + second MockProvider — routing by supportsModel", async () => {
		const mock = makeMockProvider({ name: "other", supports: (m) => m.startsWith("other-") });
		reg.register(makePrompt({ promptId: "ep1", version: "1", userPrompt: "Hi" }));
		reg.register(makePrompt({ promptId: "ep2", version: "1", modelDefaults: { model: "other-v1" }, userPrompt: "Hi" }));
		const svc = new LMService({ providers: [echo, mock], promptRegistry: reg });
		await svc.callText({ promptId: "ep1", model: "echo-1" });
		await svc.callText({ promptId: "ep2" });
		expect(mock.call).toHaveBeenCalledOnce();
	});
});
