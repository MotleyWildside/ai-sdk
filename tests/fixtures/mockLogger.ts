import { vi } from "vitest";
import type { LLMLogger } from "../../src/logger/types";

export function makeMockLogger(): LLMLogger & {
	info: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
	debug: ReturnType<typeof vi.fn>;
	llmCall: ReturnType<typeof vi.fn>;
	pipelineEvent: ReturnType<typeof vi.fn>;
} {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		llmCall: vi.fn(),
		pipelineEvent: vi.fn(),
	};
}
