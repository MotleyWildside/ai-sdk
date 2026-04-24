import { vi } from "vitest";
import type { LLMLogger } from "../logger/types";

export function makeMockLogger(): LLMLogger {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		llmCall: vi.fn(),
		pipelineEvent: vi.fn(),
	} as unknown as LLMLogger;
}
