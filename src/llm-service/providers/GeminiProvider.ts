import { GoogleGenAI, ApiError, PersonGeneration } from "@google/genai";
import type { Content, Part } from "@google/genai";
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
	LLMProviderImageRequest,
	LLMProviderImageResponse,
	LLMMessage,
} from "./types";

export class GeminiProvider implements LLMProvider {
	readonly name = "gemini";

	private static readonly IMAGEN_PREFIX = "imagen-";
	private static readonly NANO_BANANA_PATTERN = /^gemini-.*-image(-preview)?$/i;
	private static readonly VISION_PATTERN = /^gemini-(1\.5|2\.|3)/i;

	private ai: GoogleGenAI;

	constructor(apiKey: string) {
		this.ai = new GoogleGenAI({ apiKey });
	}

	async call(request: LLMProviderRequest): Promise<LLMProviderResponse> {
		try {
			const { systemInstruction, contents } = this.convertMessages(request.messages);

			const r = await this.ai.models.generateContent({
				model: request.model,
				contents,
				config: {
					systemInstruction,
					temperature: request.temperature,
					topP: request.topP,
					maxOutputTokens: request.maxTokens,
					responseMimeType: request.responseFormat === "json" ? "application/json" : "text/plain",
					abortSignal: request.signal,
				},
			});

			return {
				text: r.text ?? "",
				raw: r,
				usage: r.usageMetadata
					? {
							promptTokens: r.usageMetadata.promptTokenCount ?? 0,
							completionTokens: r.usageMetadata.candidatesTokenCount ?? 0,
							totalTokens: r.usageMetadata.totalTokenCount ?? 0,
						}
					: undefined,
				finishReason: r.candidates?.[0]?.finishReason?.toString(),
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	async callStream(request: LLMProviderRequest): Promise<LLMProviderStreamResponse> {
		try {
			const { systemInstruction, contents } = this.convertMessages(request.messages);

			const stream = await this.ai.models.generateContentStream({
				model: request.model,
				contents,
				config: {
					systemInstruction,
					temperature: request.temperature,
					topP: request.topP,
					maxOutputTokens: request.maxTokens,
					responseMimeType: request.responseFormat === "json" ? "application/json" : "text/plain",
					abortSignal: request.signal,
				},
			});

			const wrapError = (e: unknown) => this.wrapError(e, request.model);
			return {
				stream: (async function* () {
					let fullText = "";
					try {
						for await (const chunk of stream) {
							const delta = chunk.text ?? "";
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

	async embed(request: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse> {
		try {
			const r = await this.ai.models.embedContent({
				model: request.model,
				contents: [request.text],
				config: {
					taskType: request.taskType ?? "RETRIEVAL_DOCUMENT",
					outputDimensionality: request.dimensions,
					abortSignal: request.signal,
				},
			});

			const values = r.embeddings?.[0]?.values;
			return {
				embedding: values ? Array.from(values) : [],
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	async embedBatch(request: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse> {
		try {
			const r = await this.ai.models.embedContent({
				model: request.model,
				contents: request.texts,
				config: {
					taskType: request.taskType ?? "RETRIEVAL_DOCUMENT",
					outputDimensionality: request.dimensions,
					abortSignal: request.signal,
				},
			});

			return {
				embeddings: (r.embeddings ?? []).map((e) => Array.from(e.values ?? [])),
			};
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	async generateImage(request: LLMProviderImageRequest): Promise<LLMProviderImageResponse> {
		try {
			if (this.isImagenModel(request.model)) {
				return this.generateViaImagen(request);
			}
			if (this.isNanoBananaModel(request.model)) {
				return this.generateViaGemini(request);
			}
			throw new LLMPermanentError({
				message: `Model ${request.model} is not an image-generation model. Use an imagen-* or gemini-*-image model.`,
				provider: "gemini",
				model: request.model,
			});
		} catch (error) {
			throw this.wrapError(error, request.model);
		}
	}

	supportsModel(model: string): boolean {
		const lower = model.toLowerCase();
		return (
			lower.startsWith("gemini-") ||
			lower.startsWith("learnlm-") ||
			lower.startsWith("gemini-embedding-") ||
			lower.startsWith("text-embedding-") ||
			lower.startsWith(GeminiProvider.IMAGEN_PREFIX)
		);
	}

	supportsAttachments(
		_attachments: Array<{ type: "image_url"; url: string }>,
		model: string,
	): boolean {
		return GeminiProvider.VISION_PATTERN.test(model);
	}

	supportsImageGeneration(model: string): boolean {
		return this.isImagenModel(model) || this.isNanoBananaModel(model);
	}

	private isImagenModel(model: string): boolean {
		return model.toLowerCase().startsWith(GeminiProvider.IMAGEN_PREFIX);
	}

	private isNanoBananaModel(model: string): boolean {
		return GeminiProvider.NANO_BANANA_PATTERN.test(model);
	}

	private async generateViaImagen(
		request: LLMProviderImageRequest,
	): Promise<LLMProviderImageResponse> {
		const personGen = this.toPersonGeneration(request.personGeneration);

		const r = await this.ai.models.generateImages({
			model: request.model,
			prompt: request.prompt,
			config: {
				numberOfImages: request.numberOfImages,
				aspectRatio: request.aspectRatio,
				negativePrompt: request.negativePrompt,
				...(personGen !== undefined ? { personGeneration: personGen } : {}),
				outputMimeType: request.outputMimeType,
				imageSize: request.imageSize,
				outputCompressionQuality: request.outputCompressionQuality,
				guidanceScale: request.guidanceScale,
				enhancePrompt: request.enhancePrompt,
				seed: request.seed,
				...(request.signal ? { abortSignal: request.signal } : {}),
			},
		});

		return {
			images: (r.generatedImages ?? []).map((g) => ({
				data: g.image?.imageBytes ?? "",
				mimeType: g.image?.mimeType ?? request.outputMimeType ?? "image/png",
			})),
			raw: r,
		};
	}

	private async generateViaGemini(
		request: LLMProviderImageRequest,
	): Promise<LLMProviderImageResponse> {
		const parts: Part[] = [];

		if (request.inputImages?.length) {
			for (const img of request.inputImages) {
				parts.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
			}
		}
		parts.push({ text: request.prompt });

		const contents: Content[] = [{ role: "user", parts }];

		const r = await this.ai.models.generateContent({
			model: request.model,
			contents,
			config: {
				responseModalities: ["IMAGE", "TEXT"],
				imageConfig: {
					...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
					...(request.imageSize ? { imageSize: request.imageSize } : {}),
					...(request.outputCompressionQuality !== undefined
						? { outputCompressionQuality: request.outputCompressionQuality }
						: {}),
				},
				...(request.signal ? { abortSignal: request.signal } : {}),
			},
		});

		const images: Array<{ data: string; mimeType: string }> = [];
		let text = "";

		for (const part of r.candidates?.[0]?.content?.parts ?? []) {
			if (part.inlineData?.data) {
				images.push({
					data: part.inlineData.data,
					mimeType: part.inlineData.mimeType ?? "image/png",
				});
			} else if (part.text) {
				text += part.text;
			}
		}

		return { images, text: text || undefined, raw: r };
	}

	private convertMessages(messages: LLMMessage[]): {
		systemInstruction?: string;
		contents: Content[];
	} {
		let systemInstruction = "";
		const contents: Content[] = [];

		for (const msg of messages) {
			if (msg.role === "system") {
				systemInstruction += (systemInstruction ? "\n" : "") + this.extractText(msg.content);
			} else {
				contents.push({
					role: msg.role === "user" ? "user" : "model",
					parts: this.buildParts(msg.content),
				});
			}
		}

		return { systemInstruction: systemInstruction || undefined, contents };
	}

	private buildParts(content: LLMMessage["content"]): Part[] {
		if (typeof content === "string") return [{ text: content }];

		return content.map((part): Part => {
			if (part.type === "text") return { text: part.text };

			const url = part.image_url.url;
			if (url.startsWith("data:")) {
				const [header, data] = url.split(",");
				const mimeType = header.replace("data:", "").replace(";base64", "");
				return { inlineData: { data, mimeType } };
			}

			// HTTP/HTTPS URL — pass as fileData reference
			return { fileData: { fileUri: url, mimeType: "image/jpeg" } };
		});
	}

	private extractText(content: LLMMessage["content"]): string {
		if (typeof content === "string") return content;
		return content
			.filter((p) => p.type === "text")
			.map((p) => (p.type === "text" ? p.text : ""))
			.join("\n");
	}

	private toPersonGeneration(
		value: LLMProviderImageRequest["personGeneration"],
	): PersonGeneration | undefined {
		if (!value) return undefined;
		const map: Record<string, PersonGeneration> = {
			dont_allow: PersonGeneration.DONT_ALLOW,
			allow_adult: PersonGeneration.ALLOW_ADULT,
			allow_all: PersonGeneration.ALLOW_ALL,
		};
		return map[value];
	}

	private wrapError(error: unknown, model: string): Error {
		if (error instanceof LLMError) return error;

		if (error instanceof ApiError) {
			const { status, message } = error;
			if (status === 429 || status >= 500) {
				return new LLMTransientError({
					message: `Gemini API transient error: ${message}`,
					provider: "gemini",
					model,
					statusCode: status,
					cause: error,
				});
			}
			return new LLMPermanentError({
				message: `Gemini API error: ${message}`,
				provider: "gemini",
				model,
				statusCode: status,
				cause: error,
			});
		}

		const message = error instanceof Error ? error.message : String(error);
		const cause = error instanceof Error ? error : new Error(String(error));
		return new LLMError({
			message: `Gemini API error: ${message}`,
			provider: "gemini",
			model,
			cause,
		});
	}
}
