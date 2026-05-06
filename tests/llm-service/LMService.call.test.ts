import { describe, it, expect, vi, beforeEach } from "vitest";
import { LMService } from "../../src/llm-service/LMService";
import { LLMPermanentError } from "../../src/llm-service/errors";
import type { LMServiceConfig } from "../../src/llm-service/types";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockLogger } from "../fixtures/mockLogger";
import { makePrompt } from "../fixtures/prompts";

function makeService(
	overrides: LMServiceConfig = {
		providers: [makeMockProvider()],
	},
) {
	return new LMService(overrides);
}

describe("LMService — Constructor", () => {
	it("C-01: throws when providers array is empty", () => {
		expect(() => new LMService({ providers: [] })).toThrow("At least one provider");
	});

	it("C-02: two providers with the same name — second overwrites first in Map", () => {
		const p1 = makeMockProvider({ name: "dup" });
		const p2 = makeMockProvider({ name: "dup" });
		// Should not throw; second registration silently wins
		expect(() => new LMService({ providers: [p1, p2] })).not.toThrow();
	});

	it("C-03: no cacheProvider defaults to InMemoryCacheProvider (service still works)", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(makePrompt({ promptId: "p1", version: "1" }));
		const svc = new LMService({ providers: [provider], promptRegistry: reg });
		// Exercises the default cache path without throwing
		const result = await svc.callText({ promptId: "p1" });
		expect(result.text).toBe("mock response");
	});

	it("C-04: no promptRegistry defaults to fresh registry; prompts registered on it are usable", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		svc.promptRegistry.register(makePrompt({ promptId: "p-fresh", version: "1" }));
		const result = await svc.callText({ promptId: "p-fresh" });
		expect(result.text).toBe("mock response");
	});

	it("C-05: logger omitted — service functions without throwing on internal log attempts", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(makePrompt({ promptId: "p1", version: "1" }));
		const svc = new LMService({ providers: [provider], promptRegistry: reg });
		await expect(svc.callText({ promptId: "p1" })).resolves.toBeDefined();
	});

	it("C-06: defaultProvider referencing unregistered name still constructs (fallback at call-time)", () => {
		const gemini = makeMockProvider({ name: "gemini" });
		expect(() => new LMService({ providers: [gemini], defaultProvider: "openai" })).not.toThrow();
	});

	it("C-07: full config round-trips (promptRegistry getter returns the one supplied)", () => {
		const reg = new PromptRegistry();
		const svc = new LMService({ providers: [makeMockProvider()], promptRegistry: reg });
		expect(svc.promptRegistry).toBe(reg);
	});
});

describe("LMService — callText happy path", () => {
	let provider: ReturnType<typeof makeMockProvider>;
	let reg: PromptRegistry;
	let svc: LMService;

	beforeEach(() => {
		provider = makeMockProvider();
		reg = new PromptRegistry();
		svc = new LMService({ providers: [provider], promptRegistry: reg });
	});

	it("T-01: calls provider with built messages; result.text matches provider response", async () => {
		reg.register(makePrompt({ promptId: "p1", version: "1", userPrompt: "Say hi" }));
		const result = await svc.callText({ promptId: "p1" });
		expect(provider.call).toHaveBeenCalledOnce();
		expect(result.text).toBe("mock response");
	});

	it("T-02: prompt with systemPrompt + userPrompt produces 2-message array in order", async () => {
		reg.register(
			makePrompt({ promptId: "p2", version: "1", systemPrompt: "You are X", userPrompt: "Hello" }),
		);
		await svc.callText({ promptId: "p2" });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages).toHaveLength(2);
		expect(req.messages[0].role).toBe("system");
		expect(req.messages[1].role).toBe("user");
	});

	it("T-03: variable interpolation — string, number 0, boolean all rendered as String(v)", async () => {
		reg.register(makePrompt({ promptId: "p3", version: "1", userPrompt: "{a} {b} {c}" }));
		await svc.callText({ promptId: "p3", variables: { a: "hello", b: 0, c: false } });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe("hello 0 false");
	});

	it("T-04: variable interpolation — object rendered as JSON.stringify", async () => {
		reg.register(makePrompt({ promptId: "p4", version: "1", userPrompt: "{obj}" }));
		await svc.callText({ promptId: "p4", variables: { obj: { key: "val" } } });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe('{"key":"val"}');
	});

	it("T-05: missing variable leaves placeholder as literal", async () => {
		reg.register(makePrompt({ promptId: "p5", version: "1", userPrompt: "Hello {missing}" }));
		await svc.callText({ promptId: "p5", variables: {} });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe("Hello {missing}");
	});

	it("T-06: params.model overrides prompt.modelDefaults.model and config.defaultModel", async () => {
		reg.register(
			makePrompt({ promptId: "p6", version: "1", modelDefaults: { model: "prompt-model" } }),
		);
		const svcWithDefault = new LMService({
			providers: [provider],
			promptRegistry: reg,
			defaultModel: "config-model",
		});
		await svcWithDefault.callText({ promptId: "p6", model: "params-model" });
		const [req] = provider.call.mock.calls[0];
		expect(req.model).toBe("params-model");
	});

	it("T-07: prompt.modelDefaults.model used when params.model absent", async () => {
		reg.register(
			makePrompt({ promptId: "p7", version: "1", modelDefaults: { model: "prompt-model" } }),
		);
		const svcWithDefault = new LMService({
			providers: [provider],
			promptRegistry: reg,
			defaultModel: "config-model",
		});
		await svcWithDefault.callText({ promptId: "p7" });
		const [req] = provider.call.mock.calls[0];
		expect(req.model).toBe("prompt-model");
	});

	it("T-08: config.defaultModel used when neither params nor prompt specify a model", async () => {
		reg.register(makePrompt({ promptId: "p8", version: "1", modelDefaults: { model: "" } }));
		const svcWithDefault = new LMService({
			providers: [provider],
			promptRegistry: reg,
			defaultModel: "config-model",
		});
		await svcWithDefault.callText({ promptId: "p8" });
		const [req] = provider.call.mock.calls[0];
		expect(req.model).toBe("config-model");
	});

	it("T-09: throws when no model can be resolved", async () => {
		reg.register(makePrompt({ promptId: "p9", version: "1", modelDefaults: { model: "" } }));
		const svcNoModel = new LMService({ providers: [provider], promptRegistry: reg });
		await expect(svcNoModel.callText({ promptId: "p9" })).rejects.toThrow(/No model resolved/);
	});

	it("T-10a: params.temperature takes precedence over all", async () => {
		reg.register(
			makePrompt({
				promptId: "t10a",
				version: "1",
				modelDefaults: { model: "m", temperature: 0.5 },
			}),
		);
		const s = new LMService({
			providers: [provider],
			promptRegistry: reg,
			defaultTemperature: 0.3,
		});
		await s.callText({ promptId: "t10a", temperature: 0.9 });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.9);
	});

	it("T-10b: prompt.modelDefaults.temperature used when params absent", async () => {
		reg.register(
			makePrompt({
				promptId: "t10b",
				version: "1",
				modelDefaults: { model: "m", temperature: 0.5 },
			}),
		);
		const s = new LMService({
			providers: [provider],
			promptRegistry: reg,
			defaultTemperature: 0.3,
		});
		await s.callText({ promptId: "t10b" });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.5);
	});

	it("T-10c: config.defaultTemperature used when prompt has no temperature", async () => {
		reg.register(makePrompt({ promptId: "t10c", version: "1", modelDefaults: { model: "m" } }));
		const s = new LMService({
			providers: [provider],
			promptRegistry: reg,
			defaultTemperature: 0.3,
		});
		await s.callText({ promptId: "t10c" });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.3);
	});

	it("T-10d: falls back to 0.7 when no temperature set anywhere", async () => {
		reg.register(makePrompt({ promptId: "t10d", version: "1", modelDefaults: { model: "m" } }));
		await svc.callText({ promptId: "t10d" });
		const [req] = provider.call.mock.calls[0];
		expect(req.temperature).toBe(0.7);
	});

	it("T-11: maxTokens, topP, seed forwarded unchanged", async () => {
		reg.register(makePrompt({ promptId: "t11", version: "1" }));
		await svc.callText({ promptId: "t11", maxTokens: 100, topP: 0.9, seed: 42 });
		const [req] = provider.call.mock.calls[0];
		expect(req.maxTokens).toBe(100);
		expect(req.topP).toBe(0.9);
		expect(req.seed).toBe(42);
	});

	it("T-12: AbortSignal forwarded to provider", async () => {
		reg.register(makePrompt({ promptId: "t12", version: "1" }));
		const signal = new AbortController().signal;
		await svc.callText({ promptId: "t12", signal });
		const [req] = provider.call.mock.calls[0];
		expect(req.signal).toBe(signal);
	});

	it("T-13: traceId provided by caller is returned unchanged", async () => {
		reg.register(makePrompt({ promptId: "t13", version: "1" }));
		const result = await svc.callText({ promptId: "t13", traceId: "my-trace" });
		expect(result.traceId).toBe("my-trace");
	});

	it("T-14: auto-generated traceId matches expected format", async () => {
		reg.register(makePrompt({ promptId: "t14", version: "1" }));
		const result = await svc.callText({ promptId: "t14" });
		expect(result.traceId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("T-15: durationMs is a non-negative number", async () => {
		reg.register(makePrompt({ promptId: "t15", version: "1" }));
		const result = await svc.callText({ promptId: "t15" });
		expect(typeof result.durationMs).toBe("number");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("T-16: prompt not found throws an error", async () => {
		await expect(svc.callText({ promptId: "missing" })).rejects.toThrow(/Prompt not found/);
	});

	it("T-17: promptVersion specified picks that version, not latest", async () => {
		reg.register(makePrompt({ promptId: "t17", version: "1", userPrompt: "v1" }));
		reg.register(makePrompt({ promptId: "t17", version: "2", userPrompt: "v2" }));
		await svc.callText({ promptId: "t17", promptVersion: "1" });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe("v1");
	});

	it("T-18: promptVersion omitted picks latest", async () => {
		reg.register(makePrompt({ promptId: "t18", version: "1", userPrompt: "v1" }));
		reg.register(makePrompt({ promptId: "t18", version: "2", userPrompt: "v2" }));
		await svc.callText({ promptId: "t18" });
		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe("v2");
	});

	it("T-19: logger receives llmCall event with success:true, usage, cached:false(undef), promptId, model", async () => {
		const log = makeMockLogger();
		const p = makeMockProvider();
		const r = new PromptRegistry();
		r.register(makePrompt({ promptId: "t19", version: "1" }));
		const s = new LMService({ providers: [p], promptRegistry: r, logger: log });
		await s.callText({ promptId: "t19" });
		expect(log.llmCall).toHaveBeenCalledOnce();
		const entry = log.llmCall.mock.calls[0][0];
		expect(entry.success).toBe(true);
		expect(entry.promptId).toBe("t19");
		expect(entry.model).toBe("mock-model");
		expect(entry.usage).toBeDefined();
	});

	it("T-20: image attachments append to the final user message as multimodal parts", async () => {
		provider = makeMockProvider({ supportsAttachments: () => true });
		svc = new LMService({ providers: [provider], promptRegistry: reg });
		reg.register(
			makePrompt({
				promptId: "t20",
				version: "1",
				systemPrompt: "You are visual",
				userPrompt: "Describe this",
			}),
		);

		await svc.callText({
			promptId: "t20",
			attachments: [{ type: "image_url", url: "https://example.com/cat.png", detail: "high" }],
		});

		const [req] = provider.call.mock.calls[0];
		expect(req.messages[0].content).toBe("You are visual");
		expect(req.messages[1].content).toEqual([
			{ type: "text", text: "Describe this" },
			{
				type: "image_url",
				image_url: { url: "https://example.com/cat.png", detail: "high" },
			},
		]);
	});

	it("T-21: attachments require provider support", async () => {
		reg.register(makePrompt({ promptId: "t21", version: "1", userPrompt: "Describe this" }));

		await expect(
			svc.callText({
				promptId: "t21",
				attachments: [{ type: "image_url", url: "https://example.com/cat.png" }],
			}),
		).rejects.toThrow(LLMPermanentError);
		expect(provider.call).not.toHaveBeenCalled();
	});

	it("T-22: attachments require a user prompt message", async () => {
		provider = makeMockProvider({ supportsAttachments: () => true });
		svc = new LMService({ providers: [provider], promptRegistry: reg });
		reg.register(
			makePrompt({
				promptId: "t22",
				version: "1",
				systemPrompt: "Only system",
				userPrompt: "",
			}),
		);

		await expect(
			svc.callText({
				promptId: "t22",
				attachments: [{ type: "image_url", url: "https://example.com/cat.png" }],
			}),
		).rejects.toThrow(/Attachments require at least one user prompt message/);
	});
});
