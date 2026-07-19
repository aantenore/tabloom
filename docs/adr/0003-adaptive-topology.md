# ADR 0003: select browser inference topology adaptively

- Status: accepted for alpha
- Date: 2026-07-19

## Context

The elected-page design in [ADR 0001](0001-browser-broker.md) is a portable baseline, but its owner is still subject to page lifecycle decisions. A SharedWorker can place the adapter outside any one page and connect sibling pages through direct `MessagePort` instances. SharedWorker construction alone is not a sufficient capability signal: the worker must also support the required runtime, agree on the deployed protocol and runtime identity, initialize successfully, and remain reclaimable under the browser's lifecycle policy.

The control plane must not create a page-owned runtime after a SharedWorker has already begun initializing the same adapter. Topology selection therefore needs a commitment boundary, not a catch-all fallback.

## Decision

Expose three application policies through `createAdaptiveBrowserBroker`:

- `auto`: attempt the SharedWorker path when its lifecycle is considered portable, then use the page-owner path only for eligible pre-commit failures.
- `shared-worker`: require the SharedWorker path and surface failures without changing topology.
- `page-owner`: use the Web Lock, IndexedDB epoch journal, and BroadcastChannel path directly.

The SharedWorker client and host use a protocol v2 control handshake:

1. The client sends `hello` with namespace, protocol version, runtime fingerprint, and required capabilities.
2. The host validates the identity and capabilities, then answers `prepared` without initializing the broker.
3. The client validates the prepared host and sends `commit`.
4. The host commits its broker control path, then answers `ready`. Adapter initialization continues under fenced ownership and is exposed through the broker snapshot.

The control-frame `ready` means that the committed host transport exists; it does not mean the provider is ready to accept inference. Clients wait for `snapshot.readiness === 'ready'` before admitting work. This separation keeps a slow model load from being mistaken for a failed handshake while still propagating initialization failure as a terminal broker failure.

Construction, capability, or transport failures before commit can produce an `auto` fallback. A failure after commit is a startup failure. It does not start a page-owned adapter in parallel with a host whose outcome is uncertain.

The client-facing broker uses a passive election port in SharedWorker mode. The host owns the actual broker, fencing lease, transport bridge, and inference adapter. Direct ports carry client traffic; the host bridge retains the versioned broker protocol and can coordinate with the same-origin page-owner transport.

The default `auto` lifecycle policy treats Apple WebKit user agents without a Chromium-family lifecycle as non-portable and selects `page-owner` before constructing a worker. Applications can choose explicit `shared-worker`, or `lifecyclePolicy: 'best-effort'` with `auto`, when they accept the platform-specific lifecycle risk. This probe is a conservative product policy, not a browser support guarantee.

## Lifecycle controls

- The host challenges newly attached and reattached ports before accepting protocol traffic.
- Ping/pong liveness removes stale clients; an orphaned active host shuts down rather than retaining its fencing lease indefinitely.
- A bounded queue preserves in-flight protocol traffic only while the same port re-handshakes with the same host identity; it is not worker-process recovery.
- An unused host stops after a configurable idle interval.
- Host, adapter, or transport failure becomes a terminal broker failure instead of leaving clients apparently ready.

## Consequences

- Applications can prefer a worker-owned runtime without losing the page-owner baseline.
- Topology selection is observable through `selection.topology` and `selection.fallbackReason`.
- The application must bundle a real SharedWorker entry and supply the same namespace, configuration, adapter identity, and runtime fingerprint on both sides.
- A bundler-specific worker constructor should be passed through `workerFactory`. Vite consumers use `?sharedworker`; a synthetic URL is unnecessary.
- User-agent lifecycle policy remains intentionally conservative and may need revision as browser behavior changes.
- Runtime work can still restart after a fencing takeover, so provider execution remains at-least-once.

## Alternatives

- SharedWorker only: rejected because lifecycle and required runtime capabilities are not uniformly portable.
- Page owner only: retained as a policy but no longer the only topology.
- Fall back after any error: rejected because it can initialize two runtimes after an ambiguous commit.
- ServiceWorker owner: not adopted; its event-driven lifecycle does not provide the long-lived ownership contract required here.
- Dedicated worker per page: rejected because it does not share a runtime across sibling pages.

## Boundaries

This decision does not add cross-origin coordination, a durable queue, request replay after every page and worker closes, or a ServiceWorker runtime owner.

## Reversal cost

Low to moderate. Topology selection and transport are behind explicit factories and ports. The broker protocol, adapter contract, fencing semantics, and page-owner implementation remain independently reusable.
