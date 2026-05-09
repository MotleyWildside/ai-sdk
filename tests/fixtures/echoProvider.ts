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
} from "../../src/llm-service/providers/types";
import { BaseLLMProvider } from "../../src/llm-service/providers/base";

export class EchoProvider
	extends BaseLLMProvider
	implements LLMTextProvider, LLMStreamingProvider, LLMEmbeddingProvider, LLMImageProvider
{
	readonly name = "echo";
	protected readonly supportedModelPrefixes = ["echo-"];

	async call(req: LLMProviderRequest): Promise<LLMProviderResponse> {
		return {
			text: JSON.stringify(req.messages),
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			raw: req,
			finishReason: "stop",
		};
	}

	async callStream(req: LLMProviderRequest): Promise<LLMProviderStreamResponse> {
		const text = JSON.stringify(req.messages);
		return {
			stream: (async function* () {
				yield { text: "e", delta: "e" };
				yield { text: "echo", delta: "cho" };
				yield { text, delta: text.slice(4) };
			})(),
		};
	}

	async embed(r: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse> {
		const dims = r.dimensions ?? 3;
		return {
			embedding: new Array(dims).fill(0.1),
			usage: { totalTokens: 1 },
		};
	}

	async embedBatch(r: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse> {
		return {
			embeddings: r.texts.map(() => [0.1, 0.2]),
			usage: { totalTokens: r.texts.length },
		};
	}

	supportsImageGeneration(model: string): boolean {
		return model.startsWith("echo-image-");
	}

	async generateImage(r: LLMProviderImageRequest): Promise<LLMProviderImageResponse> {
		return {
			images: [{ data: Buffer.from(r.prompt).toString("base64"), mimeType: "image/png" }],
			raw: r,
		};
	}
}
