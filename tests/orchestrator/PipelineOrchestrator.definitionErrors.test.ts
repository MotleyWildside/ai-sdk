import { describe, it, expect } from "vitest";
import { PipelineOrchestrator } from "../../src/orchestrator/PipelineOrchestrator";
import { BasePipelineStep as PipelineStep, StepResult, BaseContext, PolicyDecisionInput, PolicyDecisionOutput } from "../../src/orchestrator/types";
import { ok } from "../../src/orchestrator/statusHelpers";
import { DefaultPolicy } from "../../src/orchestrator/policies/DefaultPolicy";
import { PipelineDefinitionError } from "../../src/orchestrator/errors";
import { TRANSITION_TYPE } from "../../src/orchestrator/constants";

type Ctx = BaseContext;

class OkStep extends PipelineStep<Ctx> {
	constructor(readonly name: string) { super(); }
	async run(ctx: Ctx): Promise<StepResult<Ctx>> { return ok({ ctx }); }
}

describe("PipelineOrchestrator — Definition errors", () => {
	it("DE-01: empty steps array — constructor succeeds; run() throws PipelineDefinitionError", async () => {
		// BEHAVIOR NOTE: the empty-steps check is in run(), not the constructor.
		// Constructor with steps:[] is valid; run() propagates PipelineDefinitionError.
		const orch = new PipelineOrchestrator<Ctx>({ steps: [] as unknown as [OkStep] });
		await expect(orch.run({ traceId: "t" })).rejects.toBeInstanceOf(PipelineDefinitionError);
	});

	it("DE-02: duplicate step names throws in constructor", () => {
		expect(() =>
			new PipelineOrchestrator<Ctx>({ steps: [new OkStep("dup"), new OkStep("dup")] }),
		).toThrow(PipelineDefinitionError);
	});

	it("DE-03: step with empty name throws in constructor", () => {
		class BlankNameStep extends PipelineStep<Ctx> {
			readonly name = "";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> { return ok({ ctx }); }
		}
		expect(() => new PipelineOrchestrator<Ctx>({ steps: [new BlankNameStep()] })).toThrow(PipelineDefinitionError);
	});

	it("DE-03b: step with whitespace-only name throws", () => {
		class WhitespaceStep extends PipelineStep<Ctx> {
			readonly name = "   ";
			async run(ctx: Ctx): Promise<StepResult<Ctx>> { return ok({ ctx }); }
		}
		expect(() => new PipelineOrchestrator<Ctx>({ steps: [new WhitespaceStep()] })).toThrow(PipelineDefinitionError);
	});

	it("DE-04: policy returns goto to missing step — PipelineDefinitionError at runtime", async () => {
		class BadGotoPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(): PolicyDecisionOutput<C> {
				return { transition: { type: TRANSITION_TYPE.GOTO, stepName: "nonexistent" } };
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new OkStep("s")],
			policy: () => new BadGotoPolicy(),
		});
		await expect(orch.run({ traceId: "t" })).rejects.toBeInstanceOf(PipelineDefinitionError);
	});

	it("DE-05: maxTransitions exhausted via infinite retries — PipelineDefinitionError", async () => {
		class AlwaysRetryPolicy<C extends BaseContext> extends DefaultPolicy<C> {
			decide(): PolicyDecisionOutput<C> {
				return { transition: { type: TRANSITION_TYPE.RETRY } };
			}
		}
		const orch = new PipelineOrchestrator<Ctx>({
			steps: [new OkStep("s")],
			policy: () => new AlwaysRetryPolicy(),
			maxTransitions: 5,
		});
		await expect(orch.run({ traceId: "t" })).rejects.toBeInstanceOf(PipelineDefinitionError);
	});
});
