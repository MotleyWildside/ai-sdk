/**
 * Normalized request format for LLM providers
 */
export type LLMTextContentPart = {
	type: "text";
	text: string;
};

export type LLMImageUrlContentPart = {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "auto" | "low" | "high";
	};
};

export type LLMMessageContent = string | Array<LLMTextContentPart | LLMImageUrlContentPart>;

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: LLMMessageContent;
}

export interface LLMProviderRequest {
	messages: LLMMessage[];
	model: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	responseFormat?: "text" | "json";
	seed?: number;
	signal?: AbortSignal;
}

/**
 * Normalized response format from LLM providers
 */
export interface LLMProviderResponse {
	text: string;
	raw: unknown;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	finishReason?: string;
	requestId?: string;
}

/**
 * Normalized stream response format
 */
export interface LLMProviderStreamResponse {
	stream: AsyncIterable<{
		text: string;
		delta: string;
	}>;
	requestId?: string;
}

/**
 * Normalized embedding request
 */
export interface LLMProviderEmbedRequest {
	text: string;
	model: string;
	dimensions?: number;
	taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
	signal?: AbortSignal;
}

/**
 * Normalized batch embedding request
 */
export interface LLMProviderEmbedBatchRequest {
	texts: string[];
	model: string;
	dimensions?: number;
	taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
	signal?: AbortSignal;
}

/**
 * Normalized embedding response
 */
export interface LLMProviderEmbedResponse {
	embedding: number[];
	usage?: {
		totalTokens: number;
	};
}

/**
 * Normalized batch embedding response
 */
export interface LLMProviderEmbedBatchResponse {
	embeddings: number[][];
	usage?: {
		totalTokens: number;
	};
}

/**
 * Request for image generation
 */
export interface LLMProviderImageRequest {
	prompt: string;
	model: string;
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
	signal?: AbortSignal;
}

export interface LLMGeneratedImage {
	data: string;
	mimeType: string;
}

/**
 * Response from image generation
 */
export interface LLMProviderImageResponse {
	images: LLMGeneratedImage[];
	raw: unknown;
	text?: string;
}

export type ProviderCapability = "text" | "stream" | "embed" | "embedBatch" | "image";

/**
 * Shared provider identity and model matching.
 */
export interface ProviderIdentity {
	/**
	 * Provider identifier (e.g., 'openai', 'anthropic', 'google')
	 */
	readonly name: string;

	/**
	 * Check if this provider supports a given model
	 */
	supportsModel(model: string): boolean;

	/**
	 * Check whether this provider can accept multimodal attachments for a model.
	 * Providers that omit this method are treated as attachment-unsupported.
	 */
	supportsAttachments?(
		attachments: Array<{ type: "image_url"; url: string; detail?: "auto" | "low" | "high" }>,
		model: string,
	): boolean;
}

export interface LLMTextProvider extends ProviderIdentity {
	/**
	 * Call the provider with a normalized request. Text and JSON use the same
	 * capability; JSON is requested with `responseFormat: "json"`.
	 */
	call(request: LLMProviderRequest): Promise<LLMProviderResponse>;
}

export interface LLMStreamingProvider extends ProviderIdentity {
	/**
	 * Call the provider with a streaming response
	 */
	callStream(request: LLMProviderRequest): Promise<LLMProviderStreamResponse>;
}

export interface LLMEmbeddingProvider extends ProviderIdentity {
	/**
	 * Generate vector embedding for text
	 */
	embed(request: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse>;

	/**
	 * Generate vector embeddings for multiple texts
	 */
	embedBatch(request: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse>;
}

export interface LLMImageProvider extends ProviderIdentity {
	/**
	 * Generate images from a text prompt.
	 */
	generateImage(request: LLMProviderImageRequest): Promise<LLMProviderImageResponse>;

	/**
	 * Whether this provider can generate images for the given model.
	 */
	supportsImageGeneration?(model: string): boolean;
}

/**
 * Backward-compatible provider surface. Providers may implement only the
 * capabilities they support.
 */
export type LLMProvider = ProviderIdentity &
	Partial<LLMTextProvider> &
	Partial<LLMStreamingProvider> &
	Partial<LLMEmbeddingProvider> &
	Partial<LLMImageProvider>;

export type ProviderForOperation<TOperation extends ProviderCapability> = TOperation extends "text"
	? ProviderIdentity & LLMTextProvider
	: TOperation extends "stream"
		? ProviderIdentity & LLMStreamingProvider
		: TOperation extends "embed"
			? ProviderIdentity & LLMEmbeddingProvider
			: TOperation extends "embedBatch"
				? ProviderIdentity & LLMEmbeddingProvider
				: TOperation extends "image"
					? ProviderIdentity & LLMImageProvider
					: never;
