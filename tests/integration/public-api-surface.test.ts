import { describe, it, expect } from "vitest";
import * as api from "../../src/index";
import type {
	BaseContext,
	ContextAdjustment,
	PipelinePolicy,
	PolicyDecisionInput,
	PolicyDecisionOutput,
	RetryPolicyOptions,
	RouteMap,
	StepOutcomeFailed,
	StepOutcomeOk,
	StepOutcomeRedirect,
	LLMImageProvider,
	LLMProvider,
	Transition,
} from "../../src/index";

type PublicOrchestratorTypeSmoke = {
	retryOptions: RetryPolicyOptions;
	routes: RouteMap;
	okOutcome: StepOutcomeOk;
	failedOutcome: StepOutcomeFailed;
	redirectOutcome: StepOutcomeRedirect;
	transition: Transition;
	contextAdjustment: ContextAdjustment<BaseContext>;
	decisionInput: PolicyDecisionInput<BaseContext>;
	decisionOutput: PolicyDecisionOutput<BaseContext>;
	policy: PipelinePolicy<BaseContext>;
};

type PublicProviderTypeSmoke = {
	anyProvider: LLMProvider;
	imageProvider: LLMImageProvider;
};

describe("Public API surface", () => {
	it("API-01: LMService is a class (function constructor)", () => {
		expect(typeof api.LMService).toBe("function");
	});

	it("API-02: OpenAIProvider, GeminiProvider, OpenRouterProvider are classes", () => {
		expect(typeof api.OpenAIProvider).toBe("function");
		expect(typeof api.GeminiProvider).toBe("function");
		expect(typeof api.OpenRouterProvider).toBe("function");
	});

	it("API-03: PromptRegistry is a class", () => {
		expect(typeof api.PromptRegistry).toBe("function");
	});

	it("API-04: InMemoryCacheProvider is a class", () => {
		expect(typeof api.InMemoryCacheProvider).toBe("function");
	});

	it("API-05: PipelineOrchestrator, BasePipelineStep, DefaultPolicy are classes", () => {
		expect(typeof api.PipelineOrchestrator).toBe("function");
		expect(typeof api.BasePipelineStep).toBe("function");
		expect(typeof api.DefaultPolicy).toBe("function");
	});

	it("API-05b: RetryPolicy and RedirectRoutingPolicy are public policy classes", () => {
		expect(typeof api.RetryPolicy).toBe("function");
		expect(typeof api.RedirectRoutingPolicy).toBe("function");
		expect(new api.RetryPolicy({ maxAttempts: 2 })).toBeInstanceOf(api.DefaultPolicy);
		expect(new api.RedirectRoutingPolicy({ answer: "finalize" })).toBeInstanceOf(api.DefaultPolicy);
	});

	it("API-06: LoggerPipelineObserver and NoopPipelineObserver are classes", () => {
		expect(typeof api.LoggerPipelineObserver).toBe("function");
		expect(typeof api.NoopPipelineObserver).toBe("function");
		const noop = new api.NoopPipelineObserver();
		expect(typeof noop.onRunStart).toBe("function");
	});

	it("API-07: PIPELINE_STATUS, OUTCOME_TYPE, TRANSITION_TYPE are objects", () => {
		expect(typeof api.PIPELINE_STATUS).toBe("object");
		expect(typeof api.OUTCOME_TYPE).toBe("object");
		expect(typeof api.TRANSITION_TYPE).toBe("object");
		// Verify they have expected values
		expect(api.PIPELINE_STATUS.OK).toBe("ok");
		expect(api.PIPELINE_STATUS.FAILED).toBe("failed");
		expect(api.OUTCOME_TYPE.OK).toBe("ok");
		expect(api.TRANSITION_TYPE.NEXT).toBe("next");
	});

	it("API-08: ok, failed, redirect are functions", () => {
		expect(typeof api.ok).toBe("function");
		expect(typeof api.failed).toBe("function");
		expect(typeof api.redirect).toBe("function");
	});

	it("API-09: PipelineError, PipelineDefinitionError, StepExecutionError extend Error", () => {
		expect(typeof api.PipelineError).toBe("function");
		expect(typeof api.PipelineDefinitionError).toBe("function");
		expect(typeof api.StepExecutionError).toBe("function");
		// Instantiate and verify
		const pe = new api.PipelineDefinitionError("test");
		expect(pe).toBeInstanceOf(Error);
		expect(pe.name).toBe("PipelineDefinitionError");
	});

	it("API-09b: PipelineAbortedError is public and preserves abort status", () => {
		expect(typeof api.PipelineAbortedError).toBe("function");
		const error = new api.PipelineAbortedError("trace-1", "step-a");
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("PipelineAbortedError");
		expect(error.statusCode).toBe(499);
	});

	it("API-10: LLMError and subclasses extend Error", () => {
		expect(typeof api.LLMError).toBe("function");
		expect(typeof api.LLMTransientError).toBe("function");
		expect(typeof api.LLMPermanentError).toBe("function");
		expect(typeof api.LLMParseError).toBe("function");
		expect(typeof api.LLMSchemaError).toBe("function");
		const e = new api.LLMTransientError({ message: "msg", provider: "prov", model: "model" });
		expect(e).toBeInstanceOf(Error);
		expect(e.provider).toBe("prov");
		expect(e.model).toBe("model");
	});

	it("API-10b: LMService has generateImage method", () => {
		expect(typeof api.LMService.prototype.generateImage).toBe("function");
	});

	it("API-11: ConsoleLogger is a class", () => {
		expect(typeof api.ConsoleLogger).toBe("function");
		const log = new api.ConsoleLogger();
		expect(typeof log.info).toBe("function");
		expect(typeof log.llmCall).toBe("function");
		expect(typeof log.pipelineEvent).toBe("function");
	});

	it("API-12: public orchestrator type exports support extension points", () => {
		const typeSmoke: PublicOrchestratorTypeSmoke = {
			retryOptions: { maxAttempts: 2 },
			routes: { answer: "finalize" },
			okOutcome: { type: "ok" },
			failedOutcome: { type: "failed", error: new Error("failed"), retryable: true },
			redirectOutcome: { type: "redirect", message: "answer" },
			transition: { type: "goto", stepName: "finalize" },
			contextAdjustment: { type: "patch", patch: { input: "next" } },
			decisionInput: {
				stepName: "plan",
				stepResult: {
					ctx: { traceId: "trace-1" },
					outcome: { type: "ok" },
				},
				traceId: "trace-1",
			},
			decisionOutput: {
				transition: { type: "next" },
				contextAdjustment: { type: "none" },
			},
			policy: new api.DefaultPolicy(),
		};

		expect(typeSmoke.routes.answer).toBe("finalize");
		expect(typeSmoke.transition.type).toBe("goto");
	});

	it("API-13: public provider capability types support image-only providers", () => {
		const imageOnly = {
			name: "image-only",
			supportsModel: (model: string) => model.startsWith("image-"),
			generateImage: async () => ({
				images: [{ data: "AA==", mimeType: "image/png" }],
				raw: {},
			}),
		} satisfies LLMImageProvider;
		const typeSmoke: PublicProviderTypeSmoke = {
			anyProvider: imageOnly,
			imageProvider: imageOnly,
		};

		expect(typeSmoke.anyProvider.name).toBe("image-only");
		expect(typeof typeSmoke.imageProvider.generateImage).toBe("function");
	});
});
