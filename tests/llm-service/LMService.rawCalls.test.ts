import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { LMService } from "../../src/llm-service/LMService";
import { LLMParseError, LLMPermanentError, LLMSchemaError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockLogger } from "../fixtures/mockLogger";

function makeService(callResponse = "mock response") {
	const provider = makeMockProvider({
		callImpl: async () => ({
			text: callResponse,
			raw: {},
			usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
			finishReason: "stop",
		}),
	});
	const svc = new LMService({ providers: [provider] });
	return { provider, svc };
}

// ─── callTextRaw ─────────────────────────────────────────────────────────────

describe("LMService — callTextRaw", () => {
	it("R-01: systemPrompt + userPrompt produce 2-message array with correct roles", async () => {
		const { provider, svc } = makeService();
		await svc.callTextRaw({ systemPrompt: "You are X", userPrompt: "Hello", model: "gpt-4o" });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages).toHaveLength(2);
		expect(req.messages[0]).toEqual({ role: "system", content: "You are X" });
		expect(req.messages[1]).toEqual({ role: "user", content: "Hello" });
	});

	it("R-02: omitting systemPrompt sends only the user message", async () => {
		const { provider, svc } = makeService();
		await svc.callTextRaw({ userPrompt: "Just a user", model: "gpt-4o" });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages).toHaveLength(1);
		expect(req.messages[0]).toEqual({ role: "user", content: "Just a user" });
	});

	it("R-03: model passed in params is forwarded to the provider", async () => {
		const { provider, svc } = makeService();
		await svc.callTextRaw({ userPrompt: "hi", model: "claude-opus-4" });
		const [req] = provider.call.mock.calls[0];
		expect(req.model).toBe("claude-opus-4");
	});

	it("R-04: params.temperature takes precedence over config.defaultTemperature", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider], defaultTemperature: 0.3 });
		await svc.callTextRaw({ userPrompt: "hi", model: "m", temperature: 0.9 });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.9);
	});

	it("R-05: config.defaultTemperature used when params.temperature absent", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider], defaultTemperature: 0.3 });
		await svc.callTextRaw({ userPrompt: "hi", model: "m" });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.3);
	});

	it("R-06: falls back to 0.7 when no temperature configured anywhere", async () => {
		const { provider, svc } = makeService();
		await svc.callTextRaw({ userPrompt: "hi", model: "m" });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.7);
	});

	it("R-07: maxTokens, topP, seed forwarded unchanged", async () => {
		const { provider, svc } = makeService();
		await svc.callTextRaw({ userPrompt: "hi", model: "m", maxTokens: 256, topP: 0.95, seed: 7 });
		const [req] = provider.call.mock.calls[0];
		expect(req.maxTokens).toBe(256);
		expect(req.topP).toBe(0.95);
		expect(req.seed).toBe(7);
	});

	it("R-08: AbortSignal forwarded to provider", async () => {
		const { provider, svc } = makeService();
		const signal = new AbortController().signal;
		await svc.callTextRaw({ userPrompt: "hi", model: "m", signal });
		const [req] = provider.call.mock.calls[0];
		expect(req.signal).toBe(signal);
	});

	it("R-09: caller-supplied traceId is returned in the result", async () => {
		const { svc } = makeService();
		const result = await svc.callTextRaw({ userPrompt: "hi", model: "m", traceId: "my-trace" });
		expect(result.traceId).toBe("my-trace");
	});

	it("R-10: result.text matches the provider response", async () => {
		const { svc } = makeService("hello from raw");
		const result = await svc.callTextRaw({ userPrompt: "hi", model: "m" });
		expect(result.text).toBe("hello from raw");
	});

	it("R-11: promptId and promptVersion are undefined in the result", async () => {
		const { svc } = makeService();
		const result = await svc.callTextRaw({ userPrompt: "hi", model: "m" });
		expect(result.promptId).toBeUndefined();
		expect(result.promptVersion).toBeUndefined();
	});

	it("R-12: durationMs is a non-negative number", async () => {
		const { svc } = makeService();
		const result = await svc.callTextRaw({ userPrompt: "hi", model: "m" });
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("R-13: attachments appended as multimodal parts to the user message", async () => {
		const provider = makeMockProvider({ supportsAttachments: () => true });
		const svc = new LMService({ providers: [provider] });
		await svc.callTextRaw({
			systemPrompt: "You are visual",
			userPrompt: "Describe this",
			model: "m",
			attachments: [{ type: "image_url", url: "https://example.com/img.png", detail: "high" }],
		});
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe("You are visual");
		expect(req.messages[1].content).toEqual([
			{ type: "text", text: "Describe this" },
			{ type: "image_url", image_url: { url: "https://example.com/img.png", detail: "high" } },
		]);
	});

	it("R-14: attachments require provider support — throws LLMPermanentError before calling provider", async () => {
		const { provider, svc } = makeService();
		await expect(
			svc.callTextRaw({
				userPrompt: "hi",
				model: "m",
				attachments: [{ type: "image_url", url: "https://example.com/img.png" }],
			}),
		).rejects.toThrow(LLMPermanentError);
		expect(provider.call).not.toHaveBeenCalled();
	});

	it("R-15: logger receives success event with model but without promptId", async () => {
		const log = makeMockLogger();
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider], logger: log });
		await svc.callTextRaw({ userPrompt: "hi", model: "my-model", traceId: "t1" });
		expect(log.llmCall).toHaveBeenCalledOnce();
		const entry = log.llmCall.mock.calls[0][0];
		expect(entry.success).toBe(true);
		expect(entry.model).toBe("my-model");
		expect(entry.traceId).toBe("t1");
		expect(entry.promptId).toBeUndefined();
	});
});

// ─── callJSONRaw ─────────────────────────────────────────────────────────────

describe("LMService — callJSONRaw", () => {
	function makeJsonService(callResponse: string) {
		const provider = makeMockProvider({
			callImpl: async () => ({
				text: callResponse,
				raw: {},
				usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
				finishReason: "stop",
			}),
		});
		const svc = new LMService({ providers: [provider] });
		return { provider, svc };
	}

	it("RJ-01: JSON instruction injected into system message", async () => {
		const { provider, svc } = makeJsonService('{"ok":true}');
		await svc.callJSONRaw({ systemPrompt: "You are a bot", userPrompt: "go", model: "m" });
		const [req] = provider.call.mock.calls[0];
		const sys = req.messages.find((m: { role: string }) => m.role === "system");
		expect(sys?.content).toContain("ONLY valid JSON");
	});

	it("RJ-02: JSON instruction inserted as new system message when systemPrompt omitted", async () => {
		const { provider, svc } = makeJsonService('{"ok":true}');
		await svc.callJSONRaw({ userPrompt: "give me json", model: "m" });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].role).toBe("system");
		expect(req.messages[0].content).toContain("ONLY valid JSON");
	});

	it("RJ-03: valid JSON parsed into result.data", async () => {
		const { svc } = makeJsonService('{"name":"Alice","score":42}');
		const result = await svc.callJSONRaw({ userPrompt: "go", model: "m" });
		expect(result.data).toEqual({ name: "Alice", score: 42 });
	});

	it("RJ-04: JSON wrapped in markdown fences is repaired and parsed", async () => {
		const { svc } = makeJsonService("```json\n{\"x\":1}\n```");
		const result = await svc.callJSONRaw({ userPrompt: "go", model: "m" });
		expect(result.data).toEqual({ x: 1 });
	});

	it("RJ-05: unparseable response throws LLMParseError with rawOutput", async () => {
		const { svc } = makeJsonService("not json at all!!!");
		await expect(svc.callJSONRaw({ userPrompt: "go", model: "m" })).rejects.toThrow(LLMParseError);
		try {
			await svc.callJSONRaw({ userPrompt: "go", model: "m" });
		} catch (e) {
			expect(e).toBeInstanceOf(LLMParseError);
			expect((e as LLMParseError).rawOutput).toBe("not json at all!!!");
		}
	});

	it("RJ-06: Zod schema validation passes — typed result returned", async () => {
		const { svc } = makeJsonService('{"name":"Bob"}');
		const schema = z.object({ name: z.string() });
		const result = await svc.callJSONRaw<{ name: string }>({ userPrompt: "go", model: "m", jsonSchema: schema });
		expect(result.data.name).toBe("Bob");
	});

	it("RJ-07: Zod schema mismatch throws LLMSchemaError", async () => {
		const { svc } = makeJsonService('{"name":123}');
		const schema = z.object({ name: z.string() });
		await expect(
			svc.callJSONRaw({ userPrompt: "go", model: "m", jsonSchema: schema }),
		).rejects.toThrow(LLMSchemaError);
	});

	it("RJ-08: no schema — returns parsed object without validation", async () => {
		const { svc } = makeJsonService('{"anything":true}');
		const result = await svc.callJSONRaw({ userPrompt: "go", model: "m" });
		expect(result.data).toEqual({ anything: true });
	});

	it("RJ-09: promptId and promptVersion are undefined in the result", async () => {
		const { svc } = makeJsonService('{"ok":true}');
		const result = await svc.callJSONRaw({ userPrompt: "go", model: "m" });
		expect(result.promptId).toBeUndefined();
		expect(result.promptVersion).toBeUndefined();
	});
});

// ─── callStreamRaw ────────────────────────────────────────────────────────────

describe("LMService — callStreamRaw", () => {
	function makeStreamService(chunks: Array<{ text: string; delta: string }>) {
		const provider = makeMockProvider({
			streamImpl: async () => ({
				stream: (async function* () {
					for (const c of chunks) yield c;
				})(),
			}),
		});
		const svc = new LMService({ providers: [provider] });
		return { provider, svc };
	}

	it("RS-01: yields chunks from the provider in order", async () => {
		const chunks = [
			{ text: "he", delta: "he" },
			{ text: "hello", delta: "llo" },
		];
		const { svc } = makeStreamService(chunks);
		const result = await svc.callStreamRaw({ userPrompt: "hi", model: "m" });
		const collected: Array<{ text: string; delta: string }> = [];
		for await (const chunk of result.stream) collected.push(chunk);
		expect(collected).toHaveLength(2);
		expect(collected[0].delta).toBe("he");
		expect(collected[1].delta).toBe("llo");
	});

	it("RS-02: caller-supplied traceId is returned in the result", async () => {
		const { svc } = makeStreamService([{ text: "x", delta: "x" }]);
		const result = await svc.callStreamRaw({ userPrompt: "hi", model: "m", traceId: "raw-trace" });
		expect(result.traceId).toBe("raw-trace");
	});

	it("RS-03: promptId and promptVersion are undefined in the result", async () => {
		const { svc } = makeStreamService([{ text: "x", delta: "x" }]);
		const result = await svc.callStreamRaw({ userPrompt: "hi", model: "m" });
		expect(result.promptId).toBeUndefined();
		expect(result.promptVersion).toBeUndefined();
	});

	it("RS-04: systemPrompt + userPrompt produce correct messages for the provider", async () => {
		const provider = makeMockProvider({
			streamImpl: async () => ({
				stream: (async function* () {
					yield { text: "x", delta: "x" };
				})(),
			}),
		});
		const svc = new LMService({ providers: [provider] });
		const result = await svc.callStreamRaw({
			systemPrompt: "Be concise",
			userPrompt: "Hello",
			model: "m",
		});
		for await (const _ of result.stream) { /* consume */ }
		const [req] = provider.callStream.mock.calls[0];
		expect(req.messages).toHaveLength(2);
		expect(req.messages[0]).toEqual({ role: "system", content: "Be concise" });
		expect(req.messages[1]).toEqual({ role: "user", content: "Hello" });
	});

	it("RS-05: provider stream error propagates out of the async iterator", async () => {
		const provider = makeMockProvider({
			streamImpl: async () => ({
				stream: (async function* () {
					yield { text: "ok", delta: "ok" };
					throw new Error("stream broke");
				})(),
			}),
		});
		const svc = new LMService({ providers: [provider] });
		const result = await svc.callStreamRaw({ userPrompt: "hi", model: "m" });
		await expect(async () => {
			for await (const _ of result.stream) { /* consume */ }
		}).rejects.toThrow("stream broke");
	});
});
