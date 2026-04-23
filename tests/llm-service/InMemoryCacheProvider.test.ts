import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { InMemoryCacheProvider } from "../../src/llm-service/cache/CacheProvider";

describe("InMemoryCacheProvider", () => {
	let cache: InMemoryCacheProvider;

	beforeEach(() => {
		vi.useFakeTimers();
		cache = new InMemoryCacheProvider();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("IM-01: set then get returns the value", async () => {
		await cache.set("k", { data: 42 });
		const v = await cache.get<{ data: number }>("k");
		expect(v).toEqual({ data: 42 });
	});

	it("IM-02: set with ttl=1s, advance 2s, get returns null and deletes entry", async () => {
		await cache.set("k", "value", 1);
		await vi.advanceTimersByTimeAsync(2000);
		const v = await cache.get("k");
		expect(v).toBeNull();
	});

	it("IM-03: set without ttl never expires; multiple gets succeed", async () => {
		await cache.set("k", "immortal");
		await vi.advanceTimersByTimeAsync(999_999);
		expect(await cache.get("k")).toBe("immortal");
		expect(await cache.get("k")).toBe("immortal");
	});

	it("IM-04: delete makes get return null", async () => {
		await cache.set("k", "v");
		await cache.delete("k");
		expect(await cache.get("k")).toBeNull();
	});

	it("IM-05: clear removes all entries", async () => {
		await cache.set("a", 1);
		await cache.set("b", 2);
		await cache.clear();
		expect(await cache.get("a")).toBeNull();
		expect(await cache.get("b")).toBeNull();
	});

	it("IM-06: overwriting set resets TTL — advance to just before new TTL still present", async () => {
		await cache.set("k", "first", 1);
		// Advance 900ms (< 1s)
		await vi.advanceTimersByTimeAsync(900);
		// Overwrite with 2s TTL
		await cache.set("k", "second", 2);
		// Advance 1500ms — would have expired old entry but not new one
		await vi.advanceTimersByTimeAsync(1500);
		expect(await cache.get("k")).toBe("second");
	});
});
