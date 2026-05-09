import { LLMError, LLMPermanentError, LLMTransientError } from "../errors";
import {
	aspectRatioToDimensions as aspectRatioToImageDimensions,
	downloadGeneratedImage,
	imageSizeToTargetPixels,
	normalizeGeneratedImageMimeType,
	stripDataUrlPrefix,
	toOutputFormat,
	validateImageRequestAgainstCapabilities,
	type DimensionConstraints,
	type ImageDimensions,
	type ImageRequestCapabilities,
} from "./internal/imageNormalization";
import {
	errorFromHttpResponse,
	makePermanentProviderError,
	makeTransientProviderError,
	readJsonResponse,
	type ProviderErrorExtractor,
} from "./internal/providerErrors";
import { pollUntil, sleepWithAbort, type ProviderPollOptions } from "./internal/providerPolling";
import type {
	LLMGeneratedImage,
	LLMEmbeddingProvider,
	LLMImageProvider,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderImageRequest,
	LLMProviderImageResponse,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMStreamingProvider,
	LLMTextProvider,
	ProviderIdentity,
} from "./types";

export type ProviderImageUrlAttachment = {
	type: "image_url";
	url: string;
	detail?: "auto" | "low" | "high";
};

export type {
	DimensionConstraints,
	ImageDimensions,
	ImageRequestCapabilities,
	ProviderErrorExtractor,
	ProviderPollOptions,
};

export abstract class BaseLLMProvider implements ProviderIdentity {
	abstract readonly name: string;
	protected abstract readonly supportedModelPrefixes: readonly string[];

	supportsModel(model: string): boolean {
		return this.supportsModelPrefix(model);
	}

	supportsAttachments(_attachments: ProviderImageUrlAttachment[], _model: string): boolean {
		return false;
	}

	protected supportsImageUrlAttachments(
		attachments: ProviderImageUrlAttachment[],
		model: string,
	): boolean {
		return (
			this.supportsModel(model) &&
			attachments.every((attachment) => attachment.type === "image_url")
		);
	}

	protected supportsModelPrefix(model: string): boolean {
		const normalizedModel = model.toLowerCase();
		return this.supportedModelPrefixes.some((prefix) =>
			normalizedModel.startsWith(prefix.toLowerCase()),
		);
	}

	protected unsupportedOperation(operation: string, model: string): LLMPermanentError {
		return this.permanentError(`${this.name} provider does not support ${operation}.`, model);
	}

	protected transientError(
		message: string,
		model: string,
		statusCode?: number,
		cause?: Error,
	): LLMTransientError {
		return makeTransientProviderError({
			message,
			provider: this.name,
			model,
			statusCode,
			cause,
		});
	}

	protected permanentError(
		message: string,
		model: string,
		statusCode?: number,
		cause?: Error,
	): LLMPermanentError {
		return makePermanentProviderError({
			message,
			provider: this.name,
			model,
			statusCode,
			cause,
		});
	}

	protected unknownError(error: unknown, model: string, prefix?: string): LLMError {
		const message = error instanceof Error ? error.message : "Unknown error";
		return new LLMError({
			message: prefix ? `${prefix}: ${message}` : message,
			provider: this.name,
			model,
			cause: error instanceof Error ? error : new Error(String(error)),
		});
	}

	protected streamTextDeltas<T>(
		source: AsyncIterable<T>,
		getDelta: (part: T) => string,
		wrapError: (error: unknown) => Error,
	): LLMProviderStreamResponse["stream"] {
		return (async function* () {
			let fullText = "";
			try {
				for await (const part of source) {
					const delta = getDelta(part);
					fullText += delta;
					yield { text: fullText, delta };
				}
			} catch (error) {
				throw wrapError(error);
			}
		})();
	}

	protected async readJsonResponse<T>(response: Response, model: string): Promise<T> {
		return readJsonResponse<T>({ response, provider: this.name, model });
	}

	protected errorFromHttpResponse(
		status: number,
		payload: unknown,
		model: string,
		extractErrorMessage?: ProviderErrorExtractor,
	): LLMTransientError | LLMPermanentError {
		return errorFromHttpResponse({
			status,
			payload,
			model,
			provider: this.name,
			extractErrorMessage,
		});
	}

	protected async sleep(ms: number, signal?: AbortSignal): Promise<void> {
		await sleepWithAbort({ ms, provider: this.name, signal });
	}

	protected async pollUntil<T>(options: ProviderPollOptions<T>): Promise<T> {
		return pollUntil(this.name, options);
	}
}

export abstract class BaseLLMTextProvider extends BaseLLMProvider implements LLMTextProvider {
	abstract call(request: LLMProviderRequest): Promise<LLMProviderResponse>;
}

export abstract class BaseLLMStreamingProvider
	extends BaseLLMTextProvider
	implements LLMStreamingProvider
{
	abstract callStream(request: LLMProviderRequest): Promise<LLMProviderStreamResponse>;
}

export abstract class BaseLLMEmbeddingProvider
	extends BaseLLMProvider
	implements LLMEmbeddingProvider
{
	abstract embed(request: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse>;
	abstract embedBatch(
		request: LLMProviderEmbedBatchRequest,
	): Promise<LLMProviderEmbedBatchResponse>;
}

export abstract class BaseLLMImageProvider extends BaseLLMProvider implements LLMImageProvider {
	abstract generateImage(request: LLMProviderImageRequest): Promise<LLMProviderImageResponse>;

	supportsImageGeneration(model: string): boolean {
		return this.supportsModel(model);
	}

	protected stripDataUrlPrefix(data: string): string {
		return stripDataUrlPrefix(data);
	}

	protected toOutputFormat(outputMimeType?: string): "png" | "jpeg" {
		return toOutputFormat(outputMimeType);
	}

	protected normalizeGeneratedImageMimeType(
		contentType: string | null,
		requestedMimeType?: "image/png" | "image/jpeg",
	): "image/png" | "image/jpeg" {
		return normalizeGeneratedImageMimeType(contentType, requestedMimeType);
	}

	protected imageSizeToTargetPixels(imageSize?: LLMProviderImageRequest["imageSize"]): number {
		return imageSizeToTargetPixels(imageSize);
	}

	protected aspectRatioToDimensions(
		aspectRatio: LLMProviderImageRequest["aspectRatio"] | undefined,
		imageSize: LLMProviderImageRequest["imageSize"] | undefined,
		constraints: DimensionConstraints = {},
	): ImageDimensions | undefined {
		return aspectRatioToImageDimensions(aspectRatio, imageSize, constraints);
	}

	protected async downloadGeneratedImage(
		url: string,
		options: {
			model: string;
			requestedMimeType?: "image/png" | "image/jpeg";
			signal?: AbortSignal;
		},
	): Promise<LLMGeneratedImage> {
		return downloadGeneratedImage(url, { ...options, provider: this.name });
	}

	protected validateImageRequestAgainstCapabilities(
		request: LLMProviderImageRequest,
		capabilities: ImageRequestCapabilities,
	): void {
		validateImageRequestAgainstCapabilities({
			request,
			capabilities,
			provider: this.name,
		});
	}
}
