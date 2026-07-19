# Threat model

## Assets

- Inference inputs and generated chunks.
- Browser memory and compute capacity.
- Request identity, lifecycle, and terminal state.
- Adapter configuration and model cache state.

## Trust boundaries

- All participating pages must share a browser storage partition and origin.
- The inference adapter is trusted application code.
- Browser APIs and structured-clone transport form the runtime boundary.
- Telemetry consumers receive only the documented safe event schema.

## Abuse and failure cases

| Case                                  | Control                                                                     | Residual risk                                                      |
| ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Stale owner emits after takeover      | Monotonic epochs and client-side fencing                                    | A stale adapter may continue local computation until page disposal |
| Request flood exhausts memory         | Fixed queue capacity and one active slot by default                         | A same-origin hostile script can repeatedly retry                  |
| Client disappears                     | Timeout, cancellation, and terminal cleanup                                 | Abrupt suspension can delay the signal                             |
| Unsupported message shape             | Runtime envelope validation and protocol negotiation                        | A same-origin script can still create channel noise                |
| Sensitive content reaches diagnostics | Telemetry type excludes payload fields; demo stores counts and lengths only | Application adapters can violate their own logging policy          |
| Identifier collision                  | Cryptographic browser IDs by default                                        | Custom ID providers must preserve uniqueness                       |
| Cross-site leakage                    | Browser origin and storage-partition isolation                              | Compromised same-origin script remains in scope                    |
| Provider runtime survives owner loss  | Lease loss aborts work; WebLLM adapter interrupts, drains, then unloads     | Browser or GPU-driver failure can delay resource reclamation       |

## Security non-claims

TabLoom is not a sandbox, authorization service, or isolation boundary for mutually untrusted scripts on one origin. Provider adapters must perform any model-specific validation and safety handling.

## Verification

- Invalid and unsupported envelopes never invoke the adapter.
- Older epochs cannot complete a current session.
- Capacity, cancellation, timeout, and takeover have regression tests.
- Dependency and package audits run in CI.
- Package smoke verifies the optional WebLLM provider is not bundled into the adapter entry.
