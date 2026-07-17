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

Playwright 1.61.1 executed the same four multi-page scenarios in every engine on 2026-07-17.

| Browser engine | Version       | One owner + stream | Cancel + drain | Backpressure | Takeover + single terminal | Real model adapter |
| -------------- | ------------- | ------------------ | -------------- | ------------ | -------------------------- | ------------------ |
| Chromium       | 149.0.7827.55 | Pass               | Pass           | Pass         | Pass                       | Not yet verified   |
| Firefox        | 151.0         | Pass               | Pass           | Pass         | Pass                       | Not yet verified   |
| WebKit         | 26.5          | Pass               | Pass           | Pass         | Pass                       | Not yet verified   |

The deterministic adapter is the only release-gated adapter in the first alpha. WebLLM and Transformers.js remain documented integration seams until dedicated runtime tests are added.

This matrix reports bundled test engines, not every vendor browser build or mobile lifecycle policy. CI reruns the scenarios on every pull request and `main` update.
