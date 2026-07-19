# Changelog

All notable changes are documented here.

## [0.2.0-alpha.1] - 2026-07-19

### Added

- Optional WebLLM 0.2.84 adapter with lazy provider loading, host-selected model configuration, OpenAI-shaped streaming, usage aggregation, and provider-runtime evidence.
- Abort-safe owner initialization, engine-wide cancellation with stream drain, ordered disposal, and single-generation enforcement.
- Opt-in two-tab Chrome/WebGPU live lab and Playwright gate using a real SmolLM2 model.
- Dedicated `@aantenore/tabloom/adapters/webllm` package export and bundle-isolation smoke assertion.

### Changed

- Runtime integration guidance now distinguishes TabLoom's fenced elected-page topology from WebLLM's worker topologies.
- Delivery, compatibility, operations, threat-model, and visual evidence now cover the real provider seam without widening browser or model claims.

## [0.1.0-alpha.1] - 2026-07-17

### Added

- Fenced same-origin owner election using Web Locks and persistent epochs.
- Versioned BroadcastChannel protocol with runtime envelope validation.
- Provider-neutral streaming sessions with cancellation, timeout, bounded admission, and typed failures.
- Automatic pending-request redispatch after takeover with stale-attempt rejection and one accepted client terminal.
- Deterministic adapter for repeatable coordination evidence.
- Visual three-page broker lab with topology, controls, safe event lineage, and responsive layouts.
- Unit, coverage, package, and Playwright gates across Chromium, Firefox, and WebKit.
- CI, dependency audit, CodeQL, prerelease archive, and checksum automation.
