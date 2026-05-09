import { OpenRouter } from "@openrouter/sdk";
import { LLMError } from "../errors";
import type {
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMStreamingProvider,
	LLMTextProvider,
} from "./types";
import type { ChatResponse } from "@openrouter/sdk/models";
import { BaseLLMProvider, type ProviderImageUrlAttachment } from "./base";

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
export class OpenRouterProvider
	extends BaseLLMProvider
	implements LLMTextProvider, LLMStreamingProvider
{
	readonly name = "openrouter";

	/**
	 * OpenRouter model prefixes that this provider supports
	 */
	protected readonly supportedModelPrefixes = [
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

	constructor(private apiKey: string) {
		super();
	}

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
			const cause = new Error(error.message);
			const message = `OpenRouter API error: ${error.message}`;
			return isTransient
				? this.transientError(message, model, statusCode, cause)
				: this.permanentError(message, model, statusCode, cause);
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
					provider: this.name,
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

	override supportsAttachments(attachments: ProviderImageUrlAttachment[], model: string): boolean {
		return (
			this.supportsModel(model) &&
			attachments.every((attachment) => attachment.type === "image_url")
		);
	}
}
