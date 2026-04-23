import { vi } from "vitest";
import type { CacheProvider } from "../../src/llm-service/cache/types";

export function makeMockCache(overrides: Partial<CacheProvider> = {}): CacheProvider & {
	get: ReturnType<typeof vi.fn>;
	set: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
	clear: ReturnType<typeof vi.fn>;
} {
	return {
		get: vi.fn(overrides.get ?? (async () => null)),
		set: vi.fn(overrides.set ?? (async () => {})),
		delete: vi.fn(overrides.delete ?? (async () => {})),
		clear: vi.fn(overrides.clear ?? (async () => {})),
	};
}
