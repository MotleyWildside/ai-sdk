import OpenAI from "openai";
import { LLMError } from "../errors";
import type {
	LLMEmbeddingProvider,
	LLMImageProvider,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
	LLMProviderImageRequest,
	LLMProviderImageResponse,
	LLMStreamingProvider,
	LLMTextProvider,
} from "./types";
import { BaseLLMProvider, type ProviderImageUrlAttachment } from "./base";

/**
 * OpenAI provider adapter
 */
export class OpenAIProvider
	extends BaseLLMProvider
	implements LLMTextProvider, LLMStreamingProvider, LLMEmbeddingProvider, LLMImageProvider
{
	readonly name = "openai";

	protected readonly supportedModelPrefixes = [
		"gpt-",
		"o1-",
		"o3-",
		"o4-",
		"text-embedding-3-",
		"text-embedding-ada-",
		"davinci-",
		"babbage-",
		"dall-e-",
	];

	private client: OpenAI | null = null;

	constructor(private apiKey: string) {
		super();
	}

	private getClient(): OpenAI {
		if (!this.client) {
			this.client = new OpenAI({
				apiKey: this.apiKey,
			});
		}
		return this.client;
	}

	/**
	 * Convert normalized request to OpenAI format
	 */
	private normalizeMessages(
		messages: LLMProviderRequest["messages"],
	): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
		return messages.map((msg) => {
			return {
				role: msg.role,
				content: msg.content,
			};
		}) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	}

	/**
	 * Call OpenAI API with streaming response
	 */
	async callStream(request: LLMProviderRequest): Promise<LLMProviderStreamResponse> {
		try {
			const client = this.getClient();

			const openaiParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: request.model,
				messages: this.normalizeMessages(request.messages),
				temperature: request.temperature,
				max_tokens: request.maxTokens,
				top_p: request.topP,
				seed: request.seed,
				stream: true,
			};

			if (request.responseFormat === "json") {
				openaiParams.response_format = { type: "json_object" };
			}

			const stream = await client.chat.completions.create(openaiParams, {
				signal: request.signal,
			});

			return {
				stream: this.streamTextDeltas(
					stream,
					(part) => part.choices[0]?.delta?.content || "",
					(error) => this.wrapError(error, request.model),
				),
			};
		} catch (error) {
			// Reuse error handling logic from call() if possible, or just wrap
			throw this.wrapError(error, request.model);
		}
	}

	private wrapError(error: unknown, model: string): Error {
		if (error instanceof OpenAI.APIError) {
			const statusCode = error.status || 500;
			const isTransient =
				statusCode === 429 ||
				statusCode >= 500 ||
				error.code === "rate_limit_exceeded" ||
				error.code === "server_error" ||
				error.code === "timeout";

			const message = `OpenAI API error: ${error.message}`;
			return isTransient
				? this.transientError(message, model, statusCode, error)
				: this.permanentError(message, model, statusCode, error);
		}

		if (error instanceof LLMError) return error;

		return this.unknownError(error, model);
	}

	/**
	 * Call OpenAI API with normalized request
	 */
	async call(request: LLMProviderRequest): Promise<LLMProviderResponse> {
		try {
			const client = this.getClient();

			const openaiParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: request.model,
				messages: this.normalizeMessages(request.messages),
				temperature: request.temperature,
				max_tokens: request.maxTokens,
				top_p: request.topP,
				seed: request.seed,
			};

			if (request.responseFormat === "json") {
				openaiParams.response_format = { type: "json_object" };
			}

			const completion = await client.chat.completions.create(openaiParams, {
				signal: request.signal,
			});

			const choice = completion.choices[0];
			const message = choice?.message;

			if (!message?.content) {
				throw new LLMError({
					message: "No response content from OpenAI",
					provider: this.name,
					model: request.model,
					requestId: completion.id,
				});
			}

			return {
				text: message.content,
				raw: completion,
				usage: completion.usage
					? {
							promptTokens: completion.usage.prompt_tokens,
							completionTokens: completion.usage.completion_tokens,
							totalTokens: completion.usage.total_tokens,
						}
					: undefined,
				finishReason: choice?.finish_reason,
				requestId: completion.id,
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	/**
	 * Generate vector embedding for text
	 */
	async embed(request: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse> {
		try {
			const client = this.getClient();
			const response = await client.embeddings.create(
				{
					model: request.model,
					input: request.text,
					dimensions: request.dimensions ?? 1536,
				},
				{ signal: request.signal },
			);

			return {
				embedding: response.data[0].embedding,
				usage: {
					totalTokens: response.usage.total_tokens,
				},
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	/**
	 * Generate vector embeddings for multiple texts using batch input
	 */
	async embedBatch(request: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse> {
		try {
			const client = this.getClient();
			const response = await client.embeddings.create(
				{
					model: request.model,
					input: request.texts,
					dimensions: request.dimensions ?? 1536,
				},
				{ signal: request.signal },
			);

			return {
				embeddings: response.data.map((d) => d.embedding),
				usage: {
					totalTokens: response.usage.total_tokens,
				},
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	supportsImageGeneration(model: string): boolean {
		return model.toLowerCase().startsWith("dall-e-");
	}

	async generateImage(request: LLMProviderImageRequest): Promise<LLMProviderImageResponse> {
		try {
			const client = this.getClient();
			if (request.model.toLowerCase().startsWith("dall-e-3")) {
				return this.generateViaDalle3(client, request);
			}
			return this.generateViaDalle2(client, request);
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	private async generateViaDalle3(
		client: OpenAI,
		request: LLMProviderImageRequest,
	): Promise<LLMProviderImageResponse> {
		if (request.aspectRatio && !["1:1", "9:16", "16:9"].includes(request.aspectRatio)) {
			throw this.permanentError(
				`DALL-E 3 does not support aspectRatio="${request.aspectRatio}". Supported: 1:1, 9:16, 16:9.`,
				request.model,
			);
		}
		if (request.numberOfImages !== undefined && request.numberOfImages > 1) {
			throw this.permanentError("DALL-E 3 supports only 1 image per request.", request.model);
		}

		const response = await client.images.generate(
			{
				model: request.model,
				prompt: request.prompt,
				n: 1,
				size: this.toDalle3Size(request.aspectRatio),
				response_format: "b64_json",
			},
			{ signal: request.signal },
		);

		const images = (response.data ?? []).map((img) => ({
			data: img.b64_json ?? "",
			mimeType: "image/png" as const,
		}));
		const revisedPrompt = response.data?.[0]?.revised_prompt;
		return { images, raw: response, text: revisedPrompt ?? undefined };
	}

	private async generateViaDalle2(
		client: OpenAI,
		request: LLMProviderImageRequest,
	): Promise<LLMProviderImageResponse> {
		if (request.aspectRatio && request.aspectRatio !== "1:1") {
			throw this.permanentError(
				`DALL-E 2 only supports 1:1 aspect ratio. Received: "${request.aspectRatio}".`,
				request.model,
			);
		}
		if (request.imageSize && !["0.5K", "1K"].includes(request.imageSize)) {
			throw this.permanentError(
				`DALL-E 2 does not support imageSize="${request.imageSize}". Supported: 0.5K (512×512), 1K (1024×1024).`,
				request.model,
			);
		}

		const response = await client.images.generate(
			{
				model: request.model,
				prompt: request.prompt,
				n: request.numberOfImages ?? 1,
				size: this.toDalle2Size(request.imageSize),
				response_format: "b64_json",
			},
			{ signal: request.signal },
		);

		const images = (response.data ?? []).map((img) => ({
			data: img.b64_json ?? "",
			mimeType: "image/png" as const,
		}));
		return { images, raw: response };
	}

	private toDalle3Size(
		aspectRatio?: LLMProviderImageRequest["aspectRatio"],
	): "1024x1024" | "1024x1792" | "1792x1024" {
		if (aspectRatio === "9:16") return "1024x1792";
		if (aspectRatio === "16:9") return "1792x1024";
		return "1024x1024";
	}

	private toDalle2Size(
		imageSize?: LLMProviderImageRequest["imageSize"],
	): "256x256" | "512x512" | "1024x1024" {
		if (imageSize === "0.5K") return "512x512";
		return "1024x1024";
	}

	override supportsAttachments(attachments: ProviderImageUrlAttachment[], model: string): boolean {
		return this.supportsImageUrlAttachments(attachments, model);
	}
}
