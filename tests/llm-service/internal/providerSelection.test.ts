import { describe, it, expect, vi } from "vitest";
import {
	assertProviderCapability,
	isImageProvider,
	isTextProvider,
	selectProvider,
	selectProviderForOperation,
} from "../../../src/llm-service/internal/providerSelection";
import { makeMockProvider } from "../../fixtures/mockProvider";
import { makeMockLogger } from "../../fixtures/mockLogger";
import { LLMPermanentError } from "../../../src/llm-service/errors";
import type { LLMProvider } from "../../../src/llm-service/providers/types";

describe("selectProvider", () => {
	function makeMap(...providers: LLMProvider[]) {
		const m = new Map();
		for (const p of providers) m.set(p.name, p);
		return m;
	}

	it("returns defaultProvider if registered", () => {
		const pA = makeMockProvider({ name: "pA" });
		const map = makeMap(pA);
		const result = selectProvider(
			map,
			"any-model",
			{ providers: [pA], defaultProvider: "pA" },
			null,
		);
		expect(result.name).toBe("pA");
	});

	it("warns and falls back when defaultProvider not found", () => {
		const pA = makeMockProvider({ name: "pA", supports: () => true });
		const map = makeMap(pA);
		const log = makeMockLogger();
		const result = selectProvider(
			map,
			"any-model",
			{ providers: [pA], defaultProvider: "missing" },
			log,
		);
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

	it("throws by default when no provider matches (strictProviderSelection defaults to true)", () => {
		const pA = makeMockProvider({ name: "pA", supports: () => false });
		const map = makeMap(pA);
		expect(() => selectProvider(map, "unknown-model", { providers: [pA] }, null)).toThrow(
			/No registered provider supports model/,
		);
	});

	it("strictProviderSelection:false — warns and returns first provider as fallback", () => {
		const pA = makeMockProvider({ name: "pA", supports: () => false });
		const map = makeMap(pA);
		const log = makeMockLogger();
		const result = selectProvider(
			map,
			"unknown-model",
			{ providers: [pA], strictProviderSelection: false },
			log,
		);
		expect(log.warn).toHaveBeenCalled();
		expect(result.name).toBe("pA");
	});

	it("throws when no providers are available (empty map)", () => {
		const map = new Map();
		expect(() =>
			selectProvider(map, "any-model", { providers: [], strictProviderSelection: false }, null),
		).toThrow(/No LLM providers available/);
	});

	it("selectProviderForOperation rejects unsupported attachments before provider call", () => {
		const provider = makeMockProvider({ name: "visionless", supportsAttachments: () => false });
		const map = makeMap(provider);

		expect(() =>
			selectProviderForOperation(map, "mock-model", { providers: [provider] }, null, {
				operation: "text",
				promptId: "p1",
				attachments: [{ type: "image_url", url: "https://example.com/cat.png" }],
			}),
		).toThrow(LLMPermanentError);
	});

	it("selectProviderForOperation accepts attachments when the selected provider supports them", () => {
		const provider = makeMockProvider({ name: "vision", supportsAttachments: () => true });
		const map = makeMap(provider);

		const result = selectProviderForOperation(map, "mock-model", { providers: [provider] }, null, {
			operation: "stream",
			attachments: [{ type: "image_url", url: "https://example.com/cat.png" }],
		});

		expect(result.name).toBe("vision");
	});

	it("assertProviderCapability rejects image operations without a generateImage method", () => {
		const provider = makeMockProvider({ name: "text-only" });
		Reflect.deleteProperty(provider, "generateImage");

		expect(() => assertProviderCapability(provider, "mock-model", { operation: "image" })).toThrow(
			/does not support image generation/,
		);
	});

	it("assertProviderCapability rejects image operations when provider excludes the model", () => {
		const provider = makeMockProvider({
			name: "image-capable",
			supportsImageGeneration: (model) => model.startsWith("image-"),
		});

		expect(() => assertProviderCapability(provider, "text-model", { operation: "image" })).toThrow(
			/does not support image generation for model text-model/,
		);
	});

	it("selectProviderForOperation selects a text-only provider for text calls", async () => {
		const textOnly = {
			name: "text-only",
			supportsModel: (model: string) => model === "shared-model",
			call: vi.fn(async () => ({ text: "ok", raw: {} })),
		} satisfies LLMProvider;
		const imageOnly = {
			name: "image-only",
			supportsModel: (model: string) => model === "shared-model",
			generateImage: vi.fn(async () => ({
				images: [{ data: "AA==", mimeType: "image/png" }],
				raw: {},
			})),
		} satisfies LLMProvider;

		const result = selectProviderForOperation(
			makeMap(imageOnly, textOnly),
			"shared-model",
			{ providers: [imageOnly, textOnly] },
			null,
			{ operation: "text" },
		);

		expect(result.name).toBe("text-only");
		expect(isTextProvider(result)).toBe(true);
		expect(await result.call({ messages: [], model: "shared-model" })).toMatchObject({
			text: "ok",
		});
	});

	it("selectProviderForOperation selects an image-only provider for image calls", async () => {
		const textOnly = {
			name: "text-only",
			supportsModel: (model: string) => model === "shared-model",
			call: vi.fn(async () => ({ text: "ok", raw: {} })),
		} satisfies LLMProvider;
		const imageOnly = {
			name: "image-only",
			supportsModel: (model: string) => model === "shared-model",
			generateImage: vi.fn(async () => ({
				images: [{ data: "AA==", mimeType: "image/png" }],
				raw: {},
			})),
		} satisfies LLMProvider;

		const result = selectProviderForOperation(
			makeMap(textOnly, imageOnly),
			"shared-model",
			{ providers: [textOnly, imageOnly] },
			null,
			{ operation: "image" },
		);

		expect(result.name).toBe("image-only");
		expect(isImageProvider(result)).toBe(true);
		expect(await result.generateImage({ prompt: "cat", model: "shared-model" })).toMatchObject({
			images: [{ mimeType: "image/png" }],
		});
	});

	it("selectProviderForOperation rejects image-only providers for text calls", () => {
		const imageOnly = {
			name: "image-only",
			supportsModel: (model: string) => model === "image-model",
			generateImage: vi.fn(async () => ({
				images: [{ data: "AA==", mimeType: "image/png" }],
				raw: {},
			})),
		} satisfies LLMProvider;

		expect(() =>
			selectProviderForOperation(
				makeMap(imageOnly),
				"image-model",
				{ providers: [imageOnly] },
				null,
				{ operation: "text" },
			),
		).toThrow(/No registered provider supports text generation for model image-model/);
	});

	it("selectProviderForOperation names missing capability when model match lacks operation", () => {
		const textOnly = {
			name: "text-only",
			supportsModel: (model: string) => model === "shared-model",
			call: vi.fn(async () => ({ text: "ok", raw: {} })),
		} satisfies LLMProvider;

		expect(() =>
			selectProviderForOperation(
				makeMap(textOnly),
				"shared-model",
				{ providers: [textOnly] },
				null,
				{ operation: "image" },
			),
		).toThrow(/No registered provider supports image generation for model shared-model/);
	});

	it("selectProviderForOperation treats single and batch embeddings as one capability", () => {
		const singleOnly = {
			name: "single-only",
			supportsModel: (model: string) => model === "embed-model",
			embed: vi.fn(async () => ({ embedding: [0.1] })),
		} satisfies LLMProvider;

		expect(() =>
			selectProviderForOperation(
				makeMap(singleOnly),
				"embed-model",
				{ providers: [singleOnly] },
				null,
				{ operation: "embed" },
			),
		).toThrow(/No registered provider supports embeddings for model embed-model/);
	});
});
