# Changelog

All notable changes are documented here.

## [0.3.0-alpha.1] - 2026-07-19

### Added

- Adaptive `auto | shared-worker | page-owner` browser topology with direct `MessagePort` clients and an embeddable SharedWorker broker host.
- Transactional protocol v2 host negotiation covering namespace, required capabilities, protocol version, and a deterministic runtime fingerprint.
- IndexedDB epoch journal with atomic monotonic advancement and typed failure behavior.
- SharedWorker client liveness checks, bounded same-port re-handshake buffering, idle host shutdown, and fatal transport propagation into active broker sessions.
- Deterministic adaptive-topology lab plus an opt-in WebLLM SharedWorker lab.
- Worker-safe `@aantenore/tabloom/core` and `@aantenore/tabloom/shared-worker` package entry points.

### Changed

- Browser fencing now uses IndexedDB instead of local storage for epoch advancement.
- Broker configuration requires a runtime fingerprint derived from the deployed adapter, model, build, and behavior-affecting configuration.
- Vite integration guidance uses the `?sharedworker` constructor with `workerFactory`; no placeholder URL is needed.
- The default `auto` lifecycle policy selects the page-owner topology before startup on Apple WebKit user agents without a Chromium-family lifecycle. Explicit SharedWorker and best-effort modes remain experimental there.

### Boundaries

- ServiceWorker ownership, cross-origin coordination, and durable request replay after every page and worker closes remain out of scope.

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
