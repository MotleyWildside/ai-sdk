import { PromptRegistry } from "../prompts-registry/PromptRegistry";
import type { PromptDefinition } from "../prompts-registry/types";
import type { LLMImageUrlContentPart, LLMMessage } from "../providers/types";
import type { LLMAttachment } from "../types";

type RegisteredPromptInput = {
	promptId: string;
	promptVersion?: string | number;
	variables?: Record<string, unknown>;
	model?: string;
};

type RawPromptInput = {
	systemPrompt?: string;
	userPrompt: string;
	model: string;
};

export type MaterializedRegisteredPrompt = {
	prompt: PromptDefinition;
	model: string;
	messages: LLMMessage[];
};

export type MaterializedRawPrompt = {
	model: string;
	messages: LLMMessage[];
};

/**
 * Resolve a registry prompt into the model and provider-ready message list.
 * Provider selection intentionally lives elsewhere; this module only owns prompt
 * materialization and multimodal message placement.
 */
export function materializeRegisteredPrompt(
	promptRegistry: PromptRegistry,
	params: RegisteredPromptInput,
	defaultModel: string | undefined,
): MaterializedRegisteredPrompt {
	const prompt = promptRegistry.getPrompt(params.promptId, params.promptVersion);

	if (!prompt) {
		throw new Error(`Prompt not found: ${params.promptId}@${params.promptVersion ?? "latest"}`);
	}

	const model = params.model || prompt.modelDefaults.model || defaultModel || "";

	if (!model) {
		throw new Error(
			`No model resolved for prompt "${params.promptId}" — set params.model, prompt.modelDefaults.model, or LMServiceConfig.defaultModel`,
		);
	}

	return {
		prompt,
		model,
		messages: PromptRegistry.buildMessages(prompt, params.variables),
	};
}

/**
 * Resolve a raw prompt into provider-ready messages. Raw calls require a model
 * because there is no prompt definition to fall back to.
 */
export function materializeRawPrompt(params: RawPromptInput): MaterializedRawPrompt {
	const messages: LLMMessage[] = [];
	if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
	messages.push({ role: "user", content: params.userPrompt });

	return {
		model: params.model,
		messages,
	};
}

export function attachToUserMessage(
	messages: LLMMessage[],
	attachments?: LLMAttachment[],
): LLMMessage[] {
	if (!attachments?.length) return messages;

	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
	if (lastUserIndex === -1) {
		throw new Error("Attachments require at least one user prompt message");
	}

	return messages.map((message, index) => {
		if (index !== lastUserIndex) return message;

		const textParts =
			typeof message.content === "string"
				? [{ type: "text" as const, text: message.content }]
				: message.content;

		return {
			...message,
			content: [...textParts, ...normalizeAttachments(attachments)],
		};
	});
}

export function messagesToText(messages: LLMMessage[]): string {
	return messages
		.map((message) => (typeof message.content === "string" ? message.content : ""))
		.filter(Boolean)
		.join("\n\n");
}

function normalizeAttachments(attachments: LLMAttachment[]): LLMImageUrlContentPart[] {
	return attachments.map((attachment) => ({
		type: "image_url",
		image_url: {
			url: attachment.url,
			...(attachment.detail ? { detail: attachment.detail } : {}),
		},
	}));
}
