/**
 * Testing helpers for consumers writing tests against guidlio-lm.
 *
 * Import from "guidlio-lm/testing" — requires vitest in your devDependencies.
 *
 * @example
 * import { makeMockProvider, makeMockCache } from "guidlio-lm/testing";
 */
export { makeMockProvider } from "./mockProvider";
export { makeMockCache } from "./mockCache";
export { makeMockLogger } from "./mockLogger";
export { makeMockObserver } from "./mockObserver";
export { EchoProvider } from "./echoProvider";
export { makePrompt, makeJsonPrompt } from "./prompts";
export type { MockProviderOptions } from "./mockProvider";

// Note: these helpers return vi.fn()-backed mocks cast to the public interface types.
// Requires vitest in your devDependencies.
