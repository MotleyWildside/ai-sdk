import type {
	LLMEmbeddingProvider,
	LLMImageProvider,
	LLMProvider,
	LLMStreamingProvider,
	LLMTextProvider,
	ProviderForOperation,
	ProviderIdentity,
} from "../providers/types";
import type { LLMAttachment, LMServiceConfig } from "../types";
import type { LLMLogger } from "../../logger/types";
import { LLMPermanentError } from "../errors";

export type ProviderOperation = "text" | "stream" | "embed" | "embedBatch" | "image";

export type ProviderOperationOptions = {
	operation: ProviderOperation;
	attachments?: LLMAttachment[];
	promptId?: string;
};

type ProviderOperationDescriptor = {
	label: string;
	hasCapability: (provider: LLMProvider, model: string) => boolean;
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
export function selectProviderForOperation<TOperation extends ProviderOperation>(
	providers: Map<string, LLMProvider>,
	model: string,
	config: LMServiceConfig,
	logger: LLMLogger | null,
	options: ProviderOperationOptions & { operation: TOperation },
): ProviderForOperation<TOperation> {
	const provider = selectProviderWithCapability(providers, model, config, logger, options);
	assertProviderCapability(provider, model, options);
	return provider;
}

export function isTextProvider(
	provider: LLMProvider,
): provider is ProviderIdentity & LLMTextProvider {
	return typeof provider.call === "function";
}

export function isStreamingTextProvider(
	provider: LLMProvider,
): provider is ProviderIdentity & LLMStreamingProvider {
	return typeof provider.callStream === "function";
}

export function isEmbeddingProvider(
	provider: LLMProvider,
): provider is ProviderIdentity & LLMEmbeddingProvider {
	return typeof provider.embed === "function" && typeof provider.embedBatch === "function";
}

export function isImageProvider(
	provider: LLMProvider,
): provider is ProviderIdentity & LLMImageProvider {
	return typeof provider.generateImage === "function";
}

export function assertProviderCapability(
	provider: LLMProvider,
	model: string,
	options: ProviderOperationOptions,
): void {
	assertAttachmentSupport(provider, model, options.attachments, options.promptId);

	const descriptor = operationDescriptors[options.operation];
	if (!descriptor.hasCapability(provider, model)) {
		throw new LLMPermanentError({
			message: `Provider ${provider.name} does not support ${descriptor.label} for model ${model}`,
			provider: provider.name,
			model,
			promptId: options.promptId,
		});
	}
}

function selectProviderWithCapability<TOperation extends ProviderOperation>(
	providers: Map<string, LLMProvider>,
	model: string,
	config: LMServiceConfig,
	logger: LLMLogger | null,
	options: ProviderOperationOptions & { operation: TOperation },
): ProviderForOperation<TOperation> {
	if (config.defaultProvider) {
		const provider = providers.get(config.defaultProvider);
		if (provider) return provider as ProviderForOperation<TOperation>;

		logger?.warn(
			`Default provider "${config.defaultProvider}" not found — falling back to auto-select`,
			{ model },
		);
	}

	const modelMatches = Array.from(providers.values()).filter((provider) =>
		provider.supportsModel(model),
	);

	for (const provider of modelMatches) {
		if (hasOperationCapability(provider, model, options.operation)) {
			return provider as ProviderForOperation<TOperation>;
		}
	}

	if (modelMatches.length > 0) {
		throw missingCapabilityError(modelMatches, model, options);
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

	return firstProvider as ProviderForOperation<TOperation>;
}

function hasOperationCapability(
	provider: LLMProvider,
	model: string,
	operation: ProviderOperation,
): boolean {
	return operationDescriptors[operation].hasCapability(provider, model);
}

function missingCapabilityError(
	providers: LLMProvider[],
	model: string,
	options: ProviderOperationOptions,
): LLMPermanentError {
	const providerNames = providers.map((provider) => provider.name).join(", ");
	return new LLMPermanentError({
		message: `No registered provider supports ${operationDescriptors[options.operation].label} for model ${model}; matching providers: ${providerNames}`,
		provider: providerNames,
		model,
		promptId: options.promptId,
	});
}

const operationDescriptors: Record<ProviderOperation, ProviderOperationDescriptor> = {
	text: {
		label: "text generation",
		hasCapability: (provider) => isTextProvider(provider),
	},
	stream: {
		label: "streaming",
		hasCapability: (provider) => isStreamingTextProvider(provider),
	},
	embed: {
		label: "embeddings",
		hasCapability: (provider) => isEmbeddingProvider(provider),
	},
	embedBatch: {
		label: "batch embeddings",
		hasCapability: (provider) => isEmbeddingProvider(provider),
	},
	image: {
		label: "image generation",
		hasCapability: (provider, model) =>
			isImageProvider(provider) &&
			(!provider.supportsImageGeneration || provider.supportsImageGeneration(model)),
	},
};

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
