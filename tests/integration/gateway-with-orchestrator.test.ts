import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { GuidlioLMService } from "../../src/llm-service/GuidlioLMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { GuidlioOrchestrator } from "../../src/orchestrator/GuidlioOrchestrator";
import { PipelineStep, StepResult, BaseContext } from "../../src/orchestrator/types";
import { ok, failed, redirect } from "../../src/orchestrator/statusHelpers";
import { RedirectRoutingPolicy } from "../../src/orchestrator/policies/RedirectRoutingPolicy";
import { RetryPolicy } from "../../src/orchestrator/policies/RetryPolicy";
import { LLMTransientError, LLMPermanentError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makeMockCache } from "../fixtures/mockCache";
import { makePrompt, makeJsonPrompt } from "../fixtures/prompts";
import { PIPELINE_STATUS, TRANSITION_TYPE } from "../../src/orchestrator/constants";
import type { PolicyDecisionInput } from "../../src/orchestrator/types";

type Ctx = BaseContext & {
	input?: string;
	classification?: { kind: "premium" | "standard" };
	output?: string;
};

const ClassifySchema = z.object({ kind: z.enum(["premium", "standard"]) });

describe("Integration — Gateway + Orchestrator", () => {
	afterEach(() => vi.useRealTimers());

	function buildPipeline(opts: {
		classifyResponse: string;
		providerA?: ReturnType<typeof makeMockProvider>;
		providerB?: ReturnType<typeof makeMockProvider>;
		policy?: ConstructorParameters<typeof RetryPolicy>[0];
		cache?: ReturnType<typeof makeMockCache>;
	}) {
		const reg = new PromptRegistry();
		reg.register(makeJsonPrompt({ promptId: "classify", version: "1", modelDefaults: { model: "model-a-v1" } }));
		reg.register(makePrompt({ promptId: "handlePremium", version: "1", modelDefaults: { model: "model-b-v2" } }));
		reg.register(makePrompt({ promptId: "handleStandard", version: "1", modelDefaults: { model: "model-a-v1" } }));

		const pA = opts.providerA ?? makeMockProvider({
			name: "providerA",
			supports: (m) => m.startsWith("model-a-"),
			callImpl: async () => ({ text: opts.classifyResponse, raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" }),
		});
		const pB = opts.providerB ?? makeMockProvider({
			name: "providerB",
			supports: (m) => m.startsWith("model-b-"),
			callImpl: async () => ({ text: "premium handled", raw: {}, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" }),
		});

		const svc = new GuidlioLMService({
			providers: [pA, pB],
			promptRegistry: reg,
			...(opts.cache ? { cacheProvider: opts.cache } : {}),
		});

		class ClassifyStep extends PipelineStep<Ctx> {
			readonly name = "ClassifyStep";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> {
				try {
					const result = await svc.callJSON<{ kind: "premium" | "standard" }>({
						promptId: "classify",
						model: "model-a-v1",
						jsonSchema: ClassifySchema,
						...(opts.cache ? { cache: { mode: "read_through", ttlSeconds: 60 } } : {}),
					});
					return redirect({ ctx: { ...ctx, classification: result.data }, message: result.data.kind });
				} catch (e) {
					if (e instanceof LLMPermanentError) return failed({ ctx, error: e as Error, retryable: false });
					if (e instanceof LLMTransientError) return failed({ ctx, error: e as Error, retryable: true });
					return failed({ ctx, error: e as Error, retryable: false });
				}
			}
		}

		class HandlePremiumStep extends PipelineStep<Ctx> {
			readonly name = "HandlePremiumStep";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> {
				const r = await svc.callText({ promptId: "handlePremium", model: "model-b-v2" });
				return ok({ ctx: { ...ctx, output: r.text } });
			}
		}

		class HandleStandardStep extends PipelineStep<Ctx> {
			readonly name = "HandleStandardStep";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> {
				const r = await svc.callText({ promptId: "handleStandard", model: "model-a-v1" });
				return ok({ ctx: { ...ctx, output: r.text } });
			}
		}

		// Policy: redirect ClassifyStep → GOTO handle step; ok from handle steps → STOP
		class RoutingPolicy<C extends BaseContext> extends RedirectRoutingPolicy<C> {
			protected override ok(_outcome: { type: "ok" }, input: PolicyDecisionInput<C>): import("../../src/orchestrator/types").Transition {
				if (input.stepName !== "ClassifyStep") {
					return { type: TRANSITION_TYPE.STOP };
				}
				return { type: TRANSITION_TYPE.NEXT };
			}
		}

		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new ClassifyStep(), new HandlePremiumStep(), new HandleStandardStep()],
			policy: opts.policy
				? () => new RetryPolicy<Ctx>(opts.policy)
				: () => new RoutingPolicy<Ctx>({
					premium: "HandlePremiumStep",
					standard: "HandleStandardStep",
				}),
		});

		return { orch, pA, pB, svc };
	}

	it("IG-01: classification 'premium' routes to HandlePremiumStep", async () => {
		const { orch, pA, pB } = buildPipeline({ classifyResponse: '{"kind":"premium"}' });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
		expect(pB.call).toHaveBeenCalledOnce();
		expect(pA.call).toHaveBeenCalledOnce(); // classify only
	});

	it("IG-02: classification 'standard' routes to HandleStandardStep", async () => {
		const { orch, pA, pB } = buildPipeline({ classifyResponse: '{"kind":"standard"}' });
		const result = await orch.run({ traceId: "t" });
		expect(result.status).toBe(PIPELINE_STATUS.OK);
		expect(pA.call).toHaveBeenCalledTimes(2); // classify + handle
		expect(pB.call).not.toHaveBeenCalled();
	});

	it("IG-03: classification returns unknown kind — pipeline fails", async () => {
		const { orch } = buildPipeline({ classifyResponse: '{"kind":"unknown"}' });
		const result = await orch.run({ traceId: "t" });
		// Zod validation will fail since "unknown" is not in enum
		expect(result.status).toBe(PIPELINE_STATUS.FAILED);
	});

	it("IG-07: traceId flows consistently through the run", async () => {
		const { orch } = buildPipeline({ classifyResponse: '{"kind":"premium"}' });
		const result = await orch.run({ traceId: "trace-123" });
		expect(result.ctx.traceId).toBe("trace-123");
	});
});
