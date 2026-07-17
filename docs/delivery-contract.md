# Delivery contract: TabLoom alpha

## Objective

Prove that sibling pages can share one browser inference owner without multiplying model runtimes, while preserving bounded load and a deterministic client outcome across owner loss.

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
- Expose telemetry that contains state, counts, and timings but not inference payloads.
- Demonstrate takeover and a single accepted terminal outcome in a real multi-page browser test.

Should:

- Keep election, transport, clock, identity, telemetry, and inference runtime replaceable.
- Supply a visual demo that makes ownership and request lineage understandable.
- Document optional WebLLM and Transformers.js adapter seams without bundling either runtime.

Out of scope:

- Cross-origin coordination.
- Durable request recovery after all same-origin pages close.
- Exactly-once provider side effects.
- Claims about real WebGPU throughput or memory reduction.
- Authentication between scripts executing inside the same origin.

## Requirements and verification

| ID  | Requirement  | Priority | Acceptance criterion                                              | Verification               |
| --- | ------------ | -------- | ----------------------------------------------------------------- | -------------------------- |
| R1  | Single owner | Must     | Three live pages expose one owner and two peers                   | Playwright multi-page test |
| R2  | Fencing      | Must     | A lower epoch cannot mutate a newer session                       | Unit and takeover tests    |
| R3  | Streaming    | Must     | A peer receives ordered chunks and one terminal result            | Unit and browser tests     |
| R4  | Admission    | Must     | Work beyond configured capacity fails with a typed error          | Unit and browser tests     |
| R5  | Cancellation | Must     | Queued or active work can be cancelled                            | Unit and browser tests     |
| R6  | Timeout      | Must     | Expired work reaches one terminal timeout state                   | Unit test                  |
| R7  | Takeover     | Must     | Owner closure elects a successor and pending work can complete    | Browser test               |
| R8  | Versioning   | Must     | Unsupported protocol traffic is rejected before adapter execution | Unit test                  |
| R9  | Privacy      | Must     | Telemetry schemas cannot carry inference content                  | Type review and unit test  |
| R10 | Packaging    | Must     | ESM package installs and imports in a clean consumer              | Package smoke test         |

## Acceptance threshold

All must-level requirements pass; unit coverage meets configured thresholds; lint, types, builds, package checks, dependency audit, and the supported browser matrix pass; no known critical or high-severity defect remains. Real-runtime compatibility stays documented as unverified until exercised separately.

## Delivery mode

Short-lived feature branch, public pull request, exact fast-forward to `main`, annotated prerelease tag, generated archive and checksum, then a fresh-clone audit.
