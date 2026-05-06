import { describe, it, expect } from "vitest";
import * as api from "../../src/index";

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

	it("API-06: LoggerPipelineObserver is a class", () => {
		expect(typeof api.LoggerPipelineObserver).toBe("function");
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

	it("API-10: LLMError and subclasses extend Error", () => {
		expect(typeof api.LLMError).toBe("function");
		expect(typeof api.LLMTransientError).toBe("function");
		expect(typeof api.LLMPermanentError).toBe("function");
		expect(typeof api.LLMParseError).toBe("function");
		expect(typeof api.LLMSchemaError).toBe("function");
		const e = new api.LLMTransientError("msg", "prov", "model");
		expect(e).toBeInstanceOf(Error);
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
});
