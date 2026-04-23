# Unit Test Plan — `guidlio-lm`

Comprehensive vitest-based test plan for the two core subsystems: `GuidlioLMService` and `GuidlioOrchestrator`. Every scenario below maps to a concrete branch, error path, or documented behavior in the source (with file refs). The goal is ≥90% line coverage on `src/llm-service/` and `src/orchestrator/`, and 100% coverage of the public API surface in [src/index.ts](src/index.ts).

---

## 1. Setup & Tooling

### 1.1 Dependencies to add
```bash
npm i -D vitest @vitest/coverage-v8
```

### 1.2 `package.json` scripts
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

### 1.3 `vitest.config.ts`
- `test.globals: false` (import `describe`/`it`/`expect` explicitly — keeps ESLint honest).
- `test.environment: 'node'` (no jsdom needed).
- `coverage.provider: 'v8'`, include `src/**`, exclude `src/**/examples/**` and `src/**/index.ts` barrels from coverage thresholds.
- `coverage.thresholds: { lines: 90, branches: 85, functions: 90 }`.
- `test.setupFiles: ['./tests/setup.ts']` — installs global SDK mocks (see §1.5).

### 1.4 Directory layout
```
tests/
  setup.ts
  fixtures/
    prompts.ts              # reusable PromptDefinition fixtures
    mockProvider.ts         # MockLLMProvider (spyable, scriptable) — the "custom provider" IS this
    mockCache.ts            # scriptable CacheProvider
    mockObserver.ts         # scriptable PipelineObserver
    customPolicy.ts         # hand-written policy for tests
    echoProvider.ts         # fully-fledged user-style provider for contract tests
  llm-service/
    GuidlioLMService.call.test.ts
    GuidlioLMService.callJSON.test.ts
    GuidlioLMService.callStream.test.ts
    GuidlioLMService.embed.test.ts
    GuidlioLMService.cache.test.ts
    GuidlioLMService.retry.test.ts
    GuidlioLMService.providerSelection.test.ts
    GuidlioLMService.multiProvider.test.ts
    GuidlioLMService.hooks.test.ts
    PromptRegistry.test.ts
    InMemoryCacheProvider.test.ts
    internal/
      cacheKey.test.ts
      jsonHelpers.test.ts
      retry.test.ts
      providerSelection.test.ts
    errors.test.ts
  orchestrator/
    GuidlioOrchestrator.run.test.ts
    GuidlioOrchestrator.transitions.test.ts
    GuidlioOrchestrator.exceptions.test.ts
    GuidlioOrchestrator.context.test.ts
    GuidlioOrchestrator.abort.test.ts
    GuidlioOrchestrator.observer.test.ts
    GuidlioOrchestrator.definitionErrors.test.ts
    policies/
      DefaultPolicy.test.ts
      RetryPolicy.test.ts
      RedirectRoutingPolicy.test.ts
      CustomPolicy.integration.test.ts
    statusHelpers.test.ts
    observers/
      LoggerPipelineObserver.test.ts
      NoopPipelineObserver.test.ts
  integration/
    gateway-with-orchestrator.test.ts
    public-api-surface.test.ts
```

### 1.5 Provider strategy
Do NOT test `OpenAIProvider`, `GeminiProvider`, or `OpenRouterProvider` directly — that would require mocking three different third-party SDKs and would just be testing their adapters, not our logic.

Instead, all `GuidlioLMService` tests use **`MockLLMProvider`** (in `fixtures/mockProvider.ts`) — a scriptable, spyable implementation of the `LLMProvider` interface with `vi.fn()` on every method. This is the "custom provider" for service-layer testing.

For **multi-provider scenarios** (§2.9, §2.15), instantiate two independent `MockLLMProvider` instances with different names and `supportsModel` predicates — call them "providerA" and "providerB" throughout tests. This exercises all selection and fallback logic without SDK coupling.

`tests/setup.ts` needs no global SDK mocks — just shared fixture helpers re-exported for convenience.

### 1.6 Fake timers
Retry/backoff tests and `retry` transition `delayMs` tests need `vi.useFakeTimers()`. Remember to:
- `await vi.advanceTimersByTimeAsync(ms)` between attempts (not `advanceTimersByTime` — retries use real async `sleep`).
- Reset with `vi.useRealTimers()` in `afterEach`.

### 1.7 Test fixtures — key shapes
- **`makePrompt({ promptId='p1', version='1', output={ type: 'text' }, systemPrompt?, userPrompt?, modelDefaults? })`** — builder for `PromptDefinition`.
- **`makeMockProvider({ name='mock', supports=[/.*/] , callImpl?, streamImpl?, embedImpl? })`** — returns object satisfying `LLMProvider`.
- **`makeMockLogger()`** — `{ debug, info, warn, error, llmCall, pipelineEvent }` all as `vi.fn()`.
- **`makeMockObserver()`** — `{ onRunStart, onStepStart, onStepFinish, onRunFinish, onError, onTransition }` all `vi.fn()`.

---

## 2. `GuidlioLMService` Test Suites

### 2.1 Constructor & configuration
File: [`llm-service/GuidlioLMService.call.test.ts`](tests/llm-service/GuidlioLMService.call.test.ts) (constructor block)

| # | Scenario | Expectation |
|---|---|---|
| C-01 | `providers: []` | Throws a descriptive error (see [GuidlioLMService.ts:53-67](src/llm-service/GuidlioLMService.ts#L53-L67)). |
| C-02 | Two providers share the same `name` | Second overwrites first in the Map (document current behavior; if treated as programmer error, test the throw). |
| C-03 | No `cacheProvider` supplied | Defaults to `InMemoryCacheProvider` instance. |
| C-04 | No `promptRegistry` supplied | Defaults to fresh `PromptRegistry`; prompts registered on it are usable. |
| C-05 | `logger` omitted | Service still functions; no throws when logging is attempted internally. |
| C-06 | `defaultProvider='openai'` with only `gemini` registered | Construction succeeds (fallback happens at call-time, not construction). |
| C-07 | Full config (all optional fields) round-trips | Getters (if any) or subsequent behavior reflects the passed values. |

### 2.2 `callText` — happy path & parameter resolution
File: [`llm-service/GuidlioLMService.call.test.ts`](tests/llm-service/GuidlioLMService.call.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| T-01 | Registered prompt `p1@1`, text output, user message only | Provider's `call()` receives messages built by `PromptRegistry.buildMessages`; result `.text` matches provider response. |
| T-02 | Prompt with `systemPrompt` + `userPrompt` | `messages` array length 2, correct roles and order. |
| T-03 | Variable interpolation: string, number `0`, boolean | All rendered as `String(v)`; `0` stays `"0"`. |
| T-04 | Variable interpolation: object value | Rendered as `JSON.stringify(value)`. |
| T-05 | Variable interpolation: missing variable | `{name}` stays literal in rendered content. |
| T-06 | `params.model` overrides `prompt.modelDefaults.model` & `config.defaultModel` | Provider receives `params.model`. |
| T-07 | `params.model` absent, `prompt.modelDefaults.model` set | Provider receives prompt default. |
| T-08 | Only `config.defaultModel` set | Provider receives config default. |
| T-09 | No model anywhere | Throws (see [GuidlioLMService.ts:390-393](src/llm-service/GuidlioLMService.ts#L390-L393)). |
| T-10 | Temperature precedence: `params ?? prompt.modelDefaults ?? config.default ?? 0.7` | Each of the four tiers exercised independently with fake providers asserting the forwarded temperature. |
| T-11 | `maxTokens`, `topP`, `seed` forwarded unchanged (and left `undefined` when absent) | Provider request matches exactly. |
| T-12 | `signal` forwarded to provider | Provider receives same `AbortSignal` instance. |
| T-13 | `traceId` provided by caller | Returned in `result.traceId` unchanged. |
| T-14 | `traceId` absent | Returned trace ID matches `/^trace_[0-9a-f-]+$/` (see [GuidlioLMService.ts:462-464](src/llm-service/GuidlioLMService.ts#L462-L464)). |
| T-15 | `durationMs` present and `>= 0` on result | Usually assert `typeof === 'number'`. |
| T-16 | Prompt not found (`getPrompt` returns null) | Throws `Error("prompt not found")` (or equivalent — see [GuidlioLMService.ts:378-381](src/llm-service/GuidlioLMService.ts#L378-L381)). |
| T-17 | `promptVersion` specified and exists | Uses that specific version; the "latest" version is NOT picked. |
| T-18 | `promptVersion` omitted | Uses the registry's latest. |
| T-19 | Logger receives `llmCall` event with `success: true`, `usage`, `cached: false`, `promptId`, `model`. | |

### 2.3 `callJSON`
File: [`llm-service/GuidlioLMService.callJSON.test.ts`](tests/llm-service/GuidlioLMService.callJSON.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| J-01 | Prompt `output.type === 'text'` called via `callJSON` | Throws (contract violation — see [GuidlioLMService.ts:97-101](src/llm-service/GuidlioLMService.ts#L97-L101)). |
| J-02 | Last message is user; does NOT contain "ONLY JSON" | JSON instruction appended to content. |
| J-03 | Last message already contains "valid JSON" | No duplicate append. |
| J-04 | Last message role ≠ user | No instruction appended (no-op, see [jsonHelpers.ts:76-95](src/llm-service/internal/jsonHelpers.ts#L76-L95)). |
| J-05 | Provider returns pure valid JSON | `.data` is the parsed object. |
| J-06 | Provider wraps output in ```` ```json ... ``` ```` fences | `repairJSON` strips fences; parse succeeds. |
| J-07 | Provider returns preamble + `{...}` + trailing commentary | Extracted by `repairJSON`; parse succeeds. |
| J-08 | Unrepairable garbage | Throws `LLMParseError` with `.rawOutput` set to provider text and `.provider`/`.model`/`.promptId` populated. |
| J-09 | `params.jsonSchema` (Zod) mismatch | Throws `LLMSchemaError` with `.validationErrors` = array of `"path: message"`. |
| J-10 | No schema on params, no schema on prompt | Returns parsed object without validation. |
| J-11 | `prompt.output.schema` present, `params.jsonSchema` absent | Uses prompt schema. |
| J-12 | `params.jsonSchema` wins over `prompt.output.schema` | Conflict resolves to params. |
| J-13 | Valid JSON with extra fields, strict Zod | Passes or fails per Zod rules (assert behavior to lock it in). |
| J-14 | `.data` is typed per generic `T` (TS-level) | Compile-time assertion file. |

### 2.4 `callStream`
File: [`llm-service/GuidlioLMService.callStream.test.ts`](tests/llm-service/GuidlioLMService.callStream.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| S-01 | Basic stream yields chunks with accumulated `text` and incremental `delta` | For-await produces the scripted chunks in order. |
| S-02 | `params.cache` provided | Logger emits `warn` about cache being ignored; provider still called (see [GuidlioLMService.ts:136-140](src/llm-service/GuidlioLMService.ts#L136-L140)). |
| S-03 | `params.idempotencyKey` provided | Same warn behavior. |
| S-04 | Provider throws `LLMTransientError` | Error propagates immediately; **no retry** (stream bypasses retries — see [GuidlioLMService.ts:128](src/llm-service/GuidlioLMService.ts#L128)). |
| S-05 | Stream consumer passes `AbortSignal` that fires mid-stream | Upstream provider receives signal; iterator terminates. |
| S-06 | Result exposes `traceId`, `promptId`, `promptVersion`, `model` but no `durationMs` | Type assertion + runtime assertion. |
| S-07 | Logger emits event at stream start and on error | Assert `llmCall` event shape. |

### 2.5 `embed` / `embedBatch`
File: [`llm-service/GuidlioLMService.embed.test.ts`](tests/llm-service/GuidlioLMService.embed.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| E-01 | `embed` with provider supporting it | Returns `{ embedding: number[], usage, model }`. |
| E-02 | `embedBatch` with 10 texts | Returns `embeddings: number[][]` length 10. |
| E-03 | `dimensions` forwarded to provider request | Provider mock asserts. |
| E-04 | `taskType` forwarded | Provider mock asserts. |
| E-05 | Provider that throws on `embed` (OpenRouter-style) | Error wrapping preserves original message. |
| E-06 | Transient error on `embed` | Retried up to `maxAttempts` (embed path also goes through `callWithRetries`). |
| E-07 | Embed does NOT interact with cache or prompt registry | Mock cache `get`/`set` never called; no prompt lookup. |

### 2.6 Caching (read_through / bypass / refresh)
File: [`llm-service/GuidlioLMService.cache.test.ts`](tests/llm-service/GuidlioLMService.cache.test.ts)

Use a scriptable `MockCacheProvider` with `vi.fn()` spies on all four methods.

| # | Scenario | Expectation |
|---|---|---|
| CA-01 | `cache: { mode: 'read_through', ttlSeconds: 60 }`, hit | Provider `call` NOT invoked; result `.text` equals cached; `durationMs` recomputed; `requestId: undefined`; logger reports `cached: true`. |
| CA-02 | `read_through`, miss | Provider called; cache `set` invoked with `ttlSeconds * 1000` milliseconds. |
| CA-03 | `cache: { mode: 'bypass' }` | Cache `get` NOT called; cache `set` NOT called. |
| CA-04 | `cache: { mode: 'refresh', ttlSeconds: 60 }` | Cache `get` NOT called; provider called; cache `set` called afterward. |
| CA-05 | `mode: 'read_through'` but **no `ttlSeconds`** | Cache `get` still called (read allowed), but `set` skipped on miss — see [GuidlioLMService.ts:448-460](src/llm-service/GuidlioLMService.ts#L448-L460). |
| CA-06 | `mode: 'refresh'` but no `ttlSeconds` | `set` skipped. |
| CA-07 | `config.enableCache: false` + `params.cache` set | Neither read nor write happens (see [GuidlioLMService.ts:435-443](src/llm-service/GuidlioLMService.ts#L435-L443)). |
| CA-08 | `params.cache` omitted | Neither read nor write. |
| CA-09 | `ttlSeconds: 0` | Treated as falsy → **no write**. Document this (footgun for 0-second caching). |
| CA-10 | Cache key stability: two identical calls produce same key | Assert by spying on `cache.get`. |
| CA-11 | Cache key differs when `temperature` changes `0 → 0.1` | Different keys. |
| CA-12 | Cache key differs for `temperature: 0` vs `temperature: undefined` | **Distinct** (0 is not unset — see [cacheKey.ts](src/llm-service/internal/cacheKey.ts)). |
| CA-13 | Cache key differs across prompt versions | `v1` vs `v2` same id → distinct keys. |
| CA-14 | Cache key differs when `variables` payload differs | Same prompt, different variables → distinct. |
| CA-15 | Cache key differs when `jsonSchema` fingerprint differs | Two Zod schemas with different `_def` → distinct; identical schemas → same. |
| CA-16 | Cache write failure (cache `set` rejects) | Does NOT fail the call; error is logged/swallowed. *(Verify intended behavior — if it currently bubbles, file that as a behavior note.)* |
| CA-17 | Cached result is type-safe for `callJSON` | `.data` still typed as `T` on hit (serialization round-trip). |

### 2.7 `InMemoryCacheProvider`
File: [`llm-service/InMemoryCacheProvider.test.ts`](tests/llm-service/InMemoryCacheProvider.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| IM-01 | `set` then `get` | Value returned. |
| IM-02 | `set` with ttl=1s, advance 2s of fake time, `get` | Returns `null`; entry deleted. |
| IM-03 | `set` without ttl | Never expires; multiple `get`s succeed. |
| IM-04 | `delete` | `get` returns null. |
| IM-05 | `clear` | All entries gone. |
| IM-06 | Overwriting `set` resets TTL | Advance to just before new TTL → still present. |

### 2.8 Retry logic
File: [`llm-service/GuidlioLMService.retry.test.ts`](tests/llm-service/GuidlioLMService.retry.test.ts) + [`llm-service/internal/retry.test.ts`](tests/llm-service/internal/retry.test.ts)

Use `vi.useFakeTimers()`; advance timers between attempts.

| # | Scenario | Expectation |
|---|---|---|
| R-01 | Provider throws `LLMTransientError` 2 times, succeeds on 3rd (default `maxAttempts: 3`) | Service returns success; provider `call` invoked 3 times. |
| R-02 | Provider throws `LLMTransientError` every time | Throws `LLMTransientError` after `maxAttempts`. |
| R-03 | Provider throws `LLMPermanentError` once | Throws immediately on first attempt; NOT retried. |
| R-04 | Provider throws `LLMParseError` (unlikely but covers shape) | Not retried. |
| R-05 | Provider throws generic `Error` | Not retried. |
| R-06 | Backoff grows exponentially with jitter bounded in `[base * 2^n, base * 2^n + 1000]`, capped by `maxDelayMs` | Stub `Math.random` to verify exact sleep ms per attempt. |
| R-07 | `config.maxAttempts: 1` | No retries at all. |
| R-08 | `config.maxAttempts: 5` | Up to 5 attempts. |
| R-09 | `config.retryBaseDelayMs: 100` | First retry sleeps ~100–1100 ms. |
| R-10 | `config.maxDelayMs: 200` | Caps even long exponential delays. |
| R-11 | Retry logs `llmCall` event per failed attempt with `retry: true` | Logger spy asserts count. |
| R-12 | Abort signal fires during retry sleep | *(Current impl does not respect this — lock it with a test and a note.)* |
| R-13 | Streaming path ignores `maxAttempts` | Provider `callStream` invoked at most once even under transient error. |

### 2.9 Provider selection (single provider)
File: [`llm-service/GuidlioLMService.providerSelection.test.ts`](tests/llm-service/GuidlioLMService.providerSelection.test.ts) + [`llm-service/internal/providerSelection.test.ts`](tests/llm-service/internal/providerSelection.test.ts)

All scenarios use `MockLLMProvider` instances.

| # | Scenario | Expectation |
|---|---|---|
| PS-01 | `defaultProvider: 'providerA'` resolves to registered provider | Used unconditionally even if its `supportsModel` returns false. |
| PS-02 | `defaultProvider: 'does-not-exist'` | Logger `warn`; falls through to auto-select; NOT thrown. |
| PS-03 | No `defaultProvider`, model `'gpt-4o'`, only provider supports `'gpt-'` prefix | Correct provider selected via `supportsModel`. |
| PS-04 | Model supported by none, `strictProviderSelection: true` | Throws with descriptive message. |
| PS-05 | Model supported by none, `strictProviderSelection: false` | Logger `warn`; returns first registered provider. |
| PS-06 | Zero providers at runtime (constructor bypassed somehow) | Defensive throw. |

### 2.10 Dual-provider scenarios (providerA and providerB)
File: [`llm-service/GuidlioLMService.multiProvider.test.ts`](tests/llm-service/GuidlioLMService.multiProvider.test.ts)

Register two `MockLLMProvider` instances — **providerA** (supports `'model-a-'` prefix) and **providerB** (supports `'model-b-'` prefix). Both have spy-able `call` so tests can assert which was actually invoked.

| # | Scenario | Expectation |
|---|---|---|
| MP-01 | `model: 'model-a-v1'` — providerA handles it | providerA.call called once; providerB.call never called. |
| MP-02 | `model: 'model-b-v1'` — providerB handles it | Symmetric of MP-01. |
| MP-03 | `defaultProvider: 'providerA'` with `model: 'model-b-v1'` | providerA used unconditionally (default overrides model-based selection). |
| MP-04 | `defaultProvider: 'does-not-exist'`, `model: 'model-b-v1'` | Logger warn; providerB auto-selected by `supportsModel`. |
| MP-05 | Both providers support the same model prefix | First-registered (providerA) wins; providerB never called. |
| MP-06 | Model unsupported by both, `strictProviderSelection: false` | Logger warn; first-registered (providerA) used as fallback. |
| MP-07 | Model unsupported by both, `strictProviderSelection: true` | Throws — lists both provider names in the error. |
| MP-08 | providerA throws `LLMTransientError` on first attempt; providerB handles the same model | Retry stays on providerA (retry does NOT switch providers); providerA called again on retry. |
| MP-09 | Embed with providerA (supports embed) and providerB (throws "not supported") | `embed` with `model: 'model-a-v1'` routes to providerA correctly; providerB never touched. |
| MP-10 | `callText` then `callJSON` to different models in same service instance | Each selects its own provider independently. |
| MP-11 | `callStream` model selection consistent with `callText` | Same routing logic applies to streaming path. |
| MP-12 | providerA registered first but removed from pool (impossible with current API — document as N/A) | Note: provider list is fixed at construction; no dynamic add/remove. |

### 2.11 Hooks (`validatePrompt`, `prepareMessages`, `mapResponse`)
File: [`llm-service/GuidlioLMService.hooks.test.ts`](tests/llm-service/GuidlioLMService.hooks.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| HK-01 | `validatePrompt` throws | Error propagates; provider never invoked. |
| HK-02 | `prepareMessages` mutates/appends messages | Provider sees modified messages. |
| HK-03 | `mapResponse` returns a richer object | Caller sees it on the result (assert it layers on top of the base `LLMTextResult`). |
| HK-04 | Each hook receives the documented `(params, context)` shape | Snapshot args. |

### 2.12 `PromptRegistry`
File: [`llm-service/PromptRegistry.test.ts`](tests/llm-service/PromptRegistry.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| PR-01 | `register` then `getPrompt('p1', '1')` | Returns registered. |
| PR-02 | `getPrompt('p1')` without version after `register('p1', '1')` and `'2'` | Returns `'2'` (numeric comparison). |
| PR-03 | Versions `'1.0'` and `'2.0'` | `parseFloat` picks `2.0`. |
| PR-04 | Versions `'v1.0'` and `'v2.0'` (NaN path) | Lexicographic pick: `'v2.0'`. |
| PR-05 | Register same `id@version` twice | Second overwrites; latest recomputed. |
| PR-06 | `getPrompt('missing')` | Returns `null`. |
| PR-07 | `buildMessages` with no system, user only | One-message array. |
| PR-08 | `buildMessages` with system + user | Both produced; order preserved. |
| PR-09 | `buildMessages` with no vars passed but placeholder in template | `{name}` left as literal. |
| PR-10 | Template with nested braces like `{{name}}` | Matches outer `{name}` first (document behavior precisely). |
| PR-11 | Variable with numeric 0, null, undefined | `0 → "0"`, `null → "null"` via `String`, `undefined → literal {name}`. |
| PR-12 | Variable array value | `JSON.stringify([...])`. |

### 2.13 `cacheKey` internals
File: [`llm-service/internal/cacheKey.test.ts`](tests/llm-service/internal/cacheKey.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| CK-01 | Same inputs → same hash | Deterministic. |
| CK-02 | Flipping any one of the 11 input fields → different hash | One test per field. |
| CK-03 | `temperature: 0` vs `undefined` | Different hashes. |
| CK-04 | `idempotencyKey: 'abc'` same across differing other fields | Still different hash per field (proves idempotencyKey is not a short-circuit). |
| CK-05 | `jsonSchema` fingerprint stable across runs | Two fresh Zod schemas with identical shape → same fingerprint segment. |
| CK-06 | Undefined `jsonSchema` → `fingerprintSchema` returns `""` | Different from any present schema. |
| CK-07 | Schema that throws on `JSON.stringify` | Fallback to `"schema"`. |

### 2.13b `jsonHelpers` internals  <!-- §2.13b because §2.14 is now EchoProvider; renumber if desired -->
File: [`llm-service/internal/jsonHelpers.test.ts`](tests/llm-service/internal/jsonHelpers.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| JH-01 | `parseJSON` of pure JSON | Returns parsed. |
| JH-02 | `parseJSON` of invalid JSON → `repairJSON` → parsed | Success on second attempt. |
| JH-03 | `repairJSON` strips ```` ```json ... ``` ```` | Correct. |
| JH-04 | `repairJSON` strips ```` ``` ... ``` ```` (no language tag) | Correct. |
| JH-05 | `repairJSON` extracts `[...]` (array root) | Correct. |
| JH-06 | `repairJSON` extracts the FIRST `{` to LAST `}` block | Leading/trailing prose stripped. |
| JH-07 | `repairJSON` on text with no braces | Returns trimmed text (which will then fail to parse). |
| JH-08 | `validateSchema` with no schema | Returns parsed as-is. |
| JH-09 | `validateSchema` with failing Zod schema | Throws `LLMSchemaError`; `validationErrors` formatted `"path: message"`. |
| JH-10 | `enforceJsonInstruction` idempotent on re-application | Does not re-append. |
| JH-11 | `enforceJsonInstruction` when last message is system/assistant | No-op. |

### 2.14 `EchoProvider` — provider contract test
File: [`llm-service/echoProvider.contract.test.ts`](tests/llm-service/echoProvider.contract.test.ts)

A fully-written user-style custom provider in `fixtures/echoProvider.ts` that directly implements the `LLMProvider` interface without using any built-in provider. This is both a contract test and living documentation for library users building their own providers.

```ts
// fixtures/echoProvider.ts
class EchoProvider implements LLMProvider {
  name = 'echo';
  supportsModel(m: string) { return m.startsWith('echo-'); }
  async call(req: LLMProviderRequest): Promise<LLMProviderResponse> {
    return { text: JSON.stringify(req.messages), usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, raw: req, finishReason: 'stop' };
  }
  async callStream(req: LLMProviderRequest): Promise<LLMProviderStreamResponse> {
    return (async function* () { yield { text: 'e', delta: 'e' }; yield { text: 'echo', delta: 'cho' }; })();
  }
  async embed(r: LLMProviderEmbedRequest): Promise<LLMProviderEmbedResponse> {
    return { embedding: new Array(r.dimensions ?? 3).fill(0.1), usage: { totalTokens: 1 } };
  }
  async embedBatch(r: LLMProviderEmbedBatchRequest): Promise<LLMProviderEmbedBatchResponse> {
    return { embeddings: r.texts.map(() => [0.1, 0.2]), usage: { totalTokens: r.texts.length } };
  }
}
```

| # | Scenario | Expectation |
|---|---|---|
| EC-01 | Service with `EchoProvider` only, `callText` on `model: 'echo-1'` | End-to-end success; `.text` = `JSON.stringify(messages)`. |
| EC-02 | `callStream` yields two chunks in order | `delta` values are `'e'` then `'cho'`; accumulated `text` is `'e'` then `'echo'`. |
| EC-03 | `embed(r)` respects `dimensions` | Embedding length = requested dimensions. |
| EC-04 | `embedBatch` with 5 texts | Returns 5 embeddings. |
| EC-05 | `callJSON` — provider returns valid JSON string | `.data` is parsed and typed. |
| EC-06 | `callJSON` — provider returns garbage | `LLMParseError` surfaced; `rawOutput` = garbage string. |
| EC-07 | Provider throws `LLMTransientError` once then succeeds | Service retries; `call` invoked twice total. |
| EC-08 | `strictProviderSelection: true`, model `'gpt-4o'` (not `'echo-'`) | Throws because EchoProvider returns false for that model. |
| EC-09 | EchoProvider alongside a second `MockLLMProvider('other')` | Selection by `supportsModel` routes `'echo-1'` to Echo, `'other-1'` to Mock. |

### 2.15 Errors
File: [`llm-service/errors.test.ts`](tests/llm-service/errors.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| ER-01 | Each error class constructs with all documented fields | Instance of `Error`, own prototype, correct `name`. |
| ER-02 | `LLMParseError.rawOutput` and `LLMSchemaError.validationErrors` are preserved | Type and value round-trip. |
| ER-03 | `instanceof` works after build through tsup | Integration test in `integration/` directory (run against `dist/`). |
| ER-04 | Retry predicate: `err instanceof LLMTransientError` distinguishes from `LLMPermanentError` | Unit boundary. |

---

## 3. `GuidlioOrchestrator` Test Suites

### 3.1 Pipeline run — happy path
File: [`orchestrator/GuidlioOrchestrator.run.test.ts`](tests/orchestrator/GuidlioOrchestrator.run.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| O-01 | Single-step pipeline returns `ok` | `result.status === 'ok'`; `result.ctx` = step ctx. |
| O-02 | Three-step linear pipeline, all `ok` | Runs in order; final ctx accumulates per-step changes. |
| O-03 | `initialCtx.traceId` provided | Preserved on result ctx. |
| O-04 | `opts.traceId` provided, differs from ctx.traceId | Logger `warn`; `opts.traceId` wins. |
| O-05 | Neither traceId provided | Auto-generated UUID v4 string set on ctx. |
| O-06 | `opts.traceId` equals `initialCtx.traceId` | No warn; used. |
| O-07 | `observer.onRunStart`/`onRunFinish` called once each (and paired) | Call count + args. |
| O-08 | `observer.onStepStart`/`onStepFinish` called once per executed step | Count matches. |
| O-09 | `onTransition` called on every transition (non-terminal and terminal) | Count = `transitionCount`. |
| O-10 | Run returns synchronously after last `next` | No dangling timers/promises. |

### 3.2 Transitions
File: [`orchestrator/GuidlioOrchestrator.transitions.test.ts`](tests/orchestrator/GuidlioOrchestrator.transitions.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| TR-01 | `NEXT` from last step | Run finishes `ok`. |
| TR-02 | `NEXT` from non-last step | Moves to next-in-order. |
| TR-03 | `GOTO` to existing step | Jumps; step order doesn't restart — the loop continues from there. |
| TR-04 | `GOTO` to non-existent step | Throws `PipelineDefinitionError` (programmer error). |
| TR-05 | `RETRY` with default target (same step) | Re-executes same step; `attempt` meta increments. |
| TR-06 | `RETRY` with `stepName` → another step | Goes there instead. |
| TR-07 | `RETRY` with `delayMs: 250` | With fake timers, next step start is exactly ≥250ms later. |
| TR-08 | `RETRY` with `delayMs` and `opts.signal` aborting mid-sleep | `PipelineAbortedError` (status 499) returned as `result.error`. |
| TR-09 | `STOP` | `result.status === 'ok'`; later steps never run. |
| TR-10 | `FAIL` with `Error` | `result.status === 'failed'`; `error` is `StepExecutionError`. |
| TR-11 | `FAIL` with existing `PipelineError` | Passed through (not re-wrapped). |
| TR-12 | `DEGRADE` with reason | `result.status === 'ok'`, `result.degraded.reason` set. |
| TR-13 | `maxTransitions` default=50 exceeded (infinite `goto` loop) | `PipelineDefinitionError` thrown. |
| TR-14 | Custom `maxTransitions: 5` exceeded | Same error. |
| TR-15 | `attempt` counter resets across runs (fresh policy per run) | Verified via factory policy. |

### 3.3 Context adjustments
File: [`orchestrator/GuidlioOrchestrator.context.test.ts`](tests/orchestrator/GuidlioOrchestrator.context.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| CX-01 | Policy returns `{ contextAdjustment: { type: 'none' } }` | ctx unchanged. |
| CX-02 | `contextAdjustment: { type: 'patch', patch: { x: 1 } }` | ctx merged with patch; other keys preserved. |
| CX-03 | `contextAdjustment: { type: 'override', ctx: { foo: 'bar' } }` without traceId | traceId restored onto overridden ctx. |
| CX-04 | `contextAdjustment: { type: 'override', ctx: { ..., traceId: 'custom' } }` | Supplied traceId used unchanged. |
| CX-05 | Patch that attempts to change traceId | Currently allowed (lock behavior via test). |

### 3.4 Exception handling within steps
File: [`orchestrator/GuidlioOrchestrator.exceptions.test.ts`](tests/orchestrator/GuidlioOrchestrator.exceptions.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| EX-01 | Step throws `new Error('x')` | Converted to `{ type: 'failed', retryable: false, error }`; policy gets a `FAILED` outcome. |
| EX-02 | Step throws with `DefaultPolicy` | `result.status === 'failed'`; `result.error` is `StepExecutionError` wrapping original. |
| EX-03 | Step throws with `RetryPolicy` | **NOT retried** because `retryable` defaults to false on exception outcomes. |
| EX-04 | Step returns explicit `failed({ retryable: true })` with `RetryPolicy` | Retried up to `maxAttempts`. |
| EX-05 | Step throws `PipelineDefinitionError` | **Re-thrown** (programmer error; does not yield a `result`). |
| EX-06 | `stepTimeoutMs: 50`, step takes 200ms | Timeout fires; converts to failed outcome; `result.status` depends on policy. |
| EX-07 | Timeout with step that never resolves | No hanging test; assertion completes within timeout. |
| EX-08 | `observer.onError` called with the thrown error | Verified. |

### 3.5 AbortSignal
File: [`orchestrator/GuidlioOrchestrator.abort.test.ts`](tests/orchestrator/GuidlioOrchestrator.abort.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| AB-01 | Signal pre-aborted before `run()` | *Current behavior:* still runs first step (verify and lock). |
| AB-02 | Signal aborted between steps | Next step not started; `result.status === 'failed'` with `PipelineAbortedError`. |
| AB-03 | Signal aborted during `retry` delay | Sleep promise rejects; `PipelineAbortedError`. |
| AB-04 | Signal reason propagated to error `.cause` | If supported. |

### 3.6 Pipeline definition errors
File: [`orchestrator/GuidlioOrchestrator.definitionErrors.test.ts`](tests/orchestrator/GuidlioOrchestrator.definitionErrors.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| DE-01 | Empty `steps: []` | Throws in constructor. |
| DE-02 | Duplicate step names | Throws in constructor. |
| DE-03 | Step with empty or whitespace-only `name` | Throws. |
| DE-04 | Policy `decide()` returns `{ type: 'goto', stepName: 'missing' }` | `PipelineDefinitionError` at runtime. |
| DE-05 | `maxTransitions` exhausted via chained retries | Same error class. |

### 3.7 Observer
File: [`orchestrator/GuidlioOrchestrator.observer.test.ts`](tests/orchestrator/GuidlioOrchestrator.observer.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| OB-01 | `LoggerPipelineObserver` with mock logger | `logger.pipelineEvent` called with each event name and `traceId`. |
| OB-02 | `NoopPipelineObserver` used by default | No observer methods matter; run completes. |
| OB-03 | Observer throws in `onStepStart` | Error propagates? Or swallowed? *(Lock behavior — probably should propagate.)* |
| OB-04 | `onTransition` optional — observer without it does not crash | Verified. |
| OB-05 | `onError` fires exactly once on failed run | Count = 1. |
| OB-06 | `onStepFinish` `durationMs` is monotonic non-negative | Structural. |

### 3.8 Policies
#### `DefaultPolicy`
File: [`orchestrator/policies/DefaultPolicy.test.ts`](tests/orchestrator/policies/DefaultPolicy.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| DP-01 | `ok` outcome → `{ type: 'next' }` | Direct policy call. |
| DP-02 | `failed` outcome → `{ type: 'fail', error, statusCode }` | Preserved. |
| DP-03 | `redirect` outcome | Throws or fails (document: base class rejects redirects). |
| DP-04 | `reset()` is no-op | No-throw. |

#### `RetryPolicy`
File: [`orchestrator/policies/RetryPolicy.test.ts`](tests/orchestrator/policies/RetryPolicy.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| RP-01 | `maxAttempts: 3`, step returns `failed({ retryable: true })` three times | First two yield `retry` transitions; third yields `fail`. |
| RP-02 | `retryable: false` | Immediate `fail`. |
| RP-03 | Custom `retryIf: (o) => o.statusCode === 503` | Only retries on that status. |
| RP-04 | Custom `backoffMs: (attempt) => attempt * 10` | `delayMs` matches formula per attempt. |
| RP-05 | Default backoff: attempt 1=100, 2=200, 3=400 | Cap test at attempt 10 → 30_000. |
| RP-06 | `reset()` clears per-step counters | Reuse policy instance across runs (but orchestrator creates fresh per run — still assert). |
| RP-07 | Different steps tracked independently | Two failing steps each get their own attempt budget. |

#### `RedirectRoutingPolicy`
File: [`orchestrator/policies/RedirectRoutingPolicy.test.ts`](tests/orchestrator/policies/RedirectRoutingPolicy.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| RR-01 | `redirect({ message: 'classify' })` with route `{ classify: 'stepB' }` | Transitions to `goto 'stepB'`. |
| RR-02 | Redirect with unknown message | Returns `fail` with descriptive message that lists known keys. |
| RR-03 | `ok` / `failed` fall through to `DefaultPolicy` behavior | `next` / `fail`. |
| RR-04 | Message is undefined | `fail` (empty key lookup). |

#### Custom policy
File: [`orchestrator/policies/CustomPolicy.integration.test.ts`](tests/orchestrator/policies/CustomPolicy.integration.test.ts)

Exercise the full `PipelinePolicy` contract with a hand-written class. This doubles as the "how to write a custom policy" documentation.

```ts
// sketch
class CircuitBreakerPolicy extends DefaultPolicy<Ctx> {
  private consecutiveFailures = 0;
  override fail(outcome, input) {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) return { type: TRANSITION_TYPE.DEGRADE, reason: 'circuit-open' };
    return super.fail(outcome, input);
  }
  override ok(outcome, input) { this.consecutiveFailures = 0; return super.ok(outcome, input); }
  override reset() { this.consecutiveFailures = 0; }
}
```

| # | Scenario | Expectation |
|---|---|---|
| CPL-01 | Custom policy returns `degrade` after 3 failures | `result.status === 'ok'`, `result.degraded.reason === 'circuit-open'`. |
| CPL-02 | `ok` resets counter | Subsequent failures start fresh. |
| CPL-03 | Policy factory (function) used for fresh instance per run | Two sequential runs don't share state. |
| CPL-04 | Policy passed as single instance (not factory) | Orchestrator wraps it; `reset()` still called; state persists if policy doesn't implement `reset`. *(Verify: this is the footgun from [CLAUDE.md](CLAUDE.md) re: `maxTransitions`.)* |
| CPL-05 | Custom policy that returns `contextAdjustment` alongside a transition | ctx mutated as declared. |
| CPL-06 | Custom policy that returns a transition with a schema violation (unknown `type`) | Runtime behavior — document if orchestrator throws or falls into default. |

### 3.9 `statusHelpers` (`ok`, `failed`, `redirect`)
File: [`orchestrator/statusHelpers.test.ts`](tests/orchestrator/statusHelpers.test.ts)

| # | Scenario | Expectation |
|---|---|---|
| SH-01 | `ok({ ctx })` | Returns `{ ctx, outcome: { type: 'ok' } }`. |
| SH-02 | `failed({ ctx, error })` | `retryable: true` by default. |
| SH-03 | `failed({ ctx, error, retryable: false, statusCode: 400 })` | All preserved. |
| SH-04 | `redirect({ ctx, message: 'x' })` | `outcome.message === 'x'`. |
| SH-05 | `redirect({ ctx })` without message | `outcome.message` undefined. |

### 3.10 Observers
File: [`orchestrator/observers/LoggerPipelineObserver.test.ts`](tests/orchestrator/observers/LoggerPipelineObserver.test.ts) & `NoopPipelineObserver.test.ts`

| # | Scenario | Expectation |
|---|---|---|
| LO-01 | Each method forwards structured data to `logger.pipelineEvent` | Assert shape. |
| LO-02 | Transition event includes `transition.type` human-readable | e.g. `"Transition → next"`. |
| LO-03 | Noop observer methods return `undefined` and throw nothing | Plain contract. |

---

## 4. Integration tests

### 4.1 Gateway + Orchestrator
File: [`integration/gateway-with-orchestrator.test.ts`](tests/integration/gateway-with-orchestrator.test.ts)

Build a realistic pipeline using two `MockLLMProvider` instances (providerA and providerB) to show multi-provider + orchestration working together:

1. **ClassifyStep** calls `GuidlioLMService.callJSON` (Zod schema, `model: 'model-a-v1'`) to classify input → providerA handles it.
2. **RouteStep** uses `redirect({ message: classification.kind })` with a `RedirectRoutingPolicy`.
3. **HandlePremiumStep** calls `callText` with `model: 'model-b-v2'` → providerB handles it.
4. **HandleStandardStep** calls `callText` with `model: 'model-a-v1'` → providerA handles it.

| # | Scenario | Expectation |
|---|---|---|
| IG-01 | Classification `'premium'` routes to `HandlePremiumStep` | providerB.call invoked; providerA.call count = 1 (classify only). |
| IG-02 | Classification `'standard'` routes to `HandleStandardStep` | providerA.call count = 2 (classify + handle). |
| IG-03 | Classification returns unknown kind | Pipeline fails with descriptive error from RedirectRoutingPolicy. |
| IG-04 | Transient error in `ClassifyStep` (providerA) + `RetryPolicy(3)` | providerA retried; eventually succeeds; providerB untouched. |
| IG-05 | Permanent error in `ClassifyStep` | Not retried; pipeline fails immediately. |
| IG-06 | Cache hit on `ClassifyStep` | providerA.call skipped on second identical run; pipeline still completes correctly. |
| IG-07 | `traceId` flows from initial ctx → both providers' `llmCall` logs and observer events | Single traceId consistent across the whole run. |
| IG-08 | `EchoProvider` replaces providerA in a separate pipeline | Still routes correctly via `supportsModel`; no SDK involved. |

### 4.2 Public API surface
File: [`integration/public-api-surface.test.ts`](tests/integration/public-api-surface.test.ts)

Imports **only** from the package entry (simulate the build output). Verifies that every exported symbol in [src/index.ts](src/index.ts) is defined and is of the expected kind (class, function, const). This catches accidental removals and type re-export breakage.

| # | Symbol | Kind |
|---|---|---|
| API-01 | `GuidlioLMService` | class |
| API-02 | `OpenAIProvider`, `GeminiProvider`, `OpenRouterProvider` | class |
| API-03 | `PromptRegistry` | class |
| API-04 | `InMemoryCacheProvider` | class |
| API-05 | `GuidlioOrchestrator`, `PipelineStep`, `DefaultPolicy` | class |
| API-06 | `LoggerPipelineObserver` | class |
| API-07 | `PIPELINE_STATUS`, `OUTCOME_TYPE`, `TRANSITION_TYPE` | frozen-ish const objects |
| API-08 | `ok`, `failed`, `redirect` | functions |
| API-09 | `PipelineError`, `PipelineDefinitionError`, `StepExecutionError` | classes extending `Error` |
| API-10 | `LLMError` and subclasses | classes extending `Error` |
| API-11 | `ConsoleLogger` | class |

Also run `tsc --noEmit` against a tiny user-style file that imports every type — part of the test script — so breaking type changes are caught.

---

## 5. Edge cases explicitly called out in [CLAUDE.md](CLAUDE.md)

These are the "load-bearing" behaviors to protect with regression tests. Each should have at least one dedicated test case cross-referenced above:

1. **Retry only on `LLMTransientError`** — R-01 through R-05.
2. **Streaming bypasses retries** — S-04, R-13.
3. **JSON repair order** (direct parse → strip fences → extract block) — JH-01…JH-07.
4. **Cache key uses nullish check so `0 ≠ undefined`** — CK-03, CA-12.
5. **Cache read only in `read_through`, cache write in `read_through` or `refresh`, and only when `ttlSeconds` set** — CA-01…CA-09.
6. **`enableCache: false` disables both sides** — CA-07.
7. **Prompt version resolution: numeric then lexicographic** — PR-02, PR-03, PR-04.
8. **Missing variables left as literal `{name}`** — T-05, PR-09.
9. **Steps return outcomes, policies return transitions** — enforced throughout §3.
10. **Exception-to-outcome conversion does NOT retry by default** — EX-03 (vs EX-04).
11. **`maxTransitions` is the only infinite-loop guard** — TR-13, TR-14.
12. **`degrade` vs `stop` distinction: both OK, only `degrade` sets `degraded`** — TR-09, TR-12.
13. **`contextAdjustment` can be `patch` / `override` / `none`** — CX-01…CX-04; override guards traceId.
14. **Policy `reset()` called per run; factory yields fresh state** — CPL-03, CPL-04, TR-15.

---

## 6. Coverage, fuzz, and future work

### 6.1 Coverage targets
- Line: ≥90% over `src/llm-service/` and `src/orchestrator/`.
- Branch: ≥85% (many short-circuit operators and `??` chains).
- Exclude `src/**/examples/**.md`, `src/**/README.md`, and the top-level `src/index.ts` barrel from thresholds.

### 6.2 Property-based candidates (nice-to-have, not required)
- `buildCacheKey` stability: `fast-check` property "same input → same output".
- `repairJSON`: property "pure valid JSON always parses unchanged".
- `PromptRegistry.isNewer`: property "comparison is a total order for pure-numeric versions".

### 6.3 Out of scope (explicitly not tested here)
- Actual network calls to OpenAI / Gemini / OpenRouter.
- `tsup` bundle correctness (covered by a separate smoke test on `dist/`).
- Performance benchmarks.

### 6.4 Open behavior questions surfaced by this plan
*(These came up while writing the plan — worth deciding before writing the tests, so the asserts match intent.)*

1. **CA-16**: Should a failing `cache.set` fail the call or just log? Current code seems to `await` without try/catch.
2. **R-12 / AB-03**: Should abort during backoff sleep interrupt retry? Current `callWithRetries` uses plain `setTimeout`, so probably no.
3. **CPL-04**: When a policy is passed as an instance (not a factory) and lacks `reset()`, per-run isolation is lost. Consider logging a warning at construction.
4. **OB-03**: Should an observer that throws in `onStepStart` abort the run, or be isolated?
5. **AB-01**: Pre-aborted signal — current code likely still starts step 1. Consider an early check.

Document the chosen answer for each either in the test assertion or in a brief doc block next to it.
