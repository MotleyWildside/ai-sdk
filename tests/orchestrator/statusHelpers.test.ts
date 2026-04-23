import { describe, it, expect } from "vitest";
import { ok, failed, redirect } from "../../src/orchestrator/statusHelpers";

type Ctx = { traceId: string; data?: unknown };
const ctx: Ctx = { traceId: "t1" };

describe("statusHelpers", () => {
	it("SH-01: ok({ ctx }) returns correct shape", () => {
		const result = ok({ ctx });
		expect(result.ctx).toBe(ctx);
		expect(result.outcome.type).toBe("ok");
	});

	it("SH-02: failed({ ctx, error }) — retryable:true by default", () => {
		const error = new Error("oops");
		const result = failed({ ctx, error });
		expect(result.outcome.type).toBe("failed");
		if (result.outcome.type === "failed") {
			expect(result.outcome.retryable).toBe(true);
			expect(result.outcome.error).toBe(error);
		}
	});

	it("SH-03: failed({ ctx, error, retryable:false, statusCode:400 }) — all preserved", () => {
		const error = new Error("bad req");
		const result = failed({ ctx, error, retryable: false, statusCode: 400 });
		if (result.outcome.type === "failed") {
			expect(result.outcome.retryable).toBe(false);
			expect(result.outcome.statusCode).toBe(400);
		}
	});

	it("SH-04: redirect({ ctx, message:'x' }) — outcome.message is 'x'", () => {
		const result = redirect({ ctx, message: "x" });
		expect(result.outcome.type).toBe("redirect");
		if (result.outcome.type === "redirect") {
			expect(result.outcome.message).toBe("x");
		}
	});

	it("SH-05: redirect({ ctx }) without message — outcome.message undefined", () => {
		const result = redirect({ ctx });
		if (result.outcome.type === "redirect") {
			expect(result.outcome.message).toBeUndefined();
		}
	});
});
