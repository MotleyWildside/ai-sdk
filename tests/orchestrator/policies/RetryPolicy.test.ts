import { describe, it, expect } from "vitest";
import { RetryPolicy } from "../../../src/orchestrator/policies/RetryPolicy";
import { TRANSITION_TYPE } from "../../../src/orchestrator/constants";
import { BaseContext, PolicyDecisionInput, StepResult } from "../../../src/orchestrator/types";

type Ctx = BaseContext;
const ctx: Ctx = { traceId: "t" };
const traceId = "t";

function failInput(stepName: string, retryable = true, statusCode?: number): PolicyDecisionInput<Ctx> {
	return {
		stepName,
		stepResult: { ctx, outcome: { type: "failed", error: new Error("fail"), retryable, statusCode } },
		traceId,
	};
}

function okInput(stepName: string): PolicyDecisionInput<Ctx> {
	return { stepName, stepResult: { ctx, outcome: { type: "ok" } }, traceId };
}

describe("RetryPolicy", () => {
	it("RP-01: maxAttempts:3, retryable:true — first two yield retry; third yields fail", () => {
		const policy = new RetryPolicy<Ctx>({ maxAttempts: 3 });
		const r1 = policy.decide(failInput("s")) as { transition: { type: string } };
		expect(r1.transition.type).toBe(TRANSITION_TYPE.RETRY);
		const r2 = policy.decide(failInput("s")) as { transition: { type: string } };
		expect(r2.transition.type).toBe(TRANSITION_TYPE.RETRY);
		const r3 = policy.decide(failInput("s")) as { transition: { type: string } };
		expect(r3.transition.type).toBe(TRANSITION_TYPE.FAIL);
	});

	it("RP-02: retryable:false — immediate fail", () => {
		const policy = new RetryPolicy<Ctx>();
		const result = policy.decide(failInput("s", false)) as { transition: { type: string } };
		expect(result.transition.type).toBe(TRANSITION_TYPE.FAIL);
	});

	it("RP-03: custom retryIf — only retries on statusCode:503", () => {
		const policy = new RetryPolicy<Ctx>({
			retryIf: (o) => o.statusCode === 503,
		});
		// statusCode 200 → no retry
		const r1 = policy.decide(failInput("s", true, 200)) as { transition: { type: string } };
		expect(r1.transition.type).toBe(TRANSITION_TYPE.FAIL);
		// statusCode 503 → retry
		policy.reset();
		const r2 = policy.decide(failInput("s", true, 503)) as { transition: { type: string } };
		expect(r2.transition.type).toBe(TRANSITION_TYPE.RETRY);
	});

	it("RP-04: custom backoffMs — delayMs matches formula per attempt", () => {
		const policy = new RetryPolicy<Ctx>({ backoffMs: (attempt) => attempt * 10 });
		const r = policy.decide(failInput("s")) as { transition: { type: string; delayMs?: number } };
		expect(r.transition.type).toBe(TRANSITION_TYPE.RETRY);
		expect(r.transition.delayMs).toBe(10); // attempt 1 → 1 * 10
	});

	it("RP-05: default backoff — attempt 1=100, 2=200", () => {
		const policy = new RetryPolicy<Ctx>({ maxAttempts: 5 });
		const r1 = policy.decide(failInput("s")) as { transition: { type: string; delayMs?: number } };
		expect(r1.transition.delayMs).toBe(100); // 100 * 2^0
		const r2 = policy.decide(failInput("s")) as { transition: { type: string; delayMs?: number } };
		expect(r2.transition.delayMs).toBe(200); // 100 * 2^1
	});

	it("RP-06: reset() clears per-step counters", () => {
		const policy = new RetryPolicy<Ctx>({ maxAttempts: 2 });
		policy.decide(failInput("s"));
		policy.decide(failInput("s")); // exhausted
		policy.reset();
		const r = policy.decide(failInput("s")) as { transition: { type: string } };
		expect(r.transition.type).toBe(TRANSITION_TYPE.RETRY);
	});

	it("RP-07: different steps tracked independently", () => {
		const policy = new RetryPolicy<Ctx>({ maxAttempts: 2 });
		// stepA gets one attempt
		const rA = policy.decide(failInput("stepA")) as { transition: { type: string } };
		expect(rA.transition.type).toBe(TRANSITION_TYPE.RETRY);
		// stepB starts fresh
		const rB = policy.decide(failInput("stepB")) as { transition: { type: string } };
		expect(rB.transition.type).toBe(TRANSITION_TYPE.RETRY);
	});
});
