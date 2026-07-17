# Alpha runbook

## Startup

1. Serve the app from HTTPS or loopback development.
2. Validate broker configuration before opening the channel.
3. Verify Web Locks, BroadcastChannel, local storage, and crypto UUID support.
4. Start the broker and wait for an owner announcement before admitting peer work.

## Monitoring

Track safe event counts by type, queue depth, request duration, owner transitions, stale-envelope rejection, and protocol rejection. Do not attach prompts, generated text, token content, or full request objects.

## Common failures

- Capability error: use a supported secure-context browser.
- Protocol mismatch: deploy one compatible bundle across open pages; ask users to refresh old pages.
- Admission rejection: reduce request rate or increase the validated capacity within the device budget.
- Repeated takeover: inspect page suspension, crashes, adapter initialization, and deployment version skew.
- Timeout: cancel provider work and surface a recoverable client state.

## Rollback

Disable TabLoom at the application composition boundary and instantiate the existing per-page runtime. The broker does not own durable application data in this alpha.

## Support evidence

Collect package version, protocol version, browser version, owner transition counts, queue depth, safe error code, and timestamps. Never request inference payloads for routine diagnosis.
