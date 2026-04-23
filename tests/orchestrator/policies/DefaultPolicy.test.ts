import { describe, it, expect } from "vitest";
import { DefaultPolicy } from "../../../src/orchestrator/policies/DefaultPolicy";
import { TRANSITION_TYPE } from "../../../src/orchestrator/constants";
import { BaseContext, PolicyDecisionInput, StepResult } from "../../../src/orchestrator/types";

type Ctx = BaseContext;
const ctx: Ctx = { traceId: "t" };
const traceId = "t";

function input(outcome: StepResult<Ctx>["outcome"]): PolicyDecisionInput<Ctx> {
	return { stepName: "s", stepResult: { ctx, outcome }, traceId };
}

describe("DefaultPolicy", () => {
	const policy = new DefaultPolicy<Ctx>();

	it("DP-01: ok outcome → { type: 'next' }", () => {
		const result = policy.decide(input({ type: "ok" }));
		expect((result as { transition: { type: string } }).transition.type).toBe(TRANSITION_TYPE.NEXT);
	});

	it("DP-02: failed outcome → { type: 'fail', error preserved }", () => {
		const error = new Error("step failed");
		const result = policy.decide(input({ type: "failed", error, retryable: false })) as { transition: { type: string; error: Error } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.FAIL);
		expect(result.transition.error).toBe(error);
	});

	it("DP-03: redirect outcome → fail (no routing configured)", () => {
		const result = policy.decide(input({ type: "redirect", message: "somewhere" })) as { transition: { type: string } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.FAIL);
	});

	it("DP-04: reset() is no-op (does not throw)", () => {
		expect(() => policy.reset()).not.toThrow();
	});
});
