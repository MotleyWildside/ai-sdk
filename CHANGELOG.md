# Changelog

## Unreleased

### Breaking Changes

- None.

### Added

- Root public API now exports orchestrator policy adapters:
  `RetryPolicy` and `RedirectRoutingPolicy`.
- Root public API now exports orchestrator observer/error utilities:
  `NoopPipelineObserver` and `PipelineAbortedError`.
- Root public API now exports orchestrator extension types:
  `RetryPolicyOptions`, `RouteMap`, `StepOutcomeOk`, `StepOutcomeFailed`,
  `StepOutcomeRedirect`, `Transition`, `PipelinePolicy`, `PolicyDecisionInput`,
  `PolicyDecisionOutput`, `ContextAdjustment`, and `PipelineStatus`.

### Changed

- Public API surface tests now cover the promoted orchestrator runtime exports and
  include a compile-time smoke shape for the promoted orchestrator extension types.
- `LMService` now delegates prompt materialization and operation-specific provider
  capability checks to internal modules, keeping public call behavior unchanged.
- Pipeline runtime now delegates transition application and run failure
  classification to internal modules, keeping public orchestrator behavior
  unchanged.
- Runtime-malformed providers that omit required operation methods such as
  `embed`, `embedBatch`, `callStream`, or `generateImage` now fail earlier with
  `LLMPermanentError`.
- Providers that expose `supportsImageGeneration` now have that model-level image
  capability checked before image generation calls.
