# Compatibility matrix

## Browser APIs

| Capability       | Requirement                                      | Alpha behavior                                                                  |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Web Locks        | Secure context or loopback development           | Runtime ownership fails with a typed capability error when absent               |
| BroadcastChannel | Same storage partition                           | The page-owner path and host bridge fail when the channel cannot be constructed |
| IndexedDB        | Same storage partition and writable site storage | Epoch acquisition fails closed with `EPOCH_JOURNAL_FAILED`                      |
| Web Crypto       | SHA-256 digest and cryptographic UUID support    | Fingerprint creation or default identity generation fails closed                |
| SharedWorker     | Optional, same-origin module worker              | `auto` can pre-fallback; explicit mode surfaces a typed startup failure         |
| MessagePort      | Structured-clone messages between page and host  | Invalid, mismatched, or failed control traffic is rejected                      |

MDN classifies both [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) and [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) as widely available. The release contract still relies on executable tests rather than that label alone.

## Topology policy

| Mode            | Selection contract                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `page-owner`    | Requires Web Locks, IndexedDB, and BroadcastChannel; no SharedWorker is constructed                                              |
| `shared-worker` | Requires the worker host and its declared capabilities; failure is surfaced and no topology switch occurs                        |
| `auto`          | Uses the portable lifecycle policy, then falls back only for eligible SharedWorker failures before the handshake commit boundary |

The portable policy pre-selects `page-owner` on Apple WebKit user agents without a Chromium-family lifecycle. `lifecyclePolicy: 'best-effort'` bypasses that policy in `auto`; explicit SharedWorker also attempts construction. Those choices are experimental on lifecycle policies where closing the creating page can leave worker ownership in an ambiguous state.

Capability availability is necessary but not sufficient. Pages and the worker host must also agree on namespace, protocol v2, runtime fingerprint, and all declared host capabilities before the client commits.

## Release evidence

The v0.2 page-owner baseline below records previously verified evidence. The v0.3 release gate adds adaptive selection, SharedWorker handshake and traffic, mismatch rejection, pre-commit fallback, same-port liveness and re-handshake, and creator-page lifecycle scenarios. These scenarios constrain the release; they do not expand into a claim about every browser build or device policy.

| Browser engine | Version       | Page-owner baseline | Adaptive v0.3 policy                                             | Real model adapter        |
| -------------- | ------------- | ------------------- | ---------------------------------------------------------------- | ------------------------- |
| Chromium       | 149.0.7827.55 | Verified            | SharedWorker execution is part of the deterministic release gate | See Chrome evidence below |
| Firefox        | 151.0         | Verified            | SharedWorker execution is part of the deterministic release gate | Not yet verified          |
| WebKit         | 26.5          | Verified            | Portable `auto` pre-fallback is part of the release gate         | Not yet verified          |

The deterministic adapter remains the repeatable cross-browser release authority. The WebLLM adapter has unit, package, and type gates in the normal suite plus a separate opt-in real-model test. Its SharedWorker lab is not a universal WebGPU, browser, model, or lifecycle compatibility statement. Transformers.js remains a documented, unverified seam.

## WebLLM provider evidence

| Field    | Verified value                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Date     | 2026-07-19                                                                                                         |
| Browser  | Installed Google Chrome 150.0.0.0, headless Playwright channel                                                     |
| WebGPU   | Available; adapter acquired; WebLLM reported Apple GPU                                                             |
| Provider | `@mlc-ai/web-llm` 0.2.84                                                                                           |
| Model    | `SmolLM2-360M-Instruct-q4f16_1-MLC`                                                                                |
| Topology | Two same-origin pages, one elected page owner and one peer                                                         |
| Result   | Provider initialized on the owner; peer received a non-empty stream/result, positive token usage, and one terminal |

The initial exploratory run completed the provider request but surfaced console noise from an already-running Vite server reoptimizing the newly installed dependency. The final acceptance run started a clean server and passed the complete gate in 46.5 seconds with zero console or page errors. That timing describes this one environment and is not a throughput benchmark.

This matrix reports the recorded baseline and configured release scenarios, not every vendor browser build or mobile lifecycle policy. The exact results for a release come from its final CI run. Site storage policy, private modes, worker eviction, GPU drivers, and model fit can still change behavior outside the tested environment.
