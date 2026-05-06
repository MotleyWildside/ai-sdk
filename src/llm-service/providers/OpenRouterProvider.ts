import { OpenRouter } from "@openrouter/sdk";
import { LLMError, LLMTransientError, LLMPermanentError } from "../errors";
import type {
	LLMProvider,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
} from "./types";
import type { ChatResponse } from "@openrouter/sdk/models";

interface OpenRouterErrorLike {
	name: "OpenRouterError";
	message: string;
	statusCode?: number;
}

function isOpenRouterError(e: unknown): e is OpenRouterErrorLike {
	return (
		typeof e === "object" &&
		e !== null &&
		"name" in e &&
		(e as { name: unknown }).name === "OpenRouterError"
	);
}

/**
 * OpenRouter provider adapter
 */
export class OpenRouterProvider implements LLMProvider {
	readonly name = "openrouter";

	/**
	 * OpenRouter model prefixes that this provider supports
	 */
	private readonly supportedModelPrefixes = [
		"anthropic/",
		"google/",
		"meta-llama/",
		"mistralai/",
		"openai/",
		"deepseek/",
		"cohere/",
		"qwen/",
		"x-ai/",
		"microsoft/",
		"amazon/",
		"perplexity/",
		"nvidia/",
		"01-ai/",
	];

	private client: OpenRouter | null = null;

	constructor(private apiKey: string) {}

	private getClient(): OpenRouter {
		if (!this.client) {
			this.client = new OpenRouter({
				apiKey: this.apiKey,
			});
		}
		return this.client;
	}

	/**
	 * Convert normalized request to OpenRouter message format
	 */
	private normalizeMessages(
		messages: LLMProviderRequest["messages"],
	): Parameters<OpenRouter["chat"]["send"]>[0]["chatGenerationParams"]["messages"] {
		return messages.map((msg) => {
			return {
				role: msg.role,
				content: msg.content,
			};
		}) as Parameters<OpenRouter["chat"]["send"]>[0]["chatGenerationParams"]["messages"];
	}

	/**
	 * Call OpenRouter API with streaming response
	 */
	async callStream(request: LLMProviderRequest): Promise<LLMProviderStreamResponse> {
		try {
			const client = this.getClient();

			const chatParams: Parameters<typeof client.chat.send>[0] = {
				chatGenerationParams: {
					model: request.model,
					messages: this.normalizeMessages(request.messages),
					temperature: request.temperature,
					maxTokens: request.maxTokens,
					topP: request.topP,
					seed: request.seed,
					stream: true,
				},
			};

			if (request.responseFormat === "json") {
				chatParams.chatGenerationParams.responseFormat = {
					type: "json_object",
				};
			}

			const stream = await client.chat.send(chatParams, {
				signal: request.signal,
			});

			const wrapError = (e: unknown) => this.wrapError(e, request.model);
			return {
				stream: (async function* () {
					let fullText = "";
					try {
						const asyncStream = stream as AsyncIterable<{
							choices: Array<{ delta?: { content?: string } }>;
						}>;
						for await (const part of asyncStream) {
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
			throw this.wrapError(error, request.model);
		}
	}

	private wrapError(error: unknown, model: string): Error {
		if (isOpenRouterError(error)) {
			const statusCode = error.statusCode ?? 500;
			const isTransient =
				statusCode === 429 ||
				statusCode === 408 ||
				statusCode === 502 ||
				statusCode === 503 ||
				statusCode >= 500;
			const opts = {
				message: `OpenRouter API error: ${error.message}`,
				provider: "openrouter",
				model,
				statusCode,
				cause: new Error(error.message),
			};
			return isTransient ? new LLMTransientError(opts) : new LLMPermanentError(opts);
		}

		if (error instanceof LLMError) return error;

		return new LLMError({
			message: error instanceof Error ? error.message : "Unknown error",
			provider: "openrouter",
			model,
			cause: error instanceof Error ? error : new Error(String(error)),
		});
	}

	/**
	 * Call OpenRouter API with normalized request
	 */
	async call(request: LLMProviderRequest): Promise<LLMProviderResponse> {
		try {
			const client = this.getClient();

			const chatParams: Parameters<typeof client.chat.send>[0] = {
				chatGenerationParams: {
					model: request.model,
					messages: this.normalizeMessages(request.messages),
					temperature: request.temperature,
					maxTokens: request.maxTokens,
					topP: request.topP,
					seed: request.seed,
					stream: false,
				},
			};

			if (request.responseFormat === "json") {
				chatParams.chatGenerationParams.responseFormat = {
					type: "json_object",
				};
			}

			const completion = (await client.chat.send(chatParams, {
				signal: request.signal,
			})) as ChatResponse;

			const choice = completion.choices[0];
			const message = choice?.message;

			const content = typeof message?.content === "string" ? message.content : null;

			if (!content) {
				throw new LLMError({
					message: "No response content from OpenRouter",
					provider: "openrouter",
					model: request.model,
					requestId: completion.id,
				});
			}

			return {
				text: content,
				raw: completion,
				usage: completion.usage
					? {
							promptTokens: completion.usage.promptTokens,
							completionTokens: completion.usage.completionTokens,
							totalTokens: completion.usage.totalTokens,
						}
					: undefined,
				finishReason: choice?.finishReason ?? undefined,
				requestId: completion.id,
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	/**
	 * Generate vector embedding for text (not supported)
	 */
	async embed(_request: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse> {
		throw new Error("Embeddings are not supported by OpenRouter provider");
	}

	/**
	 * Generate vector embeddings for multiple texts (not supported)
	 */
	async embedBatch(_request: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse> {
		throw new Error("Embeddings are not supported by OpenRouter provider");
	}

	/**
	 * Check if this provider supports a given model
	 */
	supportsModel(model: string): boolean {
		return this.supportedModelPrefixes.some((prefix) => model.toLowerCase().startsWith(prefix));
	}

	supportsAttachments(
		attachments: Array<{ type: "image_url"; url: string; detail?: "auto" | "low" | "high" }>,
		model: string,
	): boolean {
		return (
			this.supportsModel(model) &&
			attachments.every((attachment) => attachment.type === "image_url")
		);
	}
}
