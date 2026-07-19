# Runtime adapter integrations

TabLoom owns coordination and session lifecycle. The host application owns model selection, runtime configuration, caching policy, safety handling, and provider-specific validation.

## Stable seam

Implement `InferenceAdapter<TRequest, TChunk, TResult>`:

```ts
import type { InferenceAdapter } from '@aantenore/tabloom';

interface Request {
  readonly input: string;
}

interface Chunk {
  readonly text: string;
}

interface Result {
  readonly text: string;
}

export class ApplicationAdapter implements InferenceAdapter<
  Request,
  Chunk,
  Result
> {
  readonly descriptor = {
    evidence: 'provider-runtime',
    id: 'application-runtime',
    name: 'Application runtime',
    version: '1',
  } as const;

  async initialize(signal: AbortSignal): Promise<void> {
    // Create or load the model runtime only in the elected owner.
    signal.throwIfAborted();
  }

  async run(
    request: Request,
    context: Parameters<InferenceAdapter<Request, Chunk, Result>['run']>[1],
  ): Promise<Result> {
    context.signal.throwIfAborted();
    // Validate request, invoke the provider, then emit structured chunks.
    context.emit({ text: request.input });
    return { text: request.input };
  }

  async dispose(): Promise<void> {
    // Release provider resources when ownership ends.
  }
}
```

The adapter should:

- Make initialization abortable and release resources in `dispose`.
- Check `context.signal` during long work and provider streams.
- Treat `requestId`, `epoch`, and `attempt` as lifecycle metadata, not authorization.
- Avoid logging inputs or chunks through the telemetry port.
- Be safe for at-least-once execution after takeover, or enforce idempotency at its own side-effect boundary.

## Shipped WebLLM adapter

[WebLLM](https://github.com/mlc-ai/web-llm) already supplies model loading, caching, WebGPU execution, and OpenAI-shaped chat streaming. TabLoom ships an optional adapter at `@aantenore/tabloom/adapters/webllm`, pinned to the verified `0.2.84` contract.

| TabLoom hook         | WebLLM responsibility                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| `initialize(signal)` | Create one engine and load the configured model only in the elected page          |
| `run(request, ctx)`  | Stream OpenAI-shaped chunks, aggregate choice zero, and retain final usage        |
| `ctx.signal`         | Interrupt generation, drain the provider iterator, then report typed cancellation |
| `dispose()`          | Wait for active generation cleanup, unload resources, then release ownership      |

The package declares WebLLM as an optional exact peer. It uses a lazy import during owner initialization, so importing TabLoom or the adapter subpath does not load or bundle the provider. The host must install the peer, choose the model and cache policy, and provide the complete conversation history on every request.

The adapter deliberately fixes the configured model, `n = 1`, and streaming mode after merging the request. Keep the broker at `maxConcurrent: 1`, because WebLLM serializes work per model and its interruption API applies to the engine rather than one arbitrary request.

Do not place `ServiceWorkerMLCEngine` behind this adapter. WebLLM's service-worker topology and TabLoom's elected-page ownership are alternative runtime ownership strategies. TabLoom is useful when the application needs provider-neutral fencing, bounded admission, observable page ownership, and takeover semantics.

## Transformers.js seam

[Transformers.js](https://huggingface.co/docs/transformers.js/main/en/index) exposes browser pipelines and task-specific streaming mechanisms. A TabLoom adapter can initialize one pipeline in the owner, convert provider callbacks into `ctx.emit` calls, and dispose task resources when leadership ends.

Pipeline input/output shapes differ substantially by task. Keep that schema in the adapter type parameters rather than adding provider cases to the broker core.

## Why integrations stay optional

- Applications can choose runtime, model, quantization, cache, and worker topology independently.
- The core package remains small and does not force WebGPU on consumers.
- Provider upgrades do not change the coordination protocol.
- The deterministic adapter keeps failure and takeover tests reproducible on CI runners without GPU claims.

See [ADR 0002](adr/0002-optional-webllm-adapter.md) for the dependency and lifecycle decision.
