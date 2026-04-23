import { describe, it, expect } from "vitest";
import { GuidlioOrchestrator } from "../../src/orchestrator/GuidlioOrchestrator";
import { PipelineStep, StepResult, BaseContext, PolicyDecisionInput, PolicyDecisionOutput } from "../../src/orchestrator/types";
import { ok } from "../../src/orchestrator/statusHelpers";
import { DefaultPolicy } from "../../src/orchestrator/policies/DefaultPolicy";

type Ctx = BaseContext & { x?: number; foo?: string };

class OkStep extends PipelineStep<Ctx> {
	readonly name = "step";
	async run(ctx: Ctx): Promise<StepResult<Ctx>> {
		return ok({ ctx });
	}
}

class ContextAdjustmentPolicy<C extends BaseContext> extends DefaultPolicy<C> {
	constructor(private adj: PolicyDecisionOutput<C>["contextAdjustment"]) { super(); }
	decide(input: PolicyDecisionInput<C>): PolicyDecisionOutput<C> {
		const base = super.decide(input);
		return { ...base, contextAdjustment: this.adj };
	}
}

describe("GuidlioOrchestrator — Context adjustments", () => {
	it("CX-01: contextAdjustment type:none — ctx unchanged", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep()],
			policy: () => new ContextAdjustmentPolicy({ type: "none" }),
		});
		const result = await orch.run({ traceId: "t", x: 99 });
		if (result.status === "ok") expect(result.ctx.x).toBe(99);
	});

	it("CX-02: patch merges partial, other keys preserved", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep()],
			policy: () => new ContextAdjustmentPolicy({ type: "patch", patch: { x: 1 } }),
		});
		const result = await orch.run({ traceId: "t", foo: "bar" });
		if (result.status === "ok") {
			expect(result.ctx.x).toBe(1);
			expect(result.ctx.foo).toBe("bar");
		}
	});

	it("CX-03: override without traceId — traceId restored", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep()],
			policy: () => new ContextAdjustmentPolicy({
				type: "override",
				ctx: { traceId: "", foo: "overridden" } as Ctx,
			}),
		});
		const result = await orch.run({ traceId: "original-trace" });
		if (result.status === "ok") {
			// traceId should be restored since override had empty string
			expect(result.ctx.traceId).toBe("original-trace");
			expect(result.ctx.foo).toBe("overridden");
		}
	});

	it("CX-04: override with traceId — supplied traceId used", async () => {
		const orch = new GuidlioOrchestrator<Ctx>({
			steps: [new OkStep()],
			policy: () => new ContextAdjustmentPolicy({
				type: "override",
				ctx: { traceId: "custom-trace", foo: "new" } as Ctx,
			}),
		});
		const result = await orch.run({ traceId: "old-trace" });
		if (result.status === "ok") {
			expect(result.ctx.traceId).toBe("custom-trace");
		}
	});
});
