import { Buffer } from "buffer";
import { LLMProviderImageRequest, type LLMGeneratedImage } from "../types";
import { makePermanentProviderError, makeTransientProviderError } from "./providerErrors";

export type DimensionConstraints = {
	multipleOf?: number;
	minWidth?: number;
	maxWidth?: number;
	minHeight?: number;
	maxHeight?: number;
};

export type ImageDimensions = {
	width: number;
	height: number;
};

export type ImageRequestCapabilities = {
	maxInputImages?: number;
	supportedAspectRatios?: LLMProviderImageRequest["aspectRatio"][];
	supportedImageSizes?: LLMProviderImageRequest["imageSize"][];
	supportedOutputMimeTypes?: NonNullable<LLMProviderImageRequest["outputMimeType"]>[];
	supportsNegativePrompt?: boolean;
	supportsSeed?: boolean;
	supportsGuidanceScale?: boolean;
	supportsPromptEnhancement?: boolean;
	dimensionConstraints?: DimensionConstraints;
};

export function stripDataUrlPrefix(data: string): string {
	return data.startsWith("data:") ? (data.split(",")[1] ?? data) : data;
}

export function toOutputFormat(outputMimeType?: string): "png" | "jpeg" {
	return outputMimeType === "image/jpeg" ? "jpeg" : "png";
}

export function normalizeGeneratedImageMimeType(
	contentType: string | null,
	requestedMimeType?: "image/png" | "image/jpeg",
): "image/png" | "image/jpeg" {
	if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "image/jpeg";
	if (contentType?.includes("png")) return "image/png";
	return requestedMimeType === "image/jpeg" ? "image/jpeg" : "image/png";
}

export function imageSizeToTargetPixels(imageSize?: LLMProviderImageRequest["imageSize"]): number {
	if (imageSize === "0.5K") return 512 * 512;
	if (imageSize === "2K" || imageSize === "4K") return 2048 * 2048;
	return 1024 * 1024;
}

export function aspectRatioToDimensions(
	aspectRatio: LLMProviderImageRequest["aspectRatio"] | undefined,
	imageSize: LLMProviderImageRequest["imageSize"] | undefined,
	constraints: DimensionConstraints = {},
): ImageDimensions | undefined {
	if (!aspectRatio && !imageSize) return undefined;

	const [widthRatio, heightRatio] = (aspectRatio ?? "1:1").split(":").map(Number);
	if (!widthRatio || !heightRatio) return undefined;

	const targetPixels = imageSizeToTargetPixels(imageSize);
	const ratio = widthRatio / heightRatio;
	const rawWidth = Math.sqrt(targetPixels * ratio);
	const rawHeight = rawWidth / ratio;

	return {
		width: normalizeDimension(rawWidth, {
			multipleOf: constraints.multipleOf,
			min: constraints.minWidth,
			max: constraints.maxWidth,
		}),
		height: normalizeDimension(rawHeight, {
			multipleOf: constraints.multipleOf,
			min: constraints.minHeight,
			max: constraints.maxHeight,
		}),
	};
}

export async function downloadGeneratedImage(
	url: string,
	options: {
		provider: string;
		model: string;
		requestedMimeType?: "image/png" | "image/jpeg";
		signal?: AbortSignal;
	},
): Promise<LLMGeneratedImage> {
	const response = await fetch(url, { signal: options.signal });
	if (!response.ok) {
		throw makeTransientProviderError({
			message: `Failed to download ${options.provider} generated image: HTTP ${response.status}.`,
			provider: options.provider,
			model: options.model,
			statusCode: response.status,
		});
	}

	const arrayBuffer = await response.arrayBuffer();
	return {
		data: Buffer.from(arrayBuffer).toString("base64"),
		mimeType: normalizeGeneratedImageMimeType(
			response.headers.get("content-type"),
			options.requestedMimeType,
		),
	};
}

export function validateImageRequestAgainstCapabilities(options: {
	request: LLMProviderImageRequest;
	capabilities: ImageRequestCapabilities;
	provider: string;
}): void {
	const { request, capabilities, provider } = options;
	if (!request.prompt.trim()) {
		throw makePermanentProviderError({
			message: `${provider} image generation requires a non-empty prompt.`,
			provider,
			model: request.model,
		});
	}
	if (request.numberOfImages !== undefined && request.numberOfImages < 1) {
		throw makePermanentProviderError({
			message: `${provider} numberOfImages must be at least 1.`,
			provider,
			model: request.model,
		});
	}
	if (
		capabilities.maxInputImages !== undefined &&
		(request.inputImages?.length ?? 0) > capabilities.maxInputImages
	) {
		throw makePermanentProviderError({
			message: `${provider} model ${request.model} supports at most ${capabilities.maxInputImages} input image(s).`,
			provider,
			model: request.model,
		});
	}
	assertIncluded(
		provider,
		request.model,
		"aspectRatio",
		request.aspectRatio,
		capabilities.supportedAspectRatios,
	);
	assertIncluded(
		provider,
		request.model,
		"imageSize",
		request.imageSize,
		capabilities.supportedImageSizes,
	);
	assertIncluded(
		provider,
		request.model,
		"outputMimeType",
		request.outputMimeType,
		capabilities.supportedOutputMimeTypes,
	);
	assertFlag(
		provider,
		request.model,
		"negativePrompt",
		request.negativePrompt,
		capabilities.supportsNegativePrompt,
	);
	assertFlag(provider, request.model, "seed", request.seed, capabilities.supportsSeed);
	assertFlag(
		provider,
		request.model,
		"guidanceScale",
		request.guidanceScale,
		capabilities.supportsGuidanceScale,
	);
	assertFlag(
		provider,
		request.model,
		"enhancePrompt",
		request.enhancePrompt,
		capabilities.supportsPromptEnhancement,
	);
}

function normalizeDimension(
	value: number,
	options: { multipleOf?: number; min?: number; max?: number },
): number {
	const multipleOf = options.multipleOf ?? 1;
	let normalized = Math.round(value / multipleOf) * multipleOf;
	if (options.min !== undefined) normalized = Math.max(options.min, normalized);
	if (options.max !== undefined) normalized = Math.min(options.max, normalized);
	return normalized;
}

function assertIncluded<T>(
	provider: string,
	model: string,
	field: string,
	value: T | undefined,
	supportedValues: readonly T[] | undefined,
): void {
	if (value === undefined || supportedValues === undefined || supportedValues.includes(value))
		return;
	throw makePermanentProviderError({
		message: `${provider} model ${model} does not support ${field}=${String(value)}.`,
		provider,
		model,
	});
}

function assertFlag(
	provider: string,
	model: string,
	field: string,
	value: unknown,
	supported: boolean | undefined,
): void {
	if (value === undefined || supported !== false) return;
	throw makePermanentProviderError({
		message: `${provider} model ${model} does not support ${field}.`,
		provider,
		model,
	});
}
