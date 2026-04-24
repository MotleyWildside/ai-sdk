import { vi } from "vitest";
import type { CacheProvider } from "../llm-service/cache/types";

export function makeMockCache(overrides: Partial<CacheProvider> = {}): CacheProvider {
	return {
		get: vi.fn(overrides.get ?? (async () => null)) as unknown as CacheProvider["get"],
		set: vi.fn(overrides.set ?? (async () => {})),
		delete: vi.fn(overrides.delete ?? (async () => {})),
		clear: vi.fn(overrides.clear ?? (async () => {})),
	};
}
