/**
 * LLM Gateway - Professional NPM Package Public API
 */

// Core Service & Providers
export { LMService } from "./llm-service";
export { OpenAIProvider } from "./llm-service";
export { OpenRouterProvider } from "./llm-service";
export { GeminiProvider } from "./llm-service";

// Registry & Cache
export { PromptRegistry } from "./llm-service";
export { InMemoryCacheProvider } from "./llm-service";

// Pipeline Framework (Orchestrator)
export {
	PipelineOrchestrator,
	BasePipelineStep,
	DefaultPolicy,
	RetryPolicy,
	RedirectRoutingPolicy,
	LoggerPipelineObserver,
	NoopPipelineObserver,
	PIPELINE_STATUS,
	OUTCOME_TYPE,
	TRANSITION_TYPE,
	ok,
	failed,
	redirect,
	PipelineError,
	PipelineDefinitionError,
	StepExecutionError,
	PipelineAbortedError,
} from "./orchestrator";

export type {
	PipelineStep,
	PipelineRunResult,
	PipelineOrchestratorConfig,
	PipelineRunOptions,
	BaseContext,
	StepResult,
	StepOutcome,
	StepOutcomeOk,
	StepOutcomeFailed,
	StepOutcomeRedirect,
	Transition,
	PipelinePolicy,
	PolicyDecisionInput,
	PolicyDecisionOutput,
	ContextAdjustment,
	PipelineStatus,
	PipelineObserver,
	RetryPolicyOptions,
	RouteMap,
} from "./orchestrator";

// Global Types
export type {
	LLMTextParams,
	LLMStreamParams,
	LLMJsonParams,
	LLMTextRawParams,
	LLMJsonRawParams,
	LLMStreamRawParams,
	LLMTextInput,
	LLMJsonInput,
	LLMStreamInput,
	LLMTextResult,
	LLMJsonResult,
	LLMStreamResult,
	LLMEmbedParams,
	LLMEmbedResult,
	LLMEmbedBatchParams,
	LLMEmbedBatchResult,
	LLMImageParams,
	LLMImageRawParams,
	LLMImagePromptParams,
	LLMImageResult,
	LLMAttachment,
	LMServiceConfig,
} from "./llm-service/types";

export type {
	LLMGeneratedImage,
	LLMEmbeddingProvider,
	LLMImageProvider,
	LLMProvider,
	LLMProviderEmbedBatchRequest,
	LLMProviderEmbedBatchResponse,
	LLMProviderEmbedRequest,
	LLMProviderEmbedResponse,
	LLMProviderImageRequest,
	LLMProviderImageResponse,
	LLMProviderRequest,
	LLMProviderResponse,
	LLMProviderStreamResponse,
	LLMStreamingProvider,
	LLMTextProvider,
	ProviderCapability,
	ProviderForOperation,
	ProviderIdentity,
} from "./llm-service/providers/types";

export {
	BaseLLMProvider,
	BaseLLMTextProvider,
	BaseLLMStreamingProvider,
	BaseLLMEmbeddingProvider,
	BaseLLMImageProvider,
} from "./llm-service/providers/base";

export type {
	DimensionConstraints,
	ImageDimensions,
	ProviderErrorExtractor,
	ProviderImageUrlAttachment,
	ProviderPollOptions,
} from "./llm-service/providers/base";

export type { CacheConfig } from "./llm-service/cache/types";
export type { LLMLogger } from "./logger/types";

export type { PromptDefinition, PromptOutputConfig, PromptModelDefaults } from "./llm-service";

// Errors
export {
	LLMError,
	LLMTransientError,
	LLMPermanentError,
	LLMParseError,
	LLMSchemaError,
} from "./llm-service/errors";

// Logger
export { ConsoleLogger } from "./logger/logger";
