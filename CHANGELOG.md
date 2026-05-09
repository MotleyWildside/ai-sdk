# Changelog

All notable changes to `@motleywildside/ai-sdk` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). This project uses [Semantic Versioning](https://semver.org/).

---

## [1.0.7] — 2026-05-09

### Added

- **OpenAI DALL-E image generation** — `OpenAIProvider` now implements `LLMImageProvider`.
  - DALL-E 3: `aspectRatio` maps to size (`1:1` → 1024×1024, `16:9` → 1792×1024, `9:16` → 1024×1792). Unsupported ratios (`3:4`, `4:3`) and `numberOfImages > 1` throw a permanent error.
  - DALL-E 2: `imageSize` maps to size (`"0.5K"` → 512×512, `"1K"` → 1024×1024). Unsupported sizes (`"2K"`, `"4K"`) and non-square aspect ratios throw a permanent error.
  - Both models use `response_format: "b64_json"` — images are returned as base64 PNG without a secondary download step.
  - DALL-E 3 surfaces the model's revised prompt in `LLMProviderImageResponse.text`.
  - Provider prefix `"dall-e-"` added to `OpenAIProvider.supportedModelPrefixes`.
- Root public API now exports orchestrator policy adapters: `RetryPolicy` and `RedirectRoutingPolicy`.
- Root public API now exports orchestrator observer/error utilities: `NoopPipelineObserver` and `PipelineAbortedError`.
- Root public API now exports orchestrator extension types: `RetryPolicyOptions`, `RouteMap`, `StepOutcomeOk`, `StepOutcomeFailed`, `StepOutcomeRedirect`, `Transition`, `PipelinePolicy`, `PolicyDecisionInput`, `PolicyDecisionOutput`, `ContextAdjustment`, and `PipelineStatus`.

### Changed

- Moved shared stream handling (`streamTextDeltas`), error formatting, and image-URL attachment validation into `BaseLLMProvider` to eliminate duplication across adapters.
- `LMService` now delegates prompt materialization and operation-specific provider capability checks to internal modules, keeping public call behavior unchanged.
- Pipeline runtime now delegates transition application and run failure classification to internal modules, keeping public orchestrator behavior unchanged.
- Runtime-malformed providers that omit required operation methods (`embed`, `embedBatch`, `callStream`, `generateImage`) now fail earlier with `LLMPermanentError`.
- Providers that expose `supportsImageGeneration` now have that model-level image capability checked before image generation calls.

---

## [1.0.6] — 2026-05-07

### Changed

- Introduced `BaseLLMImageProvider`, `BaseLLMTextProvider`, `BaseLLMStreamingProvider`, and `BaseLLMEmbeddingProvider` abstract base classes. Image providers gain utility helpers (`downloadGeneratedImage`, `validateImageRequestAgainstCapabilities`, `aspectRatioToDimensions`, etc.) via inheritance.

---

## [1.0.5] — 2026-05-06

### Changed

- Modularized pipeline transition logic and failure classification into dedicated runtime and utility modules inside `src/orchestrator/`.
- Migrated project documentation from `CLAUDE.md` to `AGENTS.md` with agent-specific guidance.

---

## [1.0.4] — 2026-05-05

### Added

- **Registry-free raw image calls** — `LMService.generateImage` now accepts `LLMImageRawParams` (prompt + model inline) in addition to the prompt-registry path.
- **Gemini image generation** — `GeminiProvider` implements `LLMImageProvider` via the Google Gen AI SDK.
  - Imagen models (`imagen-*`): full parameter support (aspect ratio, negative prompt, person generation, guidance scale, seed, prompt enhancement).
  - Gemini image models (`gemini-*-image`): multimodal input images + text prompt, returns interleaved image/text parts.
- **0.5K image size** — `"0.5K"` resolves to 512 px in `GeminiProvider`.

### Changed

- Renamed public classes: `GuidlioLMService` → `LMService`, `GuidlioOrchestrator` → `PipelineOrchestrator`.
- Migrated test runner to Vitest.

---

## [1.0.1] — 2026-04-xx

### Changed

- Renamed package from `@guidlio/ai-sdk` to `@motleywildside/ai-sdk`.

---

## [1.0.0] — 2026-04-xx

### Added

- Initial release: `LMService` with OpenAI, Gemini, and OpenRouter provider adapters (text, streaming, embeddings).
- `PipelineOrchestrator` FSM with policy-driven transitions, observer hooks, and retry/degrade semantics.
- In-memory prompt registry with `{variable}` interpolation and semantic versioning.
- Pluggable cache layer with read-through / refresh modes.
