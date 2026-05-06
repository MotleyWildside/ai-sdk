import { describe, it, expect } from "vitest";
import { LMService } from "../../src/llm-service/LMService";
import { LLMPermanentError, LLMTransientError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makePrompt } from "../fixtures/prompts";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";

describe("LMService — generateImage", () => {
	it("IMG-01: returns images, model, traceId, durationMs", async () => {
		const provider = makeMockProvider({
			generateImageImpl: async () => ({
				images: [{ data: "abc123", mimeType: "image/png" }],
				raw: {},
			}),
		});
		const svc = new LMService({ providers: [provider] });
		const result = await svc.generateImage({ prompt: "a cat", model: "mock-model" });

		expect(result.images).toHaveLength(1);
		expect(result.images[0].data).toBe("abc123");
		expect(result.images[0].mimeType).toBe("image/png");
		expect(result.model).toBe("mock-model");
		expect(typeof result.traceId).toBe("string");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("IMG-02: all image params forwarded to provider", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });

		await svc.generateImage({
			prompt: "a dog",
			model: "mock-model",
			numberOfImages: 2,
			aspectRatio: "16:9",
			negativePrompt: "blurry",
			personGeneration: "dont_allow",
			outputMimeType: "image/jpeg",
		});

		const [req] = provider.generateImage.mock.calls[0];
		expect(req.prompt).toBe("a dog");
		expect(req.numberOfImages).toBe(2);
		expect(req.aspectRatio).toBe("16:9");
		expect(req.negativePrompt).toBe("blurry");
		expect(req.personGeneration).toBe("dont_allow");
		expect(req.outputMimeType).toBe("image/jpeg");
	});

	it("IMG-03: optional text in response is surfaced", async () => {
		const provider = makeMockProvider({
			generateImageImpl: async () => ({
				images: [{ data: "x", mimeType: "image/png" }],
				text: "Here is your image.",
				raw: {},
			}),
		});
		const svc = new LMService({ providers: [provider] });
		const result = await svc.generateImage({ prompt: "a bird", model: "mock-model" });
		expect(result.text).toBe("Here is your image.");
	});

	it("IMG-04: provided traceId is preserved", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		const result = await svc.generateImage({
			prompt: "a tree",
			model: "mock-model",
			traceId: "my-trace-123",
		});
		expect(result.traceId).toBe("my-trace-123");
	});

	it("IMG-05: throws LLMPermanentError when provider has no generateImage method", async () => {
		const provider = makeMockProvider();
		// Remove generateImage to simulate a provider that doesn't support it
		delete (provider as Record<string, unknown>)["generateImage"];
		const svc = new LMService({ providers: [provider] });
		await expect(svc.generateImage({ prompt: "a fish", model: "mock-model" })).rejects.toThrow(
			LLMPermanentError,
		);
	});

	it("IMG-06: transient error is retried up to maxAttempts", async () => {
		let attempts = 0;
		const provider = makeMockProvider({
			generateImageImpl: async () => {
				attempts++;
				if (attempts < 3)
					throw new LLMTransientError({
						message: "rate limit",
						provider: "mock",
						model: "mock-model",
					});
				return { images: [{ data: "ok", mimeType: "image/png" }], raw: {} };
			},
		});
		const svc = new LMService({ providers: [provider], maxAttempts: 3, retryBaseDelayMs: 0 });
		const result = await svc.generateImage({ prompt: "retry test", model: "mock-model" });
		expect(result.images[0].data).toBe("ok");
		expect(attempts).toBe(3);
	});

	it("IMG-07: permanent error is not retried", async () => {
		let attempts = 0;
		const provider = makeMockProvider({
			generateImageImpl: async () => {
				attempts++;
				throw new LLMPermanentError({
					message: "invalid model",
					provider: "mock",
					model: "mock-model",
				});
			},
		});
		const svc = new LMService({ providers: [provider], maxAttempts: 3, retryBaseDelayMs: 0 });
		await expect(
			svc.generateImage({ prompt: "perm error", model: "mock-model" }),
		).rejects.toThrow(LLMPermanentError);
		expect(attempts).toBe(1);
	});

	it("IMG-08: AbortSignal forwarded to provider", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		const controller = new AbortController();

		await svc.generateImage({
			prompt: "abort test",
			model: "mock-model",
			signal: controller.signal,
		});

		const [req] = provider.generateImage.mock.calls[0];
		expect(req.signal).toBe(controller.signal);
	});

	it("IMG-09: no provider supports model — throws", async () => {
		const provider = makeMockProvider({ supports: (m) => m.startsWith("specific-") });
		const svc = new LMService({ providers: [provider] });
		await expect(
			svc.generateImage({ prompt: "no provider", model: "unknown-model" }),
		).rejects.toThrow("No registered provider supports model");
	});
});

describe("LMService — generateImage (registry path)", () => {
	it("IMG-R-01: promptId resolves prompt and sends interpolated text to provider", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(
			makePrompt({
				promptId: "img.gen",
				version: "1",
				userPrompt: "A painting of {subject} in the style of {style}",
				modelDefaults: { model: "mock-model" },
			}),
		);
		const svc = new LMService({ providers: [provider], promptRegistry: reg });

		await svc.generateImage({
			promptId: "img.gen",
			variables: { subject: "a cat", style: "Monet" },
		});

		const [req] = provider.generateImage.mock.calls[0];
		expect(req.prompt).toBe("A painting of a cat in the style of Monet");
	});

	it("IMG-R-02: model from prompt.modelDefaults used when params.model omitted", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(
			makePrompt({
				promptId: "img.model",
				version: "1",
				userPrompt: "sunset",
				modelDefaults: { model: "imagen-4.0-generate-001" },
			}),
		);
		const svc = new LMService({ providers: [provider], promptRegistry: reg });

		const result = await svc.generateImage({ promptId: "img.model" });
		expect(result.model).toBe("imagen-4.0-generate-001");
	});

	it("IMG-R-03: params.model overrides prompt.modelDefaults.model", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(
			makePrompt({
				promptId: "img.override",
				version: "1",
				userPrompt: "landscape",
				modelDefaults: { model: "default-model" },
			}),
		);
		const svc = new LMService({ providers: [provider], promptRegistry: reg });

		const result = await svc.generateImage({
			promptId: "img.override",
			model: "explicit-model",
		});
		expect(result.model).toBe("explicit-model");
	});

	it("IMG-R-04: systemPrompt and userPrompt are joined with double newline", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(
			makePrompt({
				promptId: "img.sys",
				version: "1",
				systemPrompt: "You are a visual artist.",
				userPrompt: "Draw a red apple",
				modelDefaults: { model: "mock-model" },
			}),
		);
		const svc = new LMService({ providers: [provider], promptRegistry: reg });

		await svc.generateImage({ promptId: "img.sys" });

		const [req] = provider.generateImage.mock.calls[0];
		expect(req.prompt).toBe("You are a visual artist.\n\nDraw a red apple");
	});

	it("IMG-R-05: unknown promptId throws with helpful message", async () => {
		const provider = makeMockProvider();
		const svc = new LMService({ providers: [provider] });
		await expect(
			svc.generateImage({ promptId: "does.not.exist" }),
		).rejects.toThrow("Prompt not found: does.not.exist@latest");
	});

	it("IMG-R-06: shared image params forwarded correctly from registry path", async () => {
		const provider = makeMockProvider();
		const reg = new PromptRegistry();
		reg.register(
			makePrompt({ promptId: "img.shared", version: "1", userPrompt: "landscape" }),
		);
		const svc = new LMService({ providers: [provider], promptRegistry: reg });

		await svc.generateImage({
			promptId: "img.shared",
			numberOfImages: 3,
			aspectRatio: "16:9",
			negativePrompt: "blurry",
			inputImages: [{ data: "abc", mimeType: "image/png" }],
		});

		const [req] = provider.generateImage.mock.calls[0];
		expect(req.numberOfImages).toBe(3);
		expect(req.aspectRatio).toBe("16:9");
		expect(req.negativePrompt).toBe("blurry");
		expect(req.inputImages).toEqual([{ data: "abc", mimeType: "image/png" }]);
	});
});
