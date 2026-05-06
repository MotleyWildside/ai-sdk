import type {
	LLMProvider,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
} from "../llm-service/providers/types";

export class EchoProvider implements LLMProvider {
	readonly name = "echo";

	supportsModel(m: string): boolean {
		return m.startsWith("echo-");
	}

	supportsAttachments(): boolean {
		return false;
	}

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
}
