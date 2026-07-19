# ADR 0002: keep WebLLM behind an optional adapter

- Status: accepted
- Date: 2026-07-19

## Context

The first TabLoom alpha proved fenced multi-page coordination with a deterministic adapter. Leaving every real runtime as application glue made the central composition claim harder to verify. Bundling a browser model runtime into the core would instead couple protocol evolution to a large, fast-moving provider and impose WebGPU code on consumers that do not use it.

WebLLM already owns model loading, artifact caching, WebGPU execution, OpenAI-shaped streaming, and worker topologies. Its Service Worker option can preserve a runtime across page visits, but it has a different ownership model from TabLoom's elected live page.

## Decision

Ship `WebLlmInferenceAdapter` only through `@aantenore/tabloom/adapters/webllm`.

- Pin the optional peer and development contract to WebLLM `0.2.84`.
- Import WebLLM lazily during elected-owner initialization.
- Let the host configure the model, engine, cache, chat options, and progress observer.
- Override payload-level model selection, choice count, and streaming mode.
- Allow one active generation per owner; reject a competing run.
- On cancellation, interrupt and drain the provider stream before releasing its lock.
- On disposal, wait for active cleanup and unload the engine before ownership ends.
- Keep deterministic adapters as the repeatable CI conformance authority.

## Consequences

Core users do not download or execute WebLLM. Provider users get a maintained composition point and an opt-in real-model test, but compatibility is deliberately narrow: exact provider version, selected model, installed Chrome, WebGPU-capable device, and same-origin secure context.

WebLLM's Service Worker engine is not nested inside TabLoom. Applications choose either that worker lifecycle or TabLoom's provider-neutral page election according to their operational needs.
