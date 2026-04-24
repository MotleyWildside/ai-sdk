import { randomUUID } from "crypto";
import { PromptRegistry } from "./prompts-registry/PromptRegistry";
import type { PromptDefinition } from "./prompts-registry/types";
import type { LLMProvider, LLMProviderResponse } from "./providers/types";
import type { CacheProvider } from "./cache/types";
import { InMemoryCacheProvider } from "./cache/CacheProvider";
import type {
	LLMTextParams,
	LLMStreamParams,
	LLMJsonParams,
	LLMTextResult,
	LLMJsonResult,
	LLMStreamResult,
	LLMEmbedParams,
	LLMEmbedResult,
	LLMEmbedBatchParams,
	LLMEmbedBatchResult,
	GuidlioLMServiceConfig,
	ProviderRequest,
} from "./types";
import type { LLMLogger } from "../logger/types";
import { CallContext, logOutcome, errorMessage } from "./internal/logContext";
import { callWithRetries } from "./internal/retry";
import { buildCacheKey } from "./internal/cacheKey";
import { selectProvider } from "./internal/providerSelection";
import { parseAndRepairJSON, validateSchema, enforceJsonInstruction } from "./internal/jsonHelpers";

// ──────────────────────────────────────────────────────────────────────────────

// Widely-accepted balanced default; each provider's own default varies (OpenAI/Anthropic: 1.0).
const DEFAULT_TEMPERATURE = 0.7;

type ResolvedPrompt = {
	prompt: PromptDefinition;
	model: string;
	provider: LLMProvider;
};

type Messages = ReturnType<PromptRegistry["buildMessages"]>;

/**
 * Main LLM Gateway Service
 */
export class GuidlioLMService {
	private providers: Map<string, LLMProvider> = new Map();
	private cache: CacheProvider;
	private promptReg: PromptRegistry;
	private logger: LLMLogger | null;

	constructor(private config: GuidlioLMServiceConfig) {
		if (!config.providers || config.providers.length === 0) {
			throw new Error("At least one provider must be specified in GuidlioLMServiceConfig");
		}

		for (const provider of config.providers) {
			this.providers.set(provider.name, provider);
		}

		this.cache = config.cacheProvider || new InMemoryCacheProvider();
		this.promptReg = config.promptRegistry || new PromptRegistry();
		this.logger = config.logger || null;
	}

	/**
	 * Access the prompt registry to manage versioned prompts
	 */
	public get promptRegistry(): PromptRegistry {
		return this.promptReg;
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	/**
	 * Generate text response
	 */
	async callText(params: LLMTextParams): Promise<LLMTextResult> {
		return this.executeGeneration<LLMTextResult>(params, {
			responseFormat: "text",
			mapResponse: (_response, base) => base,
		});
	}

	/**
	 * Generate JSON response with schema validation
	 */
	async callJSON<T = unknown>(params: LLMJsonParams<T>): Promise<LLMJsonResult<T>> {
		return this.executeGeneration<LLMJsonResult<T>>(params, {
			responseFormat: "json",
			validatePrompt: (prompt) => {
				if (prompt.output.type !== "json") {
					throw new Error(`Prompt ${params.promptId} is not configured for JSON output`);
				}
			},
			prepareMessages: enforceJsonInstruction,
			mapResponse: (response, base, { prompt, providerName }) => {
				const parsed = parseAndRepairJSON<T>(
					response.text,
					providerName,
					base.model,
					params.promptId,
					response.requestId,
				);
				const schema = params.jsonSchema || prompt.output.schema;
				const validated = validateSchema<T>(
					parsed,
					schema,
					providerName,
					base.model,
					params.promptId,
					response.requestId,
				);
				return { ...base, data: validated };
			},
		});
	}

	/**
	 * Generate streaming response.
	 * Note: streaming bypasses retry logic — handle reconnection at the call site if needed.
	 * `cache` and `idempotencyKey` are excluded from the param type; pass them and TypeScript
	 * will reject the call at compile time.
	 */
	async callStream(params: LLMStreamParams): Promise<LLMStreamResult> {
		const traceId = params.traceId || this.generateTraceId();
		const { prompt, model, provider } = this.resolveCall(params);

		const ctx: CallContext = {
			traceId,
			promptId: params.promptId,
			promptVersion: prompt.version,
			model,
			providerName: provider.name,
			startedAt: Date.now(),
		};
		const messages = this.promptReg.buildMessages(prompt, params.variables);
		const providerRequest = this.buildProviderRequest(params, prompt, model, messages, "text");

		try {
			const response = await provider.callStream(providerRequest);
			const logger = this.logger;
			return {
				stream: (async function* () {
					try {
						yield* response.stream;
						logOutcome(logger, ctx, { success: true, durationMs: Date.now() - ctx.startedAt });
					} catch (error) {
						logOutcome(logger, ctx, {
							success: false,
							error: errorMessage(error),
							durationMs: Date.now() - ctx.startedAt,
						});
						throw error;
					}
				})(),
				traceId,
				promptId: params.promptId,
				promptVersion: prompt.version,
				model,
			};
		} catch (error) {
			logOutcome(this.logger, ctx, {
				success: false,
				error: errorMessage(error),
				durationMs: Date.now() - ctx.startedAt,
			});
			throw error;
		}
	}

	/**
	 * Generate vector embedding for text
	 */
	async embed(params: LLMEmbedParams): Promise<LLMEmbedResult> {
		return this.executeEmbedOp(
			params.model,
			params.traceId,
			(provider) =>
				provider.embed({
					text: params.text,
					model: params.model,
					dimensions: params.dimensions,
					taskType: params.taskType,
					signal: params.signal,
				}),
			(response) => ({
				embedding: response.embedding,
				usage: response.usage,
				model: params.model,
			}),
		);
	}

	/**
	 * Generate vector embeddings for multiple texts
	 */
	async embedBatch(params: LLMEmbedBatchParams): Promise<LLMEmbedBatchResult> {
		return this.executeEmbedOp(
			params.model,
			params.traceId,
			(provider) =>
				provider.embedBatch({
					texts: params.texts,
					model: params.model,
					dimensions: params.dimensions,
					taskType: params.taskType,
					signal: params.signal,
				}),
			(response) => ({
				embeddings: response.embeddings,
				usage: response.usage,
				model: params.model,
			}),
		);
	}

	// ─── Shared executors ────────────────────────────────────────────────────

	/**
	 * The shared pipeline for `callText` and `callJSON`:
	 * resolve prompt → (maybe read cache) → build request → call w/ retries →
	 * map response → write cache → log. Errors are logged and rethrown.
	 */
	private async executeGeneration<TResult extends LLMTextResult>(
		params: LLMTextParams,
		options: {
			responseFormat: "text" | "json";
			validatePrompt?: (prompt: PromptDefinition) => void;
			prepareMessages?: (messages: Messages) => Messages;
			mapResponse: (
				response: LLMProviderResponse,
				base: LLMTextResult,
				genCtx: { prompt: PromptDefinition; providerName: string },
			) => TResult;
		},
	): Promise<TResult> {
		const { prompt, model, provider } = this.resolveCall(params);
		options.validatePrompt?.(prompt);

		const traceId = params.traceId || this.generateTraceId();
		const ctx: CallContext = {
			traceId,
			promptId: params.promptId,
			promptVersion: prompt.version,
			model,
			providerName: provider.name,
			startedAt: Date.now(),
		};

		const cacheKey = this.cacheKeyOrNull(params, prompt, model);
		if (cacheKey && params.cache?.mode === "read_through") {
			const cached = await this.cache.get<TResult>(cacheKey);
			if (cached) {
				logOutcome(this.logger, ctx, { success: true, cached: true });
				return {
					...cached,
					traceId,
					durationMs: Date.now() - ctx.startedAt,
					requestId: undefined,
				};
			}
		}

		const rawMessages = this.promptReg.buildMessages(prompt, params.variables);
		const messages = options.prepareMessages ? options.prepareMessages(rawMessages) : rawMessages;

		const providerRequest = this.buildProviderRequest(
			params,
			prompt,
			model,
			messages,
			options.responseFormat,
		);

		try {
			const response = await callWithRetries(
				() => provider.call(providerRequest),
				this.config,
				this.logger,
				ctx,
			);

			const base: LLMTextResult = {
				text: response.text,
				usage: response.usage,
				finishReason: response.finishReason,
				requestId: response.requestId,
				traceId,
				promptId: params.promptId,
				promptVersion: prompt.version,
				model,
				durationMs: Date.now() - ctx.startedAt,
			};
			const result = options.mapResponse(response, base, {
				prompt,
				providerName: provider.name,
			});

			if (cacheKey) {
				await this.writeCache(params, cacheKey, result);
			}

			logOutcome(this.logger, ctx, {
				success: true,
				usage: response.usage,
			});
			return result;
		} catch (error) {
			logOutcome(this.logger, ctx, {
				success: false,
				error: errorMessage(error),
			});
			throw error;
		}
	}

	/**
	 * Shared pipeline for `embed` and `embedBatch`:
	 * select provider → call w/ retries → map → log.
	 */
	private async executeEmbedOp<TResp, TOut>(
		model: string,
		traceIdParam: string | undefined,
		run: (provider: LLMProvider) => Promise<TResp>,
		toResult: (response: TResp) => TOut,
	): Promise<TOut> {
		const provider = selectProvider(this.providers, model, this.config, this.logger);
		const ctx: CallContext = {
			traceId: traceIdParam || this.generateTraceId(),
			model,
			providerName: provider.name,
			startedAt: Date.now(),
		};

		try {
			const response = await callWithRetries(() => run(provider), this.config, this.logger, ctx);
			logOutcome(this.logger, ctx, { success: true });
			return toResult(response);
		} catch (error) {
			logOutcome(this.logger, ctx, {
				success: false,
				error: errorMessage(error),
			});
			throw error;
		}
	}

	// ─── Resolution helpers ──────────────────────────────────────────────────

	/**
	 * Resolve prompt, model, and provider — shared by all call* methods.
	 * Throws early with a clear message if the prompt does not exist or no model can be resolved.
	 */
	private resolveCall(params: LLMTextParams): ResolvedPrompt {
		const prompt = this.promptReg.getPrompt(params.promptId, params.promptVersion);

		if (!prompt) {
			throw new Error(`Prompt not found: ${params.promptId}@${params.promptVersion ?? "latest"}`);
		}

		const model = params.model || prompt.modelDefaults.model || this.config.defaultModel || "";

		if (!model) {
			throw new Error(
				`No model resolved for prompt "${params.promptId}" — set params.model, prompt.modelDefaults.model, or GuidlioLMServiceConfig.defaultModel`,
			);
		}

		const provider = selectProvider(this.providers, model, this.config, this.logger);
		return { prompt, model, provider };
	}

	/**
	 * Build a normalized provider request — shared by callText, callJSON, callStream
	 */
	private buildProviderRequest(
		params: LLMTextParams,
		prompt: PromptDefinition,
		model: string,
		messages: Messages,
		responseFormat: "text" | "json",
	): ProviderRequest {
		return {
			messages,
			model,
			temperature:
				params.temperature ??
				prompt.modelDefaults.temperature ??
				this.config.defaultTemperature ??
				DEFAULT_TEMPERATURE,
			maxTokens: params.maxTokens ?? prompt.modelDefaults.maxTokens,
			topP: params.topP ?? prompt.modelDefaults.topP,
			seed: params.seed,
			responseFormat,
			signal: params.signal,
		};
	}

	/**
	 * Only build a cache key when the call is eligible for caching;
	 * skip the hash entirely when caching is disabled globally or not requested.
	 */
	private cacheKeyOrNull(
		params: LLMTextParams,
		prompt: PromptDefinition,
		resolvedModel: string,
	): string | null {
		if (this.config.enableCache === false) return null;
		if (!params.cache) return null;
		return buildCacheKey(params, prompt, resolvedModel);
	}

	/**
	 * Write a result to cache when the cache mode and TTL are configured
	 */
	private async writeCache(
		params: LLMTextParams,
		cacheKey: string,
		result: unknown,
	): Promise<void> {
		if (params.cache?.mode === "read_through" || params.cache?.mode === "refresh") {
			await this.cache.set(cacheKey, result, params.cache.ttlSeconds);
		}
	}

	private generateTraceId(): string {
		return randomUUID();
	}
}
