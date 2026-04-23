# 🚀 Publish Checklist: guidlio-lm

This list tracks the remaining tasks needed to prepare `guidlio-lm` for its first public release on NPM.

## 🟢 Completed

- [x] Initial project structure
- [x] Core logic (GuidlioLMService, Providers, Orchestrator)
- [x] Set up `.gitignore`
- [x] Define package metadata in `package.json` (author, repo, name)
- [x] Add `LICENSE` file (MIT)
- [x] Final README polish (Modern & Lightweight)
- [x] **Dual Build (CJS/ESM)**: Use `tsup` or similar to support older Node projects.
- [x] **Policy-based Orchestrator**: Pluggable `DefaultPolicy`, `RetryPolicy`, `RedirectRoutingPolicy` with observer hooks.
- [x] **Pluggable Caching**: Read-through / refresh / bypass modes with `InMemoryCacheProvider` default.

## 🟡 High Priority (Required for Release)

- [x] **Setup Testing Framework**: Vitest installed; `npm test`, `npm run test:watch`, `npm run test:coverage` all configured.
- [x] **Core Unit Tests**: 261 tests across 31 files covering `GuidlioLMService`, `PromptRegistry`, `GuidlioOrchestrator`, all policies, observers, caching, retry, provider selection, and public API surface.
- [x] **Provider Mocks**: `MockLLMProvider`, `MockCacheProvider`, `EchoProvider` fixtures — no real API calls made.
- [ ] **Build Validation**: Run `npm run build` and ensure the `dist/` folder contains everything needed (JS, d.ts).
- [ ] **Final README Polish**: Ensure all examples match the final `guidlio-lm` naming.

## 🔵 Medium Priority (Highly Recommended)

- [ ] **Examples Folder**: Create a directory with runnable standalone scripts (e.g., `examples/basic-chat.ts`).
- [ ] **GitHub Actions**: Setup CI to run tests on every push/PR.
- [ ] **CONTRIBUTING.md**: Guidelines for others who want to help.

## ⚪ Low Priority (Post-Release)

- [ ] **API Reference**: Generate documentation from JSDoc (using TypeDoc).
- [ ] **Vercel/Documentation Site**: A pretty landing page.
- [ ] **NPM Provenance**: Configure secure publishing via GitHub Actions.

---

> [!TIP]
> Focus on **Testing** next. A package with 0 tests is often a red flag for developers.
