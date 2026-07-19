# Alpha runbook

## Startup

1. Serve the app from HTTPS or loopback development.
2. Validate broker configuration before opening the channel.
3. Verify Web Locks, BroadcastChannel, local storage, and crypto UUID support.
4. Start the broker and wait for an owner announcement before admitting peer work.

For the WebLLM adapter, install exactly `@mlc-ai/web-llm@0.2.84`, keep `maxConcurrent: 1`, and select a model that fits the target device. The first elected owner may need to download model artifacts; peers remain unready until that initialization completes.

## Monitoring

Track safe event counts by type, queue depth, request duration, owner transitions, stale-envelope rejection, and protocol rejection. Do not attach prompts, generated text, token content, or full request objects.

## Common failures

- Capability error: use a supported secure-context browser.
- Protocol mismatch: deploy one compatible bundle across open pages; ask users to refresh old pages.
- Admission rejection: reduce request rate or increase the validated capacity within the device budget.
- Repeated takeover: inspect page suspension, crashes, adapter initialization, and deployment version skew.
- Timeout: cancel provider work and surface a recoverable client state.
- WebLLM load failure: inspect WebGPU availability, model compatibility, artifact access, and device limits; do not silently widen execution to a remote provider.
- WebLLM cancellation stall: retain the owner until the interrupted iterator drains and unload completes.

## Rollback

Disable TabLoom at the application composition boundary and instantiate the existing per-page runtime. The broker does not own durable application data in this alpha. Stop the broker before replacing the adapter so the elected owner can interrupt, drain, and unload WebLLM.

## Support evidence

Collect package version, protocol version, browser version, owner transition counts, queue depth, safe error code, and timestamps. Never request inference payloads for routine diagnosis.
