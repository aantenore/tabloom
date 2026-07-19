# Threat model

## Assets

- Inference inputs and generated chunks.
- Browser memory and compute capacity.
- Request identity, lifecycle, and terminal state.
- Adapter configuration and model cache state.
- Runtime compatibility identity and fencing journal integrity.

## Trust boundaries

- All participating pages must share a browser storage partition and origin.
- The inference adapter is trusted application code.
- Browser APIs and structured-clone transport form the runtime boundary.
- The SharedWorker host is trusted application code in the same origin; direct ports do not create an authorization boundary.
- Telemetry consumers receive only the documented safe event schema.

## Abuse and failure cases

| Case                                     | Control                                                                                     | Residual risk                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Stale owner emits after takeover         | Monotonic IndexedDB epochs and client-side fencing                                          | A stale adapter may continue local computation until context disposal         |
| Mixed deployment changes runtime meaning | Protocol v2 runtime fingerprint on handshakes and envelopes                                 | A wrongly constructed common manifest can label incompatible runtimes equally |
| Request flood exhausts memory            | One host admission budget, fixed queue capacity, and one active slot by default             | A same-origin hostile script can repeatedly retry                             |
| Client disappears                        | Timeout, cancellation, port liveness, bounded same-port re-handshake queue, and cleanup     | Abrupt suspension can delay signals until the liveness bound                  |
| Host becomes orphaned                    | Stale-client detection stops the broker and releases its lease                              | Browser process failure can delay or prevent JavaScript cleanup               |
| Unsupported message shape                | Runtime envelope validation plus prepared/commit control negotiation                        | A same-origin script can still create channel or port noise                   |
| Epoch record is corrupt or unavailable   | Validated atomic transaction fails closed with `EPOCH_JOURNAL_FAILED`                       | Site-data deletion resets the journal after contexts restart                  |
| Sensitive content reaches diagnostics    | Telemetry type excludes payload fields; labs expose lifecycle state rather than prompt data | Application adapters can violate their own logging policy                     |
| Fingerprint is treated as authentication | Documentation defines it only as a compatibility identity                                   | Any same-origin script can observe or reproduce the fingerprint               |
| Identifier collision                     | Cryptographic browser IDs by default                                                        | Custom ID providers must preserve uniqueness                                  |
| Cross-site leakage                       | Browser origin and storage-partition isolation                                              | Compromised same-origin script remains in scope                               |
| Provider runtime survives ownership loss | Lease or host loss aborts work; WebLLM adapter interrupts, drains, then unloads             | Browser or GPU-driver failure can delay resource reclamation                  |
| Fallback initializes a second runtime    | `auto` falls back only before commit; post-commit uncertainty is a terminal startup failure | Application code can violate the contract by creating its own fallback        |

## Security non-claims

TabLoom is not a sandbox, authorization service, signed runtime attestation, or isolation boundary for mutually untrusted scripts on one origin. Provider adapters must perform any model-specific validation and safety handling.

The IndexedDB journal is fencing metadata, not a durable request log. SharedWorker does not make requests recoverable after all execution contexts close, and ServiceWorker ownership is not part of this contract.

## Verification

- Invalid and unsupported envelopes never invoke the adapter.
- Protocol, namespace, capability, and runtime-fingerprint mismatches fail before SharedWorker host commit.
- Older epochs cannot complete a current session.
- Capacity, cancellation, timeout, takeover, same-port re-handshake, stale-client cleanup, and transactional fallback have regression tests.
- Dependency and package audits run in CI.
- Package smoke verifies the optional WebLLM provider is not bundled into the adapter entry and worker-safe subpaths remain consumable.
