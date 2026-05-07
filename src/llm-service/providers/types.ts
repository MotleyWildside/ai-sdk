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

/**
 * Base interface for all LLM providers
 */
export interface LLMProvider {
	/**
	 * Provider identifier (e.g., 'openai', 'anthropic', 'google')
	 */
	readonly name: string;

	/**
	 * Call the provider with a normalized request
	 */
	call(request: LLMProviderRequest): Promise<LLMProviderResponse>;

	/**
	 * Call the provider with a streaming response
	 */
	callStream(request: LLMProviderRequest): Promise<LLMProviderStreamResponse>;

	/**
	 * Generate vector embedding for text
	 */
	embed(request: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse>;

	/**
	 * Generate vector embeddings for multiple texts
	 */
	embedBatch(request: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse>;

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

	/**
	 * Generate images from a text prompt. Optional — providers that don't support image
	 * generation omit this method.
	 */
	generateImage?(request: LLMProviderImageRequest): Promise<LLMProviderImageResponse>;

	/**
	 * Whether this provider can generate images for the given model.
	 */
	supportsImageGeneration?(model: string): boolean;
}
