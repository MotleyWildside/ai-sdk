import type { LLMProvider } from "../providers/types";
import type { LLMAttachment, LMServiceConfig } from "../types";
import type { LLMLogger } from "../../logger/types";
import { LLMPermanentError } from "../errors";

export type ProviderOperation = "text" | "stream" | "embed" | "embedBatch" | "image";

export type ProviderOperationOptions = {
	operation: ProviderOperation;
	attachments?: LLMAttachment[];
	promptId?: string;
};

/**
 * Resolve a provider for a given model.
 *
 * 1. If `config.defaultProvider` resolves, use it.
 * 2. Otherwise pick the first registered provider whose `supportsModel` matches.
 * 3. Unless `strictProviderSelection: false`, throw if nothing matches.
 * 4. With `strictProviderSelection: false`, warn and fall back to the first registered provider.
 *
 * Misconfiguration warnings go to `logger.warn`, not `llmCall`, so they don't
 * inflate failed-call metrics.
 */
export function selectProvider(
	providers: Map<string, LLMProvider>,
	model: string,
	config: LMServiceConfig,
	logger: LLMLogger | null,
): LLMProvider {
	if (config.defaultProvider) {
		const provider = providers.get(config.defaultProvider);
		if (provider) return provider;

		logger?.warn(
			`Default provider "${config.defaultProvider}" not found — falling back to auto-select`,
			{ model },
		);
	}

	for (const provider of providers.values()) {
		if (provider.supportsModel(model)) return provider;
	}

	if (config.strictProviderSelection !== false) {
		throw new Error(`No registered provider supports model "${model}"`);
	}

	const firstProvider = Array.from(providers.values())[0];
	if (!firstProvider) {
		throw new Error("No LLM providers available");
	}

	logger?.warn(
		`No provider claimed model "${model}" — falling back to first registered provider "${firstProvider.name}"`,
		{ model },
	);

	return firstProvider;
}

/**
 * Resolve a provider and assert the operation-specific capability needed before
 * building the provider request.
 */
export function selectProviderForOperation(
	providers: Map<string, LLMProvider>,
	model: string,
	config: LMServiceConfig,
	logger: LLMLogger | null,
	options: ProviderOperationOptions,
): LLMProvider {
	const provider = selectProvider(providers, model, config, logger);
	assertProviderCapability(provider, model, options);
	return provider;
}

export function assertProviderCapability(
	provider: LLMProvider,
	model: string,
	options: ProviderOperationOptions,
): void {
	assertAttachmentSupport(provider, model, options.attachments, options.promptId);

	if (options.operation === "embed" && typeof provider.embed !== "function") {
		throw new LLMPermanentError({
			message: `Provider ${provider.name} does not support embeddings`,
			provider: provider.name,
			model,
			promptId: options.promptId,
		});
	}

	if (options.operation === "embedBatch" && typeof provider.embedBatch !== "function") {
		throw new LLMPermanentError({
			message: `Provider ${provider.name} does not support batch embeddings`,
			provider: provider.name,
			model,
			promptId: options.promptId,
		});
	}

	if (options.operation === "stream" && typeof provider.callStream !== "function") {
		throw new LLMPermanentError({
			message: `Provider ${provider.name} does not support streaming`,
			provider: provider.name,
			model,
			promptId: options.promptId,
		});
	}

	if (options.operation === "image" && typeof provider.generateImage !== "function") {
		throw new LLMPermanentError({
			message: `Provider ${provider.name} does not support image generation`,
			provider: provider.name,
			model,
			promptId: options.promptId,
		});
	}

	if (
		options.operation === "image" &&
		provider.supportsImageGeneration &&
		!provider.supportsImageGeneration(model)
	) {
		throw new LLMPermanentError({
			message: `Provider ${provider.name} does not support image generation for model ${model}`,
			provider: provider.name,
			model,
			promptId: options.promptId,
		});
	}
}

function assertAttachmentSupport(
	provider: LLMProvider,
	model: string,
	attachments: LLMAttachment[] | undefined,
	promptId: string | undefined,
): void {
	if (!attachments?.length) return;

	if (provider.supportsAttachments?.(attachments, model) === true) return;

	throw new LLMPermanentError({
		message: `Provider ${provider.name} does not support attachments for model ${model}`,
		provider: provider.name,
		model,
		promptId,
	});
}
