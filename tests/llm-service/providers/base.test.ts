import { describe, expect, it } from "vitest";
import {
	BaseLLMImageProvider,
	BaseLLMTextProvider,
	LLMPermanentError,
	LLMTransientError,
	type LLMProviderRequest,
	type ProviderPollOptions,
} from "../../../src";

class TestTextProvider extends BaseLLMTextProvider {
	readonly name = "test-text";
	protected readonly supportedModelPrefixes = ["test-", "OTHER/"];

	async call(_request: LLMProviderRequest) {
		return { text: "ok", raw: {} };
	}
}

class TestImageProvider extends BaseLLMImageProvider {
	readonly name = "test-image";
	protected readonly supportedModelPrefixes = ["image-"];

	async generateImage() {
		return { images: [{ data: "AA==", mimeType: "image/png" }], raw: {} };
	}

	exposeStripDataUrlPrefix(data: string): string {
		return this.stripDataUrlPrefix(data);
	}

	exposeOutputFormat(mimeType?: string): "png" | "jpeg" {
		return this.toOutputFormat(mimeType);
	}

	exposeMimeType(
		contentType: string | null,
		requestedMimeType?: "image/png" | "image/jpeg",
	): "image/png" | "image/jpeg" {
		return this.normalizeGeneratedImageMimeType(contentType, requestedMimeType);
	}

	exposeDimensions() {
		return this.aspectRatioToDimensions("16:9", "1K", {
			multipleOf: 16,
			minWidth: 64,
			minHeight: 64,
		});
	}

	exposeHttpError(status: number, payload: unknown) {
		return this.errorFromHttpResponse(status, payload, "image-model");
	}

	exposePollUntil<T>(options: ProviderPollOptions<T>) {
		return this.pollUntil(options);
	}

	exposeValidateImageRequest() {
		this.validateImageRequestAgainstCapabilities(
			{
				prompt: "cat",
				model: "image-model",
				numberOfImages: 2,
				aspectRatio: "16:9",
				outputMimeType: "image/jpeg",
				inputImages: [
					{ data: "AA==", mimeType: "image/png" },
					{ data: "BB==", mimeType: "image/png" },
				],
			},
			{
				maxInputImages: 1,
				supportedAspectRatios: ["1:1"],
				supportedOutputMimeTypes: ["image/png"],
			},
		);
	}
}

describe("provider base classes", () => {
	it("matches model prefixes case-insensitively", () => {
		const provider = new TestTextProvider();

		expect(provider.supportsModel("test-model")).toBe(true);
		expect(provider.supportsModel("other/model")).toBe(true);
		expect(provider.supportsModel("missing-model")).toBe(false);
	});

	it("defaults attachments to unsupported", () => {
		const provider = new TestTextProvider();

		expect(
			provider.supportsAttachments(
				[{ type: "image_url", url: "https://example.com/cat.png" }],
				"test-model",
			),
		).toBe(false);
	});

	it("image base uses model support as default image support", () => {
		const provider = new TestImageProvider();

		expect(provider.supportsImageGeneration("image-model")).toBe(true);
		expect(provider.supportsImageGeneration("text-model")).toBe(false);
	});

	it("normalizes common image request fields", () => {
		const provider = new TestImageProvider();

		expect(provider.exposeStripDataUrlPrefix("data:image/png;base64,AA==")).toBe("AA==");
		expect(provider.exposeOutputFormat("image/jpeg")).toBe("jpeg");
		expect(provider.exposeOutputFormat("image/png")).toBe("png");
		expect(provider.exposeMimeType("image/jpeg; charset=binary")).toBe("image/jpeg");
		expect(provider.exposeMimeType(null, "image/jpeg")).toBe("image/jpeg");
		expect(provider.exposeDimensions()).toEqual({ width: 1360, height: 768 });
	});

	it("maps HTTP status classes to SDK errors", () => {
		const provider = new TestImageProvider();

		expect(provider.exposeHttpError(429, { error: "slow down" })).toBeInstanceOf(LLMTransientError);
		expect(provider.exposeHttpError(500, { message: "down" })).toBeInstanceOf(LLMTransientError);
		expect(provider.exposeHttpError(400, { details: { field: "prompt" } })).toBeInstanceOf(
			LLMPermanentError,
		);
	});

	it("polls without sleeping after final attempt", async () => {
		const provider = new TestImageProvider();
		let attempts = 0;

		await expect(
			provider.exposePollUntil({
				fetchResult: async () => {
					attempts += 1;
					return { status: "pending" };
				},
				isSuccess: (result) => result.status === "ready",
				intervalMs: 0,
				maxAttempts: 2,
				model: "image-model",
			}),
		).rejects.toBeInstanceOf(LLMTransientError);
		expect(attempts).toBe(2);
	});

	it("validates common image request capabilities", () => {
		const provider = new TestImageProvider();

		expect(() => provider.exposeValidateImageRequest()).toThrow(/supports at most 1 input image/);
	});
});
