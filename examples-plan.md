# Examples Plan — `guidlio-lm`

Reference plan for the example library that will ship alongside the package. The goal is to give library integrators a copy-paste-ready reference for every realistic integration shape, from "first call" through custom providers, custom caches, custom policies, and production pipelines.

The package already ships seven LLM-service examples and five orchestrator examples (under `src/llm-service/examples/` and `src/orchestrator/examples/`). This plan **extends** that set — it does not duplicate what is there. Existing examples that should be lightly refreshed (not rewritten) are flagged `[EXISTING — touch-up]`; everything else is new.

The plan is organized around how integrators actually adopt a library: basics → composition → extension points → production concerns → end-to-end recipes.

---

## Directory layout

Two parallel example trees already exist and stay where they are:

```
src/llm-service/examples/      # LLM service surface
src/orchestrator/examples/     # Pipeline/FSM surface
examples/                      # NEW — end-to-end recipes that combine both
```

Cross-cutting recipes (LLM + orchestrator together, or framework integrations) live in the top-level `examples/` folder so that neither subsystem "owns" them. All examples are `.md` files with self-contained TypeScript snippets, matching the current convention.

---

## Naming & authoring conventions (apply to every example)

- **Title + one-paragraph "why you'd use this"** at the top. No fluff; say what problem the example solves.
- **"Concepts covered"** bullet list (like `src/orchestrator/examples/basic.md` does today).
- **Imports from `"guidlio-lm"`** only — never from internal paths. This keeps examples valid from the published-package consumer's perspective.
- **No `any`**. If a type is awkward, it's a documentation bug; fix the example, don't silence the type.
- **Minimum viable code** — one concept per example. If two ideas are fighting for attention, split the example.
- **End with a "What to change next" section** linking to 1–2 related examples so readers can navigate the library by concept.
- **No emoji**, double quotes, tabs for indent (matches Prettier config).

---

## Tier 1 — LLM Service basics (`src/llm-service/examples/`)

Covers the single-call surface: text, JSON, streaming, embeddings, prompts, caching, errors.

| # | File | Status | Purpose |
|---|------|--------|---------|
| 01 | `01-basic-text.md` | `[EXISTING — touch-up]` | First `callText` call. Add a note about `traceId` propagation. |
| 02 | `02-json-extraction.md` | `[EXISTING — touch-up]` | `callJSON` + Zod. Add note about the `repairJSON` fallback and when `LLMParseError` vs `LLMSchemaError` fires. |
| 03 | `03-streaming.md` | `[EXISTING — touch-up]` | `callStream`. Add explicit note that streaming bypasses retries (caller reconnects). |
| 04 | `04-embeddings.md` | `[EXISTING — touch-up]` | `embed` + `embedBatch`. Add `taskType` rationale for Gemini (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`). |
| 05 | `05-prompt-registry.md` | `[EXISTING — touch-up]` | Registering prompts, versioning, `{variable}` interpolation. Add an example of object/array variable stringification. |
| 06 | `06-caching.md` | `[EXISTING — touch-up]` | `InMemoryCacheProvider`, `read_through` vs `refresh`. Add a note that `enableCache: false` short-circuits both sides. |
| 07 | `07-providers-and-errors.md` | `[EXISTING — touch-up]` | Multi-provider, `defaultProvider`, `strictProviderSelection`, error taxonomy, `AbortSignal`. Fine as-is; verify links. |

### New LLM-service examples

| # | File | Purpose |
|---|------|---------|
| 08 | `08-cancellation-and-timeouts.md` | End-to-end `AbortController` recipe: request-scoped cancellation, `Promise.all` sharing one signal, wrapping `signal` with a `setTimeout`-based deadline, why aborted calls aren't retried. |
| 09 | `09-idempotency-and-cache-keys.md` | How the cache key is derived (`idempotencyKey | promptId | version | vars | model | temperature`), when to supply `idempotencyKey` (webhooks, user-visible retries), and `temperature: 0` vs unset. |
| 10 | `10-observability-and-cost.md` | Wiring `logger`, reading the `llmCall` log entries, aggregating `usage.totalTokens` across a request, distinguishing terminal log entries from mid-flight `retry: true` entries. Includes a minimal OpenTelemetry-style adapter example. |
| 11 | `11-retry-tuning.md` | Tuning `maxAttempts` / `retryBaseDelayMs` / `maxDelayMs`. When to turn retries off (`maxAttempts: 1`) — e.g., inside an outer orchestrator that already handles retry at the pipeline layer. |
| 12 | `12-dynamic-prompt-selection.md` | Using `promptVersion: "latest"` vs pinned versions, A/B testing via registry lookup, hot-swapping a `PromptRegistry` instance behind a flag. |
| 13 | `13-batched-embeddings-rag.md` | Building a small RAG ingestion loop: chunk → `embedBatch` → store. Covers batch size tradeoffs and `RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`. |

---

## Tier 2 — LLM Service extension points (`src/llm-service/examples/extensions/`)

New subfolder. These are the most-requested integrations for a library: "I have my own X, how do I plug it in?"

| # | File | Purpose |
|---|------|---------|
| E1 | `custom-provider-anthropic.md` | Implement the `LLMProvider` interface end-to-end for a real SDK (Anthropic's `@anthropic-ai/sdk`). Covers `call`, `callStream`, `embed`/`embedBatch` (throw `LLMPermanentError` if unsupported), `supportsModel`, mapping provider errors → `LLMTransientError` vs `LLMPermanentError`, `AbortSignal` propagation. |
| E2 | `custom-provider-local-llamacpp.md` | Minimal `LLMProvider` against a local HTTP endpoint (e.g., llama.cpp server). Demonstrates the non-OpenAI-shape case and shows how to normalize non-streaming chunked responses into the `AsyncIterable` stream shape. |
| E3 | `custom-provider-mock-testing.md` | A deterministic in-process `LLMProvider` for unit tests of consumer code. Shows per-call scripted responses, recording calls, and injecting delays/errors — distinct from the internal `makeMockProvider` fixture (which is test-only). |
| E4 | `custom-cache-redis.md` | `CacheProvider` backed by `ioredis`. TTL handling, serialization, key namespacing, connection failure fallback (don't crash the request). |
| E5 | `custom-cache-lru-bounded.md` | An `InMemoryCacheProvider`-equivalent with an LRU bound for long-running processes. |
| E6 | `custom-logger.md` | Implementing `LLMLogger`. Adapters for pino, winston, and a structured JSON logger. Note: `LLMLogger` is intentionally narrow — don't leak provider response bodies into logs. |
| E7 | `prompt-registry-loading.md` | Loading prompts from YAML/JSON on startup vs from a service at runtime. Includes a pattern for registry hot-reload without downtime (swap instance behind a getter). |

---

## Tier 3 — Orchestrator basics (`src/orchestrator/examples/`)

| # | File | Status | Purpose |
|---|------|--------|---------|
| O01 | `basic.md` | `[EXISTING — touch-up]` | Three-step linear pipeline, default policy. Fine; just verify imports point to `"guidlio-lm"`. |
| O02 | `fsm-routing.md` | `[EXISTING — touch-up]` | `RedirectRoutingPolicy` and `goto`. Add a diagram comment showing the state graph. |
| O03 | `retry-with-backoff.md` | `[EXISTING — touch-up]` | `RetryPolicy` with backoff. Add note: policies with retry counters MUST implement `reset()` — call it out explicitly with a "common pitfall" callout. |
| O04 | `agent-react-loop.md` | `[EXISTING — touch-up]` | ReAct loop as FSM. Fine. |
| O05 | `agent-plan-execute-verify.md` | `[EXISTING — touch-up]` | Plan→Execute→Verify agent. Fine. |

### New orchestrator examples

| # | File | Purpose |
|---|------|---------|
| O06 | `step-timeouts-and-cancellation.md` | `stepTimeoutMs`, `meta.signal`, cooperative cancellation from a parent `AbortController`, difference between a timeout (non-retryable) and a step-raised transient error. |
| O07 | `context-adjustments.md` | `contextAdjustment`: `patch` vs `override`, why `traceId` is preserved on override, when to mutate inside a step vs during transition. |
| O08 | `observer-metrics.md` | Writing a `PipelineObserver` that emits Prometheus-style counters/histograms per step and per transition. Shows the full observer lifecycle (runStart, stepStart, stepEnd, transition, runEnd). |
| O09 | `degrade-vs-stop.md` | When to return `degrade` (partial success, caller still consumes result) vs `stop` (clean completion). Shows `result.degraded.reason` at the call site. |
| O10 | `concurrent-runs-policy-factory.md` | Why `policy: () => new RetryPolicy(...)` matters for concurrent `run()` invocations — demonstrates the state-leak bug if you reuse a stateful policy instance and how the factory fixes it. |
| O11 | `abort-from-outside.md` | Passing `PipelineRunOptions.signal` to stop a run, catching `PipelineAbortedError`, draining partial context. |
| O12 | `typed-context-patterns.md` | Idioms for evolving a `BaseContext`-derived interface across a long pipeline: optional fields, discriminated unions for stage-specific data, avoiding `as` casts. |

---

## Tier 4 — Orchestrator extension points (`src/orchestrator/examples/extensions/`)

New subfolder. The two highest-value extension points are custom steps and custom policies.

| # | File | Purpose |
|---|------|---------|
| P1 | `custom-policy-circuit-breaker.md` | Extend `DefaultPolicy` with a circuit breaker: after N consecutive `failed` outcomes on step X, route subsequent runs straight to `degrade` until a cooldown elapses. Demonstrates `reset()` semantics and external state (the breaker outlives a single run). |
| P2 | `custom-policy-conditional-routing.md` | Policy that inspects `stepResult.ctx` to choose a transition (not just the outcome type) — e.g., "if `ctx.score < 0.5` after the classifier step, goto `human-review`, else `next`". |
| P3 | `custom-policy-async-feature-flag.md` | Async `decide()` that looks up a feature flag before deciding to `degrade` or continue. Shows the Promise-returning policy shape. |
| P4 | `custom-policy-composing.md` | Composing policies: wrap `RetryPolicy` so a fallback policy decides only when retries are exhausted. Explains why composition via wrapping is preferred over a monolithic subclass. |
| P5 | `custom-step-llm-call.md` | Canonical `LLMCallStep` that wraps `GuidlioLMService.callJSON`, converting `LLMTransientError` → `failed({ retryable: true })` and `LLMPermanentError` → `failed({ retryable: false })` so the orchestrator's `RetryPolicy` does the right thing. |
| P6 | `custom-step-http-call.md` | Same pattern as P5 but for a plain HTTP dependency — shows the "translate external errors into outcomes" discipline that keeps step code clean. |
| P7 | `custom-step-parallel-fanout.md` | A step that kicks off N parallel `GuidlioLMService` calls and reduces them into a single `ctx` update. Covers shared `AbortSignal` propagation via `meta.signal`. |
| P8 | `custom-observer-tracing.md` | `PipelineObserver` that opens an OpenTelemetry span per step and links them under a root run span. Also shows correlation of `traceId` with the LLM service's `traceId`. |

---

## Tier 5 — End-to-end recipes (`examples/`)

Top-level folder for realistic, multi-subsystem integrations. Each is a full mini-app, kept as short as possible while still feeling complete.

| # | File | Purpose |
|---|------|---------|
| R1 | `rag-pipeline.md` | Retrieval-augmented generation as a pipeline: `embed-query → retrieve → rerank → generate`. Uses `GuidlioLMService` for embeddings + generation, orchestrator for control flow, a custom `RerankStep`, and `degrade` when retrieval returns zero hits. |
| R2 | `structured-extraction-with-retry.md` | Ingesting messy user text, extracting JSON via `callJSON`, catching `LLMSchemaError`, rerunning with a "here's what was wrong" repair prompt. Shows the orchestrator's retry counter, not `GuidlioLMService`'s (which only retries transient errors). |
| R3 | `agent-with-tools.md` | A minimal tool-using agent: ReAct-style loop with a `SelectToolStep`, `RunToolStep`, `ObserveStep`, and an `LLMDecideStep`. Demonstrates `RedirectRoutingPolicy` routing on the agent's decision. |
| R4 | `multi-provider-fallback.md` | Primary call to one provider, on `LLMTransientError` after retries exhausted fall back to a different provider. Implemented as a small orchestrator with two LLM steps and a `RedirectRoutingPolicy`. Discusses why this belongs at the orchestrator layer, not inside `GuidlioLMService`. |
| R5 | `streaming-ui-server.md` | Express/Fastify handler that pipes `callStream` deltas over SSE to the browser. Covers backpressure, client disconnect (`req.on("close")` → `controller.abort()`), and the "no automatic retry on stream" gotcha. |
| R6 | `batch-job-idempotent.md` | Long-running batch processor: each item sets `idempotencyKey`, cache is Redis-backed (`custom-cache-redis` from E4), logger emits per-item cost. Restart-safe — re-running the batch short-circuits completed items. |
| R7 | `cost-guardrails.md` | Policy that aborts the run (`fail`) when cumulative `usage.totalTokens` across steps exceeds a budget. Requires the LLM step to thread token usage into `ctx`. Shows an explicit budget-exceeded error type. |
| R8 | `caching-strategies.md` | Side-by-side comparison of `read_through` vs `refresh`, with cache TTL tuning per prompt category (chat vs extraction vs classification). Discusses when NOT to cache (personalized outputs, streaming). |
| R9 | `testing-consumers.md` | How consumers of `guidlio-lm` should test their own code. Uses `custom-provider-mock-testing` (E3) and a fake `CacheProvider`. Includes a Vitest setup that asserts on prompt variables and cache hits. |

---

## Tier 6 — Integration guides (`examples/integrations/`)

Framework-specific entry points. Kept deliberately small — each is "here's how you wire it into X", not "here's how to build an app in X".

| # | File | Purpose |
|---|------|---------|
| I1 | `express.md` | Per-request service instance vs singleton, request-scoped `traceId`, `req.on("close")` → abort. |
| I2 | `fastify.md` | Same, with Fastify's request lifecycle and logger integration via `LLMLogger` adapter. |
| I3 | `nextjs-route-handler.md` | App-router route handler with streaming (`ReadableStream`), singleton service on the server, `revalidate` interaction with the cache provider. |
| I4 | `aws-lambda.md` | Cold-start caching of the service, externalized `CacheProvider` (Redis/Dynamo), `context.getRemainingTimeInMillis()` → `AbortSignal` with a buffer. |
| I5 | `cloudflare-workers.md` | Running in a Workers runtime: which providers work (fetch-based), which don't (SDKs requiring Node APIs), KV-backed `CacheProvider`. |
| I6 | `bullmq-worker.md` | Using the orchestrator inside a BullMQ job: mapping job lifecycle to pipeline lifecycle, job cancellation → pipeline abort. |

---

## Tier 7 — Top-level navigation

| File | Purpose |
|------|---------|
| `examples/README.md` | Index page grouping examples by **intent** ("I want to…") rather than file number. Links into the three subsystems. This is what a first-time reader lands on from the main README. |
| `README.md` (root) | Add a "Learn by example" section with 4–5 curated links into the highest-value new examples (R1 RAG, R3 Agent, E1 Custom Provider, P1 Circuit Breaker, R5 Streaming UI). |

---

## Build & verification plan (for whoever writes the examples)

These examples are documentation, not code that ships — but they must still be correct. Suggested workflow:

1. Every new example is **type-checked** by pasting the snippet into a scratch `.ts` file under `examples/__typecheck__/` that is included in a dedicated `tsconfig.examples.json` (not the main build). A `npm run check:examples` script runs `tsc --noEmit` over that folder.
2. Provider-calling examples are **not executed in CI** (no keys). Instead, their runnable variant lives alongside as `.ts` files that use `custom-provider-mock-testing` (E3) so their flow is exercised by tests.
3. New examples land in their own PR with a checklist:
   - [ ] Imports only from `"guidlio-lm"`.
   - [ ] No `any`, no `@ts-expect-error`, no `as` casts outside of narrow, commented cases.
   - [ ] Type-check passes.
   - [ ] Linked from `examples/README.md` under the right intent category.
   - [ ] Linked from at least one sibling example's "What to change next" section.

---

## Write-order recommendation

Order the writing so that later examples can reference earlier ones:

1. **Touch-ups first** (cheap, establishes the new style): T1 01–07, T3 O01–O05.
2. **Extension-point examples** (E1–E7, P1–P8) — unlock the end-to-end recipes.
3. **New LLM basics and orchestrator basics** (08–13, O06–O12) — fill gaps in the single-subsystem coverage.
4. **End-to-end recipes** (R1–R9) — compose the pieces.
5. **Integration guides** (I1–I6) and **navigation** (Tier 7) — last, once content is stable.

---

## Explicit non-goals

- **No provider-specific tuning guides** (e.g., "best prompts for gpt-4o"). That's orthogonal to a gateway library.
- **No benchmark/comparison examples.** Users benchmark their own workloads.
- **No vendored SDK examples** — we show the `LLMProvider` shape and the consumer wires up the SDK themselves. The one exception is E1 (Anthropic), which is concrete enough to be useful as a template.
- **No CLAUDE.md-style internal guidance in examples.** Examples speak to library consumers, not contributors.
