import { describe, it, expect, beforeEach } from "vitest";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { makePrompt } from "../fixtures/prompts";

describe("PromptRegistry", () => {
	let reg: PromptRegistry;

	beforeEach(() => {
		reg = new PromptRegistry();
	});

	it("PR-01: register then getPrompt by id and version", () => {
		reg.register(makePrompt({ promptId: "p1", version: "1" }));
		const p = reg.getPrompt("p1", "1");
		expect(p).not.toBeNull();
		expect(p?.promptId).toBe("p1");
	});

	it("PR-02: getPrompt without version after registering '1' and '2' returns '2'", () => {
		reg.register(makePrompt({ promptId: "p1", version: "1" }));
		reg.register(makePrompt({ promptId: "p1", version: "2" }));
		const p = reg.getPrompt("p1");
		expect(p?.version).toBe("2");
	});

	it("PR-03: versions '1.0' and '2.0' — parseFloat picks 2.0", () => {
		reg.register(makePrompt({ promptId: "p1", version: "1.0" }));
		reg.register(makePrompt({ promptId: "p1", version: "2.0" }));
		expect(reg.getPrompt("p1")?.version).toBe("2.0");
	});

	it("PR-04: non-integer version string (e.g. 'v1.0') — throws at register time", () => {
		expect(() => reg.register(makePrompt({ promptId: "p1", version: "v1.0" }))).toThrow(
			/must be a non-negative integer/,
		);
	});

	it("PR-05: register same id@version twice — second overwrites; latest recomputed", () => {
		const a = makePrompt({ promptId: "p1", version: "1", userPrompt: "first" });
		const b = makePrompt({ promptId: "p1", version: "1", userPrompt: "second" });
		reg.register(a);
		reg.register(b);
		expect(reg.getPrompt("p1", "1")?.userPrompt).toBe("second");
	});

	it("PR-06: getPrompt for missing id returns null", () => {
		expect(reg.getPrompt("missing")).toBeNull();
	});

	it("PR-07: buildMessages with no system, user only — one-message array", () => {
		const p = makePrompt({ promptId: "p1", version: "1", userPrompt: "Hello" });
		const msgs = PromptRegistry.buildMessages(p);
		expect(msgs).toHaveLength(1);
		expect(msgs[0].role).toBe("user");
	});

	it("PR-08: buildMessages with system + user — both produced; order preserved", () => {
		const p = makePrompt({ promptId: "p1", version: "1", systemPrompt: "You are", userPrompt: "Hello" });
		const msgs = PromptRegistry.buildMessages(p);
		expect(msgs).toHaveLength(2);
		expect(msgs[0].role).toBe("system");
		expect(msgs[1].role).toBe("user");
	});

	it("PR-09: buildMessages with no vars passed but placeholder in template — {name} stays literal", () => {
		const p = makePrompt({ promptId: "p1", version: "1", userPrompt: "Hello {name}" });
		const msgs = PromptRegistry.buildMessages(p);
		expect(msgs[0].content).toBe("Hello {name}");
	});

	it("PR-11: variable with numeric 0 → '0'; null → 'null'; undefined → literal {name}", () => {
		const p = makePrompt({ promptId: "p1", version: "1", userPrompt: "{zero} {nul} {undef}" });
		const msgs = PromptRegistry.buildMessages(p, { zero: 0, nul: null as unknown as undefined });
		expect(msgs[0].content).toBe("0 null {undef}");
	});

	it("PR-12: variable array value → JSON.stringify", () => {
		const p = makePrompt({ promptId: "p1", version: "1", userPrompt: "{arr}" });
		const msgs = PromptRegistry.buildMessages(p, { arr: [1, 2, 3] });
		expect(msgs[0].content).toBe("[1,2,3]");
	});
});
