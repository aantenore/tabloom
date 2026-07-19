# ADR 0004: bind protocol traffic to runtime identity and journal epochs in IndexedDB

- Status: accepted for alpha
- Date: 2026-07-19

## Context

A protocol version says that two deployments understand the same envelope shape. It does not prove that they run a compatible adapter, model, application build, or behavior-affecting configuration. During a rolling deployment, an older page can otherwise discover a newer owner under the same namespace and send work whose runtime meaning has changed.

Fencing also requires durable, atomic epoch advancement. A local-storage read followed by a write is synchronous but is not a transactional journal and offers weak failure normalization for concurrent owner attempts.

## Decision

Require every broker configuration to provide a runtime fingerprint in the form `sha256:<64 lowercase hexadecimal characters>`.

`createRuntimeFingerprint` builds the digest from a canonical manifest:

- Protocol v2 is included by TabLoom and cannot be overridden by the caller.
- Caller components are deterministically ordered.
- The application supplies stable identifiers for the adapter, model, build, and behavior-affecting configuration it needs to keep compatible.
- Prompts, generated content, credentials, and other secrets do not belong in the manifest.

Every broker envelope and SharedWorker control handshake carries the fingerprint. A different fingerprint is rejected before adapter work is admitted. The value is a compatibility identity only; it is not an authorization mechanism, signed attestation, or confidentiality control.

Store fencing epochs in an IndexedDB journal keyed by namespace. Each atomic read-write transaction validates the current record, advances the safe integer epoch, and stores the new epoch with the current fingerprint, schema version, and update timestamp. Corrupt records, unavailable storage, transaction failures, and counter exhaustion fail closed with `EPOCH_JOURNAL_FAILED`.

The epoch remains monotonic for a namespace across compatible and incompatible deployments. The stored fingerprint is diagnostic journal context; protocol negotiation, not the journal record, enforces runtime compatibility.

## Consequences

- Mixed deployments with different runtime meaning fail explicitly instead of exchanging inference work.
- The same manifest must resolve to the same digest in every page and SharedWorker entry that uses a namespace.
- Changing a model or behavior-affecting configuration normally changes the fingerprint, even when the wire protocol does not change.
- Epoch advancement has an asynchronous storage dependency and broker startup fails when IndexedDB cannot commit it.
- Clearing site data resets the journal and can reset the epoch. Applications must treat site-data deletion as a coordination reset, not routine recovery.
- The fingerprint is visible coordination metadata and must contain no sensitive values.

## Alternatives

- Protocol version only: rejected because schema compatibility is weaker than runtime compatibility.
- Raw JSON configuration in every envelope: rejected because it increases data exposure and couples the protocol to provider-specific configuration.
- Random deployment identifier: rejected because independently loaded pages need a reproducible identity.
- Local storage counter: replaced because epoch advancement should use an explicit atomic transaction and validated record.
- Server-issued epoch: unnecessary for the same-origin, backend-free alpha and incompatible with offline local inference as a baseline.

## Boundaries

The journal is not a durable request log. It cannot resume queued work after all execution contexts close, coordinate different origins, or provide exactly-once provider side effects.

## Reversal cost

Moderate. The fingerprint is part of protocol v2 and broker configuration. The epoch store remains behind a port, so another transactional implementation can replace IndexedDB without changing session semantics.
