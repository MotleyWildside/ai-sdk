import { vi, type Mock } from "vitest";
import type {
	LLMProvider,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
} from "../../src/llm-service/providers/types";

export type MockProviderOptions = {
	name?: string;
	supports?: (model: string) => boolean;
	supportsAttachments?: LLMProvider["supportsAttachments"];
	callImpl?: (req: LLMProviderRequest) => Promise<LLMProviderResponse>;
	streamImpl?: (req: LLMProviderRequest) => Promise<LLMProviderStreamResponse>;
	embedImpl?: (req: LLMProviderEmbedRequest) => Promise<LLMProviderEmbedResponse>;
	embedBatchImpl?: (req: LLMProviderEmbedBatchRequest) => Promise<LLMProviderEmbedBatchResponse>;
};

type MockProvider = LLMProvider & {
	call: Mock<LLMProvider["call"]>;
	callStream: Mock<LLMProvider["callStream"]>;
	embed: Mock<LLMProvider["embed"]>;
	embedBatch: Mock<LLMProvider["embedBatch"]>;
	supportsModel: Mock<LLMProvider["supportsModel"]>;
	supportsAttachments: Mock<NonNullable<LLMProvider["supportsAttachments"]>>;
};

export function makeMockProvider(options: MockProviderOptions = {}): MockProvider {
	const name = options.name ?? "mock";
	const supportsFn = options.supports ?? (() => true);
	const supportsAttachmentsFn = options.supportsAttachments ?? (() => false);

	const defaultCallImpl = async (_req: LLMProviderRequest): Promise<LLMProviderResponse> => ({
		text: "mock response",
		raw: {},
		usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
		finishReason: "stop",
	});

	const defaultStreamImpl = async (
		_req: LLMProviderRequest,
	): Promise<LLMProviderStreamResponse> => ({
		stream: (async function* () {
			yield { text: "mock", delta: "mock" };
		})(),
	});

	const defaultEmbedImpl = async (
		_req: LLMProviderEmbedRequest,
	): Promise<LLMProviderEmbedResponse> => ({
		embedding: [0.1, 0.2, 0.3],
		usage: { totalTokens: 5 },
	});

	const defaultEmbedBatchImpl = async (
		req: LLMProviderEmbedBatchRequest,
	): Promise<LLMProviderEmbedBatchResponse> => ({
		embeddings: req.texts.map(() => [0.1, 0.2, 0.3]),
		usage: { totalTokens: req.texts.length * 5 },
	});

	const provider: MockProvider = {
		name,
		call: vi.fn<LLMProvider["call"]>(options.callImpl ?? defaultCallImpl),
		callStream: vi.fn<LLMProvider["callStream"]>(options.streamImpl ?? defaultStreamImpl),
		embed: vi.fn<LLMProvider["embed"]>(options.embedImpl ?? defaultEmbedImpl),
		embedBatch: vi.fn<LLMProvider["embedBatch"]>(options.embedBatchImpl ?? defaultEmbedBatchImpl),
		supportsModel: vi.fn<LLMProvider["supportsModel"]>(supportsFn),
		supportsAttachments:
			vi.fn<NonNullable<LLMProvider["supportsAttachments"]>>(supportsAttachmentsFn),
	};

	return provider;
}
