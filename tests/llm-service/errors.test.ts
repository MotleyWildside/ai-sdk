import { describe, it, expect } from "vitest";
import {
	LLMError,
	LLMTransientError,
	LLMPermanentError,
	LLMParseError,
	LLMSchemaError,
} from "../../src/llm-service/errors";

describe("LLM Error classes", () => {
	it("ER-01a: LLMError is an instance of Error with correct name", () => {
		const e = new LLMError("msg", "provider", "model");
		expect(e).toBeInstanceOf(Error);
		expect(e).toBeInstanceOf(LLMError);
		expect(e.name).toBe("LLMError");
		expect(e.provider).toBe("provider");
		expect(e.model).toBe("model");
	});

	it("ER-01b: LLMTransientError extends LLMError", () => {
		const e = new LLMTransientError("msg", "prov", "model");
		expect(e).toBeInstanceOf(LLMError);
		expect(e).toBeInstanceOf(LLMTransientError);
		expect(e.name).toBe("LLMTransientError");
	});

	it("ER-01c: LLMPermanentError extends LLMError", () => {
		const e = new LLMPermanentError("msg", "prov", "model");
		expect(e).toBeInstanceOf(LLMError);
		expect(e).toBeInstanceOf(LLMPermanentError);
		expect(e.name).toBe("LLMPermanentError");
	});

	it("ER-01d: LLMParseError extends LLMError with rawOutput", () => {
		const e = new LLMParseError("msg", "prov", "model", "bad output");
		expect(e).toBeInstanceOf(LLMError);
		expect(e).toBeInstanceOf(LLMParseError);
		expect(e.name).toBe("LLMParseError");
		expect(e.rawOutput).toBe("bad output");
	});

	it("ER-01e: LLMSchemaError extends LLMError with validationErrors", () => {
		const e = new LLMSchemaError("msg", "prov", "model", ["field: required"]);
		expect(e).toBeInstanceOf(LLMError);
		expect(e).toBeInstanceOf(LLMSchemaError);
		expect(e.name).toBe("LLMSchemaError");
		expect(e.validationErrors).toEqual(["field: required"]);
	});

	it("ER-02: LLMParseError.rawOutput and LLMSchemaError.validationErrors are preserved", () => {
		const raw = "raw garbage";
		const errs = ["path.field: required", "path.other: invalid"];
		const pe = new LLMParseError("msg", "p", "m", raw);
		const se = new LLMSchemaError("msg", "p", "m", errs);
		expect(pe.rawOutput).toBe(raw);
		expect(se.validationErrors).toEqual(errs);
	});

	it("ER-04: instanceof distinguishes LLMTransientError from LLMPermanentError", () => {
		const te = new LLMTransientError("t", "p", "m");
		const pe = new LLMPermanentError("p", "p", "m");
		expect(te instanceof LLMTransientError).toBe(true);
		expect(te instanceof LLMPermanentError).toBe(false);
		expect(pe instanceof LLMPermanentError).toBe(true);
		expect(pe instanceof LLMTransientError).toBe(false);
	});
});
