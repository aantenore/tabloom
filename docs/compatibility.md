# Compatibility matrix

## Browser APIs

| Capability       | Requirement                            | Alpha behavior                                           |
| ---------------- | -------------------------------------- | -------------------------------------------------------- |
| Web Locks        | Secure context or loopback development | Startup fails with a typed capability error when absent  |
| BroadcastChannel | Same storage partition                 | Startup fails with a typed capability error when absent  |
| Web Crypto UUID  | Modern browser                         | A replaceable ID provider permits controlled tests       |
| Local storage    | Available for epoch persistence        | Acquisition fails closed if the epoch cannot be advanced |

MDN classifies both [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) and [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) as widely available. The release matrix still relies on executable tests rather than that label alone.

## Release evidence

Playwright 1.61.1 executed the same four deterministic multi-page scenarios in every bundled engine on 2026-07-17. The separate provider smoke was executed on 2026-07-19.

| Browser engine | Version       | One owner + stream | Cancel + drain | Backpressure | Takeover + single terminal | Real model adapter        |
| -------------- | ------------- | ------------------ | -------------- | ------------ | -------------------------- | ------------------------- |
| Chromium       | 149.0.7827.55 | Pass               | Pass           | Pass         | Pass                       | See Chrome evidence below |
| Firefox        | 151.0         | Pass               | Pass           | Pass         | Pass                       | Not yet verified          |
| WebKit         | 26.5          | Pass               | Pass           | Pass         | Pass                       | Not yet verified          |

The deterministic adapter remains the repeatable cross-browser release gate. The WebLLM adapter has unit, package, and type gates in the normal suite plus a separate opt-in real-model test. Transformers.js remains a documented, unverified seam.

## WebLLM provider evidence

| Field    | Verified value                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Date     | 2026-07-19                                                                                                         |
| Browser  | Installed Google Chrome 150.0.0.0, headless Playwright channel                                                     |
| WebGPU   | Available; adapter acquired; WebLLM reported Apple GPU                                                             |
| Provider | `@mlc-ai/web-llm` 0.2.84                                                                                           |
| Model    | `SmolLM2-360M-Instruct-q4f16_1-MLC`                                                                                |
| Topology | Two same-origin pages, one owner and one peer                                                                      |
| Result   | Provider initialized on the owner; peer received a non-empty stream/result, positive token usage, and one terminal |

The initial exploratory run completed the provider request but surfaced console noise from an already-running Vite server reoptimizing the newly installed dependency. The final acceptance run started a clean server and passed the complete gate in 46.5 seconds with zero console or page errors. That timing describes this one environment and is not a throughput benchmark.

This matrix reports bundled test engines, not every vendor browser build or mobile lifecycle policy. CI reruns the scenarios on every pull request and `main` update.
