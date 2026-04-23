import { describe, it, expect } from "vitest";
import { RedirectRoutingPolicy } from "../../../src/orchestrator/policies/RedirectRoutingPolicy";
import { TRANSITION_TYPE } from "../../../src/orchestrator/constants";
import { BaseContext, PolicyDecisionInput } from "../../../src/orchestrator/types";

type Ctx = BaseContext;
const ctx: Ctx = { traceId: "t" };
const traceId = "t";

function input(message: string | undefined): PolicyDecisionInput<Ctx> {
	return {
		stepName: "step",
		stepResult: { ctx, outcome: { type: "redirect", message } },
		traceId,
	};
}

function okInput(): PolicyDecisionInput<Ctx> {
	return { stepName: "step", stepResult: { ctx, outcome: { type: "ok" } }, traceId };
}

function failInput(): PolicyDecisionInput<Ctx> {
	return {
		stepName: "step",
		stepResult: { ctx, outcome: { type: "failed", error: new Error("fail"), retryable: false } },
		traceId,
	};
}

describe("RedirectRoutingPolicy", () => {
	const policy = new RedirectRoutingPolicy<Ctx>({ classify: "stepB", handle: "stepC" });

	it("RR-01: redirect with known message → goto stepB", () => {
		const result = policy.decide(input("classify")) as { transition: { type: string; stepName?: string } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.GOTO);
		expect(result.transition.stepName).toBe("stepB");
	});

	it("RR-02: redirect with unknown message → fail with descriptive error listing known keys", () => {
		const result = policy.decide(input("unknown-route")) as { transition: { type: string; error: Error } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.FAIL);
		expect(result.transition.error.message).toContain("classify");
		expect(result.transition.error.message).toContain("handle");
	});

	it("RR-03: ok falls through to DefaultPolicy → next", () => {
		const result = policy.decide(okInput()) as { transition: { type: string } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.NEXT);
	});

	it("RR-03b: failed falls through to DefaultPolicy → fail", () => {
		const result = policy.decide(failInput()) as { transition: { type: string } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.FAIL);
	});

	it("RR-04: undefined message → fail (empty key lookup)", () => {
		const result = policy.decide(input(undefined)) as { transition: { type: string } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.FAIL);
	});
});
