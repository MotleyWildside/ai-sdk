import OpenAI from "openai";
import { LLMError } from "../errors";
import type {
	LLMEmbeddingProvider,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
	LLMStreamingProvider,
	LLMTextProvider,
} from "./types";
import { BaseLLMProvider, type ProviderImageUrlAttachment } from "./base";

/**
 * OpenAI provider adapter
 */
export class OpenAIProvider
	extends BaseLLMProvider
	implements LLMTextProvider, LLMStreamingProvider, LLMEmbeddingProvider
{
	readonly name = "openai";

	/**
	 * OpenAI model prefixes that this provider supports
	 */
	protected readonly supportedModelPrefixes = [
		"gpt-",
		"o1-",
		"o3-",
		"o4-",
		"text-embedding-3-",
		"text-embedding-ada-",
		"davinci-",
		"babbage-",
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

			const wrapError = (e: unknown) => this.wrapError(e, request.model);
			return {
				stream: (async function* () {
					let fullText = "";
					try {
						for await (const part of stream) {
							const delta = part.choices[0]?.delta?.content || "";
							fullText += delta;
							yield { text: fullText, delta };
						}
					} catch (error) {
						throw wrapError(error);
					}
				})(),
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

		return new LLMError({
			message: error instanceof Error ? error.message : "Unknown error",
			provider: this.name,
			model,
			cause: error instanceof Error ? error : new Error(String(error)),
		});
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

	override supportsAttachments(attachments: ProviderImageUrlAttachment[], model: string): boolean {
		return (
			this.supportsModel(model) &&
			attachments.every((attachment) => attachment.type === "image_url")
		);
	}
}
