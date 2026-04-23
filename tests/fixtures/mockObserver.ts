import { vi } from "vitest";
import type { PipelineObserver } from "../../src/orchestrator/observers/PipelineObserver";

export function makeMockObserver(): PipelineObserver & {
	onRunStart: ReturnType<typeof vi.fn>;
	onStepStart: ReturnType<typeof vi.fn>;
	onStepFinish: ReturnType<typeof vi.fn>;
	onRunFinish: ReturnType<typeof vi.fn>;
	onError: ReturnType<typeof vi.fn>;
	onTransition: ReturnType<typeof vi.fn>;
} {
	return {
		onRunStart: vi.fn(),
		onStepStart: vi.fn(),
		onStepFinish: vi.fn(),
		onRunFinish: vi.fn(),
		onError: vi.fn(),
		onTransition: vi.fn(),
	};
}
