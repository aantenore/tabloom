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

## WebLLM seam

[WebLLM](https://github.com/mlc-ai/web-llm) already supplies model loading, caching, WebGPU execution, and OpenAI-shaped chat streaming. A TabLoom adapter can map the contract as follows:

| TabLoom hook         | WebLLM responsibility                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `initialize(signal)` | Create one engine and select a model in the elected page                  |
| `run(request, ctx)`  | Start a streaming chat completion; emit each delta through `ctx.emit`     |
| `ctx.signal`         | Stop consuming the stream and call the runtime interruption API if needed |
| `dispose()`          | Unload model resources before releasing ownership                         |

This repository does not install WebLLM, choose a model, or claim runtime compatibility in the alpha. Pin a tested WebLLM version in the consuming application and add model-specific browser tests before changing the evidence label.

## Transformers.js seam

[Transformers.js](https://huggingface.co/docs/transformers.js/main/en/index) exposes browser pipelines and task-specific streaming mechanisms. A TabLoom adapter can initialize one pipeline in the owner, convert provider callbacks into `ctx.emit` calls, and dispose task resources when leadership ends.

Pipeline input/output shapes differ substantially by task. Keep that schema in the adapter type parameters rather than adding provider cases to the broker core.

## Why integrations stay optional

- Applications can choose runtime, model, quantization, cache, and worker topology independently.
- The core package remains small and does not force WebGPU on consumers.
- Provider upgrades do not change the coordination protocol.
- The deterministic adapter keeps failure and takeover tests reproducible on CI runners without GPU claims.
