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

| Browser  | Coordination demo | Real model adapter |
| -------- | ----------------- | ------------------ |
| Chromium | Targeted in CI    | Not yet verified   |
| Firefox  | Targeted in CI    | Not yet verified   |
| WebKit   | Targeted in CI    | Not yet verified   |

The deterministic adapter is the only release-gated adapter in the first alpha. WebLLM and Transformers.js remain documented integration seams until dedicated runtime tests are added.
