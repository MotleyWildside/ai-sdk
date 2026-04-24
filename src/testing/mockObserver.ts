import { vi } from "vitest";
import type { PipelineObserver } from "../orchestrator/observers/PipelineObserver";

export function makeMockObserver(): PipelineObserver {
	return {
		onRunStart: vi.fn(),
		onStepStart: vi.fn(),
		onStepFinish: vi.fn(),
		onRunFinish: vi.fn(),
		onError: vi.fn(),
		onTransition: vi.fn(),
	} as unknown as PipelineObserver;
}
