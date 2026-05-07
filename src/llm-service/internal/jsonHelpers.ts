import { z } from "zod";
import { LLMParseError, LLMSchemaError } from "../errors";

/**
 * Parse raw text as JSON; attempt a repair pass on failure.
 * Throws `LLMParseError` when both the initial parse and the repair fail.
 */
export function parseAndRepairJSON<T>(
	text: string,
	providerName: string,
	model: string,
	promptId?: string,
	requestId?: string,
): T {
	try {
		return parseJSON<T>(text);
	} catch (parseError) {
		try {
			return JSON.parse(repairJSON(text)) as T;
		} catch (repairError) {
			throw new LLMParseError({
				message: `Failed to parse JSON response: ${
					repairError instanceof Error ? repairError.message : String(repairError)
				}`,
				provider: providerName,
				model,
				rawOutput: text,
				promptId,
				requestId,
				cause: parseError instanceof Error ? parseError : undefined,
			});
		}
	}
}

/**
 * Validate a parsed value against a Zod schema.
 * Returns the value unchanged when no schema is provided.
 */
export function validateSchema<T>(
	parsed: T,
	schema: z.ZodSchema<T> | undefined,
	providerName: string,
	model: string,
	promptId?: string,
	requestId?: string,
): T {
	if (!schema) return parsed;

	try {
		return schema.parse(parsed);
	} catch (validationError) {
		if (validationError instanceof z.ZodError) {
			throw new LLMSchemaError({
				message: `Schema validation failed: ${validationError.message}`,
				provider: providerName,
				model,
				validationErrors: validationError.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
				promptId,
				requestId,
				cause: validationError,
			});
		}
		throw validationError;
	}
}

const JSON_INSTRUCTION =
	"IMPORTANT: Return ONLY valid JSON. No markdown, no code fences, no explanatory text.";

/**
 * Return a new messages array with a JSON-output instruction prepended to the system message
 * (or a new system message inserted at position 0 if none exists).
 * Pure — does not mutate the input.
 */
export function enforceJsonInstruction<M extends { role: string; content: unknown }>(
	messages: M[],
): M[] {
	if (messages.length === 0) return messages;

	const systemIdx = messages.findIndex((m) => m.role === "system");
	if (systemIdx !== -1) {
		const updated = [...messages];
		updated[systemIdx] = {
			...updated[systemIdx],
			content: `${String(updated[systemIdx].content)}\n\n${JSON_INSTRUCTION}`,
		};
		return updated;
	}

	return [{ ...messages[0], role: "system", content: JSON_INSTRUCTION } as M, ...messages];
}

/**
 * Parse JSON with a descriptive error message.
 */
function parseJSON<T>(text: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		throw new Error(`JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Repair JSON by stripping markdown fences and extracting the outermost
 * object or array block.
 */
function repairJSON(text: string): string {
	let repaired = text.trim();
	repaired = repaired.replace(/^```(?:json|JSON)?\s*/i, "");
	repaired = repaired.replace(/\s*```\s*$/, "");

	const firstObj = repaired.indexOf("{");
	const firstArr = repaired.indexOf("[");
	const first =
		firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

	if (first === -1) return repaired.trim();

	const openChar = repaired[first];
	const closeChar = openChar === "{" ? "}" : "]";
	const last = repaired.lastIndexOf(closeChar);

	if (last > first) {
		repaired = repaired.substring(first, last + 1);
	}

	return repaired.trim();
}
