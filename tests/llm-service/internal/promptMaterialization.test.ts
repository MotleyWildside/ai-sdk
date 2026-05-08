import { describe, expect, it } from "vitest";
import { PromptRegistry } from "../../../src/llm-service/prompts-registry/PromptRegistry";
import {
	attachToUserMessage,
	materializeRawPrompt,
	materializeRegisteredPrompt,
	messagesToText,
} from "../../../src/llm-service/internal/promptMaterialization";
import { makePrompt } from "../../fixtures/prompts";

describe("prompt materialization", () => {
	it("resolves registered prompt messages and model from prompt defaults", () => {
		const registry = new PromptRegistry();
		registry.register(
			makePrompt({
				promptId: "pm-1",
				version: "1",
				systemPrompt: "You are {role}",
				userPrompt: "Hello {name}",
				modelDefaults: { model: "prompt-model" },
			}),
		);

		const result = materializeRegisteredPrompt(
			registry,
			{ promptId: "pm-1", variables: { role: "kind", name: "Ada" } },
			"config-model",
		);

		expect(result.model).toBe("prompt-model");
		expect(result.prompt.version).toBe("1");
		expect(result.messages).toEqual([
			{ role: "system", content: "You are kind" },
			{ role: "user", content: "Hello Ada" },
		]);
	});

	it("throws with the existing no-model message when no model can be resolved", () => {
		const registry = new PromptRegistry();
		registry.register(makePrompt({ promptId: "pm-2", version: "1", modelDefaults: { model: "" } }));

		expect(() => materializeRegisteredPrompt(registry, { promptId: "pm-2" }, undefined)).toThrow(
			/No model resolved for prompt "pm-2"/,
		);
	});

	it("materializes raw prompts into system then user messages", () => {
		const result = materializeRawPrompt({
			systemPrompt: "Be brief",
			userPrompt: "Hi",
			model: "raw-model",
		});

		expect(result.model).toBe("raw-model");
		expect(result.messages).toEqual([
			{ role: "system", content: "Be brief" },
			{ role: "user", content: "Hi" },
		]);
	});

	it("attaches images to the final user message as provider content parts", () => {
		const messages = [
			{ role: "user" as const, content: "First" },
			{ role: "assistant" as const, content: "Ok" },
			{ role: "user" as const, content: "Describe this" },
		];

		const result = attachToUserMessage(messages, [
			{ type: "image_url", url: "https://example.com/image.png", detail: "low" },
		]);

		expect(result[0]).toEqual(messages[0]);
		expect(result[2].content).toEqual([
			{ type: "text", text: "Describe this" },
			{
				type: "image_url",
				image_url: { url: "https://example.com/image.png", detail: "low" },
			},
		]);
	});

	it("turns string messages into image prompt text and skips multimodal parts", () => {
		const result = messagesToText([
			{ role: "system", content: "Style guide" },
			{ role: "user", content: [{ type: "text", text: "ignored" }] },
			{ role: "user", content: "Draw a pear" },
		]);

		expect(result).toBe("Style guide\n\nDraw a pear");
	});
});
