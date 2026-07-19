# ADR 0001: elected page as browser inference owner

- Status: accepted as the page-owner topology
- Date: 2026-07-17

## Context

Loading one local model runtime in every sibling page can multiply scarce browser memory. A SharedWorker can centralize work, but lifecycle support and runtime compatibility vary, and a dedicated worker still belongs to one page. The alpha needs an observable, replaceable approach that can be tested in ordinary pages.

## Decision

Use an exclusive Web Lock to elect one page in the current storage bucket. Assign a monotonic epoch from an IndexedDB journal while the lock is held. Use BroadcastChannel for protocol envelopes. Put both behind ports so another transport or test coordinator can replace them later.

The elected page owns exactly one inference adapter instance. Peer pages own client sessions only. Every owner-originated envelope carries owner identity and epoch. Clients accept state only from the newest announced epoch and accept at most one terminal result per request.

## Consequences

- No backend is required for same-origin coordination.
- HTTPS is required outside loopback development because Web Locks is a secure-context API.
- BroadcastChannel follows storage partitioning, not merely matching origin strings.
- IndexedDB epoch advancement can fail because of site-storage policy; acquisition fails closed rather than using an in-memory epoch.
- A page suspended by the browser may delay progress; takeover is governed by actual lock release, not heartbeat alone.
- Streaming can restart after takeover. The client terminal outcome is single, while provider execution remains at-least-once.
- Durable recovery after all pages close needs a future persistence layer and is not implied by this alpha.

## Alternatives

- SharedWorker: added as an adaptive topology by [ADR 0003](0003-adaptive-topology.md), but not the only core topology.
- Service worker: lifecycle is browser-controlled and unsuitable as the sole long-lived model owner contract.
- Generic tab-election dependency: useful reference, but it does not remove the inference-specific state machine and fencing work.
- One runtime per page: simplest but fails the product objective.

## Reversal cost

Low. Election and transport are ports; the session protocol and adapter contract remain reusable.
