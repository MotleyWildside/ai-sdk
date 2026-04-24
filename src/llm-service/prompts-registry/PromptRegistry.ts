import type { PromptDefinition } from "./types";

/**
 * Prompt Registry for managing versioned prompts with variable interpolation
 */
export class PromptRegistry {
	private prompts: Map<string, PromptDefinition> = new Map();
	private latestPrompts: Map<string, PromptDefinition> = new Map();

	/**
	 * Register a prompt definition
	 */
	register(prompt: PromptDefinition): void {
		const v = prompt.version;
		const n = typeof v === "number" ? v : Number(v);
		if (!Number.isInteger(n) || n < 0) {
			throw new Error(
				`Prompt version must be a non-negative integer; got "${v}" for prompt "${prompt.promptId}". ` +
					`Semver strings (e.g. "1.2.3") are not supported — use monotonically increasing integers instead.`,
			);
		}

		const key = this.getKey(prompt.promptId, prompt.version);
		this.prompts.set(key, prompt);

		// Update latest version index
		const currentLatest = this.latestPrompts.get(prompt.promptId);
		if (!currentLatest || this.isNewer(prompt.version, currentLatest.version)) {
			this.latestPrompts.set(prompt.promptId, prompt);
		}
	}

	/**
	 * Get a prompt by ID and optional version (defaults to latest)
	 */
	getPrompt(promptId: string, version?: string | number): PromptDefinition | null {
		if (version !== undefined) {
			const key = this.getKey(promptId, version);
			return this.prompts.get(key) || null;
		}

		return this.latestPrompts.get(promptId) || null;
	}

	/**
	 * Build messages array from prompt definition and variables
	 */
	buildMessages(
		prompt: PromptDefinition,
		variables?: Record<string, unknown>,
	): Array<{ role: "system" | "user" | "assistant"; content: string }> {
		const messages: Array<{
			role: "system" | "user" | "assistant";
			content: string;
		}> = [];

		// Add system message if present
		if (prompt.systemPrompt) {
			messages.push({
				role: "system",
				content: this.interpolate(prompt.systemPrompt, variables),
			});
		}

		// Add user message if present
		if (prompt.userPrompt) {
			messages.push({
				role: "user",
				content: this.interpolate(prompt.userPrompt, variables),
			});
		}

		return messages;
	}

	/**
	 * Interpolate variables in template string
	 * Supports {variableName} syntax
	 */
	private interpolate(template: string, variables?: Record<string, unknown>): string {
		if (!variables) {
			return template;
		}

		return template.replace(/\{(\w+)\}/g, (match, key) => {
			const value = variables[key];
			if (value === undefined) {
				return match; // Keep original if variable not found
			}
			// Convert to string, handling objects/arrays
			if (typeof value === "object" && value !== null) {
				return JSON.stringify(value);
			}
			return String(value);
		});
	}

	/**
	 * Generate a key for storing prompts
	 */
	private getKey(promptId: string, version: string | number): string {
		return `${promptId}@${version}`;
	}

	private isNewer(v1: string | number, v2: string | number): boolean {
		return Number(v1) > Number(v2);
	}

	/**
	 * Get all registered prompts (for debugging/inspection)
	 */
	getAllPrompts(): PromptDefinition[] {
		return Array.from(this.prompts.values());
	}

	/**
	 * Clear all registered prompts (for testing)
	 */
	clear(): void {
		this.prompts.clear();
		this.latestPrompts.clear();
	}
}
