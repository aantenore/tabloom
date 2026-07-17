# Market and build-vs-buy review

Reviewed 2026-07-17.

## Existing building blocks

| Project or API                                                                                  | What it covers                                                | License / status                                | Gap relative to TabLoom                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Web Locks API](https://www.w3.org/TR/web-locks/)                                               | Exclusive resource ownership inside a storage bucket          | Web standard; secure context                    | No inference protocol, epoch store, queue, stream, or client terminal semantics          |
| [Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API) | Same-partition message bus                                    | Web standard                                    | No message contract or negotiation                                                       |
| [tab-election](https://github.com/dabblewriter/tab-election)                                    | Browser leader election and generic calls                     | MIT package, v4.6.1 reviewed                    | Generic ownership; no inference fencing, streaming lifecycle, or privacy contract        |
| [broadcast-channel](https://github.com/pubkey/broadcast-channel)                                | Cross-runtime channel plus leader election                    | MIT, actively maintained                        | Broader compatibility than this alpha needs; inference semantics remain application work |
| [WebLLM](https://github.com/mlc-ai/web-llm)                                                     | In-browser LLM runtime with WebGPU and worker support         | Apache-2.0                                      | Runtime rather than multi-page ownership protocol                                        |
| [Transformers.js](https://huggingface.co/docs/transformers.js/main/en/index)                    | Browser inference across many model tasks                     | Apache-2.0                                      | Runtime rather than multi-page ownership protocol                                        |
| react-brai                                                                                      | Closed React hook advertised for one WebGPU owner across tabs | Hosted demo; source not published when reviewed | Closest product thesis, but framework-specific and not independently auditable           |

## Decision

Build a narrow protocol layer and reuse browser primitives. Do not build a model runtime and do not bundle a provider. Keep adapters optional so WebLLM, Transformers.js, or a future runtime can be composed at the edge.

The global `tabloom` package name is occupied by an unrelated React Native table package. This project uses the available `@aantenore/tabloom` scope. The GitHub repository name is available under the `aantenore` account, although unrelated repositories use the same word elsewhere.

## Differentiation score

**3 / 4**: a meaningful architecture and verification advantage. The wedge is provider-neutral fencing, admission, session lifecycle, takeover behavior, and multi-browser evidence. It is not defensible through the election primitive alone.

## Revisit trigger

Reassess build-vs-buy if a maintained open-source project ships the same provider-neutral protocol, fenced takeover contract, and browser conformance suite.
