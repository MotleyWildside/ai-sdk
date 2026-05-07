import { z } from "zod";
import type { LLMProvider } from "./providers/types";
import type { CacheProvider, CacheConfig } from "./cache/types";
import { PromptRegistry } from "./prompts-registry/PromptRegistry";
import type { LLMLogger } from "../logger/types";
export type { LLMCallLogEntry } from "../logger/types";
import type { LLMMessage } from "./providers/types";

export type LLMAttachment = {
	type: "image_url";
	url: string;
	detail?: "auto" | "low" | "high";
};

/**
 * Parameters for text generation
 */
export interface LLMTextParams {
	promptId: string;
	promptVersion?: string | number;
	variables?: Record<string, unknown>;
	attachments?: LLMAttachment[];
	model?: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	seed?: number;
	idempotencyKey?: string;
	cache?: CacheConfig;
	traceId?: string;
	signal?: AbortSignal;
}

/**
 * Parameters for streaming generation. `cache` and `idempotencyKey` are
 * intentionally excluded — streams are not cached.
 */
export type LLMStreamParams = Omit<LLMTextParams, "cache" | "idempotencyKey">;

/**
 * Parameters for JSON generation
 */
export interface LLMJsonParams<T = unknown> extends LLMTextParams {
	jsonSchema?: z.ZodSchema<T>;
}

// ─── Raw (registry-free) call params ────────────────────────────────────────

interface LLMCallSharedParams {
	attachments?: LLMAttachment[];
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	seed?: number;
	idempotencyKey?: string;
	cache?: CacheConfig;
	traceId?: string;
	signal?: AbortSignal;
}

/**
 * Raw text call — caller supplies the full prompt, no registry lookup.
 * `model` is required because there is no prompt definition to fall back to.
 */
export interface LLMTextRawParams extends LLMCallSharedParams {
	systemPrompt?: string;
	userPrompt: string;
	model: string;
}

/**
 * Raw JSON call — same as `LLMTextRawParams` plus an optional Zod schema.
 */
export interface LLMJsonRawParams<T = unknown> extends LLMTextRawParams {
	jsonSchema?: z.ZodSchema<T>;
}

/**
 * Raw streaming call. `cache` and `idempotencyKey` are excluded — streams are not cached.
 */
export type LLMStreamRawParams = Omit<LLMTextRawParams, "cache" | "idempotencyKey">;

/** Either a registry-based or a raw text call */
export type LLMTextInput = LLMTextParams | LLMTextRawParams;

/** Either a registry-based or a raw JSON call */
export type LLMJsonInput<T = unknown> = LLMJsonParams<T> | LLMJsonRawParams<T>;

/** Either a registry-based or a raw streaming call */
export type LLMStreamInput = LLMStreamParams | LLMStreamRawParams;

/**
 * Parameters for embedding generation
 */
export interface LLMEmbedParams {
	text: string;
	model: string;
	dimensions?: number;
	taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
	traceId?: string;
	signal?: AbortSignal;
}

/**
 * Parameters for batch embedding generation
 */
export interface LLMEmbedBatchParams {
	texts: string[];
	model: string;
	dimensions?: number;
	taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
	traceId?: string;
	signal?: AbortSignal;
}

/**
 * Result from text generation
 */
export interface LLMTextResult {
	text: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	finishReason?: string;
	requestId?: string;
	traceId: string;
	promptId?: string;
	promptVersion?: string | number;
	model: string;
	durationMs: number;
}

/**
 * Result from streaming generation
 */
export interface LLMStreamResult {
	stream: AsyncIterable<{
		text: string;
		delta: string;
	}>;
	traceId: string;
	promptId?: string;
	promptVersion?: string | number;
	model: string;
}

/**
 * Result from JSON generation
 */
export interface LLMJsonResult<T = unknown> extends LLMTextResult {
	data: T;
}

/**
 * Result from embedding generation
 */
export interface LLMEmbedResult {
	embedding: number[];
	usage?: {
		totalTokens: number;
	};
	model: string;
}

type LLMImageSharedParams = {
	numberOfImages?: number;
	aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
	negativePrompt?: string;
	personGeneration?: "dont_allow" | "allow_adult" | "allow_all";
	outputMimeType?: "image/png" | "image/jpeg";
	/** Output resolution. Nano Banana supports "0.5K" (3.1 Flash only, maps to "512") | "1K" | "2K" | "4K"; Imagen supports "1K" | "2K". */
	imageSize?: "0.5K" | "1K" | "2K" | "4K";
	/** JPEG compression quality 0–100. Only applied when outputMimeType is "image/jpeg". */
	outputCompressionQuality?: number;
	/** Imagen only. Controls prompt adherence vs. creativity (higher = more literal). */
	guidanceScale?: number;
	/** Imagen only. Let the SDK rewrite the prompt for better quality. */
	enhancePrompt?: boolean;
	/** Imagen only. Fixed seed for reproducible results. */
	seed?: number;
	inputImages?: Array<{ data: string; mimeType: string }>;
	traceId?: string;
	signal?: AbortSignal;
};

/** Image generation from a raw prompt string */
export type LLMImageRawParams = LLMImageSharedParams & {
	prompt: string;
	model: string;
};

/** Image generation resolved through the prompt registry */
export type LLMImagePromptParams = LLMImageSharedParams & {
	promptId: string;
	promptVersion?: string | number;
	variables?: Record<string, unknown>;
	model?: string;
};

/** Parameters for image generation — either a raw prompt or a registry prompt */
export type LLMImageParams = LLMImageRawParams | LLMImagePromptParams;

/**
 * Result from image generation
 */
export interface LLMImageResult {
	images: Array<{ data: string; mimeType: string }>;
	text?: string;
	model: string;
	traceId: string;
	durationMs: number;
}

/**
 * Result from batch embedding generation
 */
export interface LLMEmbedBatchResult {
	embeddings: number[][];
	usage?: {
		totalTokens: number;
	};
	model: string;
}

/**
 * Normalized request shape passed to a provider
 */
export interface ProviderRequest {
	messages: LLMMessage[];
	model: string;
	temperature: number;
	maxTokens?: number;
	topP?: number;
	seed?: number;
	responseFormat: "text" | "json";
	signal?: AbortSignal;
}

/**
 * Resolved call context shared across callText / callJSON / callStream
 */
export interface ResolvedCall {
	prompt: NonNullable<ReturnType<PromptRegistry["getPrompt"]>>;
	model: string;
	provider: LLMProvider;
	cacheKey: string;
}

/**
 * Configuration for LMService
 */
export interface LMServiceConfig {
	/**
	 * List of available providers (required)
	 */
	providers: LLMProvider[];
	/**
	 * Default provider name to use. Wins over auto-selection by model prefix.
	 * If the name does not resolve to a registered provider, the service falls back
	 * to auto-selection and logs a warning.
	 */
	defaultProvider?: string;
	/**
	 * Final fallback model used when neither the call params nor the prompt
	 * definition specify one.
	 */
	defaultModel?: string;
	/**
	 * Final fallback temperature when neither call params nor the prompt's
	 * `modelDefaults` specify one. Default: 0.7 (a balanced setting for most
	 * chat use-cases). Set to `undefined` to let each provider apply its own
	 * default instead.
	 */
	defaultTemperature?: number;
	/**
	 * Maximum number of call attempts (1 = no retries, 3 = original + 2 retries).
	 * Only `LLMTransientError` triggers a retry. Defaults to 3.
	 */
	maxAttempts?: number;
	/**
	 * Base delay for exponential backoff in milliseconds. Defaults to 1000.
	 */
	retryBaseDelayMs?: number;
	/**
	 * Upper bound on a single retry delay including jitter (milliseconds).
	 * Defaults to 30000.
	 */
	maxDelayMs?: number;
	/**
	 * When true (the default), throws if no registered provider supports the model.
	 * Set to false to fall back silently to the first registered provider instead.
	 */
	strictProviderSelection?: boolean;
	/**
	 * Enable response caching globally. When `false`, all cache operations are
	 * no-ops regardless of per-call `cache` config. Default: `false`.
	 */
	enableCache?: boolean;
	/**
	 * Cache backend to use when `enableCache` is `true`. If omitted,
	 * `InMemoryCacheProvider` is used automatically.
	 */
	cacheProvider?: CacheProvider;
	/**
	 * Prompt registry instance. A new `PromptRegistry` is created automatically
	 * if not provided.
	 */
	promptRegistry?: PromptRegistry;
	/**
	 * Logger for internal service events. When omitted, no logging is emitted.
	 * Pass `new ConsoleLogger()` to enable the built-in console logger.
	 */
	logger?: LLMLogger;
}
