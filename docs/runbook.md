# Alpha runbook

## Startup

1. Serve the app from HTTPS or loopback development.
2. Derive one runtime fingerprint from the deployed adapter, model, build, and behavior-affecting configuration. Use the same value in every page and worker entry for the namespace.
3. Select `auto`, `shared-worker`, or `page-owner` as an application policy rather than inferring it from UI state.
4. Validate broker configuration before opening a channel or constructing a worker.
5. Verify Web Locks, BroadcastChannel, IndexedDB, Web Crypto, and cryptographic UUID support. Verify SharedWorker and declared host capabilities when that topology is required.
6. Start the selected broker and wait for readiness before admitting work.

For Vite, import the host with `?sharedworker` and pass its constructor through `workerFactory`. Do not provide a placeholder URL. In `auto`, record the returned topology and optional fallback reason. A pre-commit fallback is expected recovery; a post-commit startup failure is terminal and must not be followed by manual page-runtime construction.

For the WebLLM adapter, install exactly `@mlc-ai/web-llm@0.2.84`, keep `maxConcurrent: 1`, and select a model that fits the target device. The first elected owner may need to download model artifacts; peers remain unready until that initialization completes.

## Monitoring

Track safe event counts by type, queue depth, request duration, selected topology, fallback reason, owner transitions, stale-envelope rejection, protocol rejection, runtime mismatch, epoch-journal failure, same-port re-handshake, and host failure. Do not attach prompts, generated text, token content, raw runtime manifests, or full request objects.

## Common failures

- Capability error: use a supported secure-context browser.
- Protocol mismatch: deploy one protocol-compatible bundle across open pages; ask users to refresh old pages.
- Runtime mismatch: verify that page and worker manifests contain the same adapter, model, build, and behavior-affecting configuration; refresh mixed deployments.
- Epoch journal failure: inspect IndexedDB availability, quota, corruption, transaction aborts, and site-storage policy. Fail closed; do not substitute an in-memory counter.
- SharedWorker unavailable before commit: let `auto` use the reported page-owner fallback or surface the explicit-mode failure.
- SharedWorker failure after commit: surface startup failure and stop; do not create a page-owned runtime while host outcome is uncertain.
- Stale worker client: inspect page suspension and MessagePort delivery. The host liveness policy should remove the client and release an orphaned host.
- Admission rejection: reduce request rate or increase the validated capacity within the device budget.
- Repeated takeover: inspect page suspension, crashes, adapter initialization, and deployment version skew.
- Timeout: cancel provider work and surface a recoverable client state.
- WebLLM load failure: inspect WebGPU availability, model compatibility, artifact access, and device limits; do not silently widen execution to a remote provider.
- WebLLM cancellation stall: retain the owner until the interrupted iterator drains and unload completes.

## Rollback

Pin `topology.mode` to `page-owner` to roll back SharedWorker selection while preserving the broker protocol and fencing contract. For a full rollback, disable TabLoom at the application composition boundary and instantiate the existing per-page runtime. Stop the broker before replacing the adapter so the owner can interrupt, drain, and unload WebLLM.

The broker does not own durable request data in this alpha. Do not clear IndexedDB as routine error recovery: deleting site storage resets the fencing journal and should be treated as a coordination reset after every participating context has stopped.

## Support evidence

Collect package version, protocol version, runtime fingerprint, selected topology, fallback reason, browser version, owner transition counts, queue depth, safe error code, and timestamps. Never request inference payloads or unhashed runtime configuration for routine diagnosis.

## Laboratory routes

- `/shared-worker.html` uses the deterministic adapter and exposes selected topology, fallback reason, fingerprint compatibility, host identity, fencing epoch, cancellation, and bounded admission without claiming provider execution.
- `/webllm.html` is the opt-in real-provider lab. Add `?topology=shared-worker` to exercise its worker host. Run it only when model download and local GPU execution are acceptable.

Neither lab is a durable-replay, cross-origin, or ServiceWorker demonstration.
