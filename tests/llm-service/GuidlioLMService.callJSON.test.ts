import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { GuidlioLMService } from "../../src/llm-service/GuidlioLMService";
import { PromptRegistry } from "../../src/llm-service/prompts-registry/PromptRegistry";
import { LLMParseError, LLMSchemaError } from "../../src/llm-service/errors";
import { makeMockProvider } from "../fixtures/mockProvider";
import { makePrompt, makeJsonPrompt } from "../fixtures/prompts";

describe("GuidlioLMService — callJSON", () => {
	let reg: PromptRegistry;

	beforeEach(() => {
		reg = new PromptRegistry();
	});

	function makeJsonService(callResponse: string) {
		const provider = makeMockProvider({
			callImpl: async () => ({
				text: callResponse,
				raw: {},
				usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
				finishReason: "stop",
			}),
		});
		const svc = new GuidlioLMService({ providers: [provider], promptRegistry: reg });
		return { provider, svc };
	}

	it("J-01: throws when prompt.output.type is 'text'", async () => {
		reg.register(makePrompt({ promptId: "j1", version: "1", output: { type: "text" } }));
		const { svc } = makeJsonService("{}");
		await expect(svc.callJSON({ promptId: "j1" })).rejects.toThrow(/not configured for JSON output/);
	});

	it("J-02: appends JSON instruction when last message is user and no instruction present", async () => {
		reg.register(makeJsonPrompt({ promptId: "j2", version: "1", userPrompt: "Classify this" }));
		const { svc, provider } = makeJsonService('{"ok":true}');
		await svc.callJSON({ promptId: "j2" });
		const [req] = provider.call.mock.calls[0];
		const lastMsg = req.messages[req.messages.length - 1];
		expect(lastMsg.content).toContain("ONLY valid JSON");
	});

	it("J-03: does not append instruction when message already contains 'valid JSON'", async () => {
		reg.register(makeJsonPrompt({ promptId: "j3", version: "1", userPrompt: "Return only valid JSON please" }));
		const { svc, provider } = makeJsonService('{"ok":true}');
		await svc.callJSON({ promptId: "j3" });
		const [req] = provider.call.mock.calls[0];
		const lastMsg = req.messages[req.messages.length - 1];
		// Count occurrences of 'valid JSON' — should be exactly 1
		const matches = (lastMsg.content.match(/valid JSON/g) || []).length;
		expect(matches).toBe(1);
	});

	it("J-04: does not append instruction when last message is system (only systemPrompt, no userPrompt)", async () => {
		// The enforceJsonInstruction no-ops when the last message is not user role.
		// With only a systemPrompt and no userPrompt, there are no messages actually
		// (buildMessages skips undefined prompts). Verify the instruction is not appended.
		// We test via the internal function directly, since an empty message array
		// means the provider call receives an empty array.
		const { enforceJsonInstruction } = await import("../../src/llm-service/internal/jsonHelpers");
		const msgs = [{ role: "system" as const, content: "You are a bot" }];
		const original = msgs[0].content;
		enforceJsonInstruction(msgs);
		expect(msgs[0].content).toBe(original);
	});

	it("J-05: pure valid JSON from provider — .data is the parsed object", async () => {
		reg.register(makeJsonPrompt({ promptId: "j5", version: "1" }));
		const { svc } = makeJsonService('{"key":"value","num":42}');
		const result = await svc.callJSON({ promptId: "j5" });
		expect(result.data).toEqual({ key: "value", num: 42 });
	});

	it("J-06: JSON wrapped in ```json fences — repairJSON strips them", async () => {
		reg.register(makeJsonPrompt({ promptId: "j6", version: "1" }));
		const { svc } = makeJsonService('```json\n{"key":"value"}\n```');
		const result = await svc.callJSON({ promptId: "j6" });
		expect(result.data).toEqual({ key: "value" });
	});

	it("J-07: preamble + JSON + trailing commentary — repairJSON extracts block", async () => {
		reg.register(makeJsonPrompt({ promptId: "j7", version: "1" }));
		const { svc } = makeJsonService('Here is the result:\n{"x":1}\nThat is all.');
		const result = await svc.callJSON({ promptId: "j7" });
		expect(result.data).toEqual({ x: 1 });
	});

	it("J-08: unrepairable garbage throws LLMParseError with rawOutput set", async () => {
		reg.register(makeJsonPrompt({ promptId: "j8", version: "1" }));
		const { svc } = makeJsonService("this is not json at all!!!");
		await expect(svc.callJSON({ promptId: "j8" })).rejects.toThrow(LLMParseError);
		try {
			await svc.callJSON({ promptId: "j8" });
		} catch (e) {
			expect(e).toBeInstanceOf(LLMParseError);
			expect((e as LLMParseError).rawOutput).toBe("this is not json at all!!!");
		}
	});

	it("J-09: Zod schema mismatch throws LLMSchemaError with validationErrors", async () => {
		reg.register(makeJsonPrompt({ promptId: "j9", version: "1" }));
		const { svc } = makeJsonService('{"name":123}');
		const schema = z.object({ name: z.string() });
		await expect(svc.callJSON({ promptId: "j9", jsonSchema: schema })).rejects.toThrow(LLMSchemaError);
		try {
			await svc.callJSON({ promptId: "j9", jsonSchema: schema });
		} catch (e) {
			expect(e).toBeInstanceOf(LLMSchemaError);
			expect((e as LLMSchemaError).validationErrors).toBeInstanceOf(Array);
			expect((e as LLMSchemaError).validationErrors.length).toBeGreaterThan(0);
		}
	});

	it("J-10: no schema — returns parsed object without validation", async () => {
		reg.register(makeJsonPrompt({ promptId: "j10", version: "1" }));
		const { svc } = makeJsonService('{"anything":true}');
		const result = await svc.callJSON({ promptId: "j10" });
		expect(result.data).toEqual({ anything: true });
	});

	it("J-11: prompt.output.schema used when params.jsonSchema absent", async () => {
		const schema = z.object({ name: z.string() });
		reg.register(makeJsonPrompt({ promptId: "j11", version: "1", output: { type: "json", schema } }));
		const { svc } = makeJsonService('{"name":"Alice"}');
		const result = await svc.callJSON({ promptId: "j11" });
		expect((result.data as { name: string }).name).toBe("Alice");
	});

	it("J-12: params.jsonSchema overrides prompt.output.schema", async () => {
		const promptSchema = z.object({ x: z.number() });
		const paramsSchema = z.object({ y: z.string() });
		reg.register(makeJsonPrompt({ promptId: "j12", version: "1", output: { type: "json", schema: promptSchema } }));
		const { svc } = makeJsonService('{"y":"hello"}');
		// If paramsSchema wins, this should parse OK (promptSchema would fail)
		const result = await svc.callJSON({ promptId: "j12", jsonSchema: paramsSchema });
		expect((result.data as { y: string }).y).toBe("hello");
	});

	it("J-13: strict Zod with extra fields — Zod strips or fails per its default", async () => {
		reg.register(makeJsonPrompt({ promptId: "j13", version: "1" }));
		const schema = z.object({ name: z.string() });
		const { svc } = makeJsonService('{"name":"Bob","extra":"field"}');
		// Zod's default (non-strict) strips unknown fields
		const result = await svc.callJSON({ promptId: "j13", jsonSchema: schema });
		expect((result.data as { name: string }).name).toBe("Bob");
	});
});
