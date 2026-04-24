import type { PromptDefinition } from "../llm-service/prompts-registry/types";

export function makePrompt(
	overrides: Partial<PromptDefinition> & { promptId?: string } = {},
): PromptDefinition {
	return {
		promptId: overrides.promptId ?? "p1",
		version: overrides.version ?? "1",
		userPrompt: overrides.userPrompt ?? "Hello {name}",
		systemPrompt: overrides.systemPrompt,
		modelDefaults: overrides.modelDefaults ?? { model: "mock-model" },
		output: overrides.output ?? { type: "text" },
	};
}

export function makeJsonPrompt(
	overrides: Partial<PromptDefinition> & { promptId?: string } = {},
): PromptDefinition {
	return makePrompt({
		...overrides,
		output: overrides.output ?? { type: "json" },
	});
}
