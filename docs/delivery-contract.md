# Delivery contract: TabLoom alpha

## Objective

Prove that sibling pages can share one browser inference owner through an explicit adaptive topology, while preserving bounded load, runtime compatibility, and a deterministic client outcome across owner loss.

## Users

- Browser application engineers embedding local inference.
- Platform engineers who need provider-neutral coordination and measurable failure behavior.

## Scope

Must:

- Elect exactly one live owner in a same-origin storage partition.
- Fence every owner with a monotonic epoch.
- Stream requests from peers through the owner.
- Bound admission, support cancellation and timeout, and reject stale output.
- Negotiate protocol versions before work is accepted.
- Negotiate a deterministic runtime fingerprint before work is accepted.
- Select `auto`, `shared-worker`, or `page-owner` without starting a fallback runtime after the SharedWorker commit boundary.
- Advance fencing epochs atomically in an IndexedDB journal.
- Expose telemetry that contains state, counts, and timings but not inference payloads.
- Demonstrate takeover and a single accepted terminal outcome in a real multi-page browser test.

Should:

- Keep election, transport, clock, identity, telemetry, and inference runtime replaceable.
- Supply a visual demo that makes ownership and request lineage understandable.
- Supply a deterministic lab that exposes selected topology, fallback reason, runtime compatibility, and SharedWorker request behavior.
- Document optional WebLLM and Transformers.js adapter seams without bundling either runtime.
- Supply a lazy, optional WebLLM adapter whose model and runtime policy remain host configuration.

Out of scope:

- Cross-origin coordination.
- ServiceWorker runtime ownership.
- Durable request replay after all same-origin pages and workers close.
- Exactly-once provider side effects.
- Claims about real WebGPU throughput or memory reduction.
- Authentication between scripts executing inside the same origin.

## Requirements and verification

| ID  | Requirement        | Priority | Acceptance criterion                                                                                          | Verification                            |
| --- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| R1  | Single owner       | Must     | Three live pages expose one owner and two peers                                                               | Playwright multi-page test              |
| R2  | Fencing            | Must     | A lower epoch cannot mutate a newer session                                                                   | Unit and takeover tests                 |
| R3  | Streaming          | Must     | A peer receives ordered chunks and one terminal result                                                        | Unit and browser tests                  |
| R4  | Admission          | Must     | Work beyond configured capacity fails with a typed error                                                      | Unit and browser tests                  |
| R5  | Cancellation       | Must     | Queued or active work can be cancelled                                                                        | Unit and browser tests                  |
| R6  | Timeout            | Must     | Expired work reaches one terminal timeout state                                                               | Unit test                               |
| R7  | Takeover           | Must     | Owner closure elects a successor and pending work can complete                                                | Browser test                            |
| R8  | Versioning         | Must     | Unsupported protocol traffic is rejected before adapter execution                                             | Unit test                               |
| R9  | Privacy            | Must     | Telemetry schemas cannot carry inference content                                                              | Type review and unit test               |
| R10 | Packaging          | Must     | ESM package installs and imports in a clean consumer                                                          | Package smoke test                      |
| R11 | Provider isolation | Must     | Core and WebLLM subpath import without bundling or eagerly loading the provider                               | Package smoke and bundle-size assertion |
| R12 | Real runtime seam  | Should   | One Chrome/WebGPU owner serves a peer request through WebLLM with matching stream/result and one terminal     | Opt-in live Playwright test             |
| R13 | Runtime identity   | Must     | A different runtime fingerprint is rejected before the adapter receives work                                  | Unit and browser mismatch tests         |
| R14 | Adaptive topology  | Must     | `auto` selects one topology and falls back only for eligible failures before commit                           | Unit and browser tests                  |
| R15 | Shared host        | Must     | Multiple clients share one committed worker host and one admission budget                                     | Unit and browser tests                  |
| R16 | Epoch journal      | Must     | Concurrent advancement is atomic, monotonic, validated, and fails closed on storage error                     | IndexedDB unit tests                    |
| R17 | Host lifecycle     | Must     | Stale clients, same-port re-handshake, creator closure, idle shutdown, and host failure have bounded outcomes | Unit and browser tests                  |
| R18 | Worker packaging   | Must     | The worker-safe subpaths install and a Vite `?sharedworker` consumer builds without a placeholder URL         | Package and consumer smoke tests        |

## Acceptance threshold

All must-level requirements pass; unit coverage meets configured thresholds; lint, types, builds, package checks, dependency audit, and the supported deterministic browser matrix pass; no known critical or high-severity defect remains. SharedWorker evidence distinguishes direct execution from portable pre-fallback. Real-runtime evidence records the exact browser, provider, model, GPU report, and date instead of expanding into a generic compatibility claim.

## Delivery mode

Short-lived feature branch, public pull request, exact fast-forward to `main`, annotated prerelease tag, generated archive and checksum, then a fresh-clone audit.
