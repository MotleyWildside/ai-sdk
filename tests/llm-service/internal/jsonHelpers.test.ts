import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
	parseAndRepairJSON,
	validateSchema,
	enforceJsonInstruction,
} from "../../../src/llm-service/internal/jsonHelpers";
import { LLMParseError, LLMSchemaError } from "../../../src/llm-service/errors";

describe("parseAndRepairJSON", () => {
	it("JH-01: pure valid JSON parsed directly", () => {
		const result = parseAndRepairJSON<{ x: number }>('{"x":1}', "p", "m", "pid");
		expect(result).toEqual({ x: 1 });
	});

	it("JH-02: invalid JSON → repairJSON → parsed", () => {
		const result = parseAndRepairJSON<{ x: number }>('preamble {"x":2} suffix', "p", "m", "pid");
		expect(result).toEqual({ x: 2 });
	});

	it("JH-03: strips ```json fences", () => {
		const result = parseAndRepairJSON<{ y: string }>('```json\n{"y":"hello"}\n```', "p", "m", "pid");
		expect(result).toEqual({ y: "hello" });
	});

	it("JH-04: strips ``` fences (no language tag)", () => {
		const result = parseAndRepairJSON<{ z: boolean }>('```\n{"z":true}\n```', "p", "m", "pid");
		expect(result).toEqual({ z: true });
	});

	it("JH-05: extracts [...] (array root)", () => {
		const result = parseAndRepairJSON<number[]>('prefix [1,2,3] suffix', "p", "m", "pid");
		expect(result).toEqual([1, 2, 3]);
	});

	it("JH-06: extracts first { to last } block, stripping leading/trailing prose", () => {
		const result = parseAndRepairJSON<{ a: number }>('Here: {"a":99} done.', "p", "m", "pid");
		expect(result).toEqual({ a: 99 });
	});

	it("JH-07: text with no braces → repair fails → throws LLMParseError", () => {
		expect(() => parseAndRepairJSON("totally not json", "p", "m", "pid")).toThrow(LLMParseError);
	});

	it("JH-08: garbage → throws LLMParseError with rawOutput set", () => {
		try {
			parseAndRepairJSON("!!!garbage!!!", "prov", "mod", "prompt");
		} catch (e) {
			expect(e).toBeInstanceOf(LLMParseError);
			expect((e as LLMParseError).rawOutput).toBe("!!!garbage!!!");
		}
	});
});

describe("validateSchema", () => {
	it("JH-08b: no schema — returns parsed as-is", () => {
		const result = validateSchema({ x: 1 }, undefined, "p", "m", "pid");
		expect(result).toEqual({ x: 1 });
	});

	it("JH-09: failing Zod schema throws LLMSchemaError with validationErrors formatted", () => {
		const schema = z.object({ name: z.string() });
		expect(() => validateSchema({ name: 123 }, schema, "prov", "mod", "pid")).toThrow(LLMSchemaError);
		try {
			validateSchema({ name: 123 }, schema, "prov", "mod", "pid");
		} catch (e) {
			expect(e).toBeInstanceOf(LLMSchemaError);
			const errs = (e as LLMSchemaError).validationErrors;
			expect(errs).toBeInstanceOf(Array);
			expect(errs[0]).toMatch(/name.*Expected string/i);
		}
	});
});

describe("enforceJsonInstruction", () => {
	it("JH-10: appends instruction to last user message", () => {
		const msgs = [{ role: "user" as const, content: "Classify this" }];
		enforceJsonInstruction(msgs);
		expect(msgs[0].content).toContain("ONLY valid JSON");
	});

	it("JH-10b: idempotent — does not re-append if already instructed", () => {
		const msgs = [{ role: "user" as const, content: "Return ONLY JSON format" }];
		enforceJsonInstruction(msgs);
		enforceJsonInstruction(msgs);
		const count = (msgs[0].content.match(/ONLY|valid JSON|JSON format/g) || []).length;
		expect(count).toBeGreaterThanOrEqual(1);
		// Ensure no double instruction
		expect(msgs[0].content.indexOf("ONLY valid JSON")).toBe(-1);
	});

	it("JH-11: last message is system — no-op", () => {
		const msgs = [{ role: "system" as const, content: "You are a bot" }];
		const original = msgs[0].content;
		enforceJsonInstruction(msgs);
		expect(msgs[0].content).toBe(original);
	});

	it("JH-11b: empty messages array — no-op", () => {
		const msgs: { role: "user"; content: string }[] = [];
		expect(() => enforceJsonInstruction(msgs)).not.toThrow();
	});
});
