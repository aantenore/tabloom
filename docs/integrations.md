# Runtime adapter integrations

TabLoom owns coordination and session lifecycle. The host application owns model selection, runtime configuration, caching policy, safety handling, and provider-specific validation.

## Stable seam

Implement `InferenceAdapter<TRequest, TChunk, TResult>` from the worker-safe core entry:

```ts
import type { InferenceAdapter } from '@aantenore/tabloom/core';

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

## Runtime identity

Protocol v2 requires a runtime fingerprint. Build it from the inputs that determine whether two execution contexts can safely exchange work:

```ts
import { createRuntimeFingerprint } from '@aantenore/tabloom/core';

export const runtimeFingerprint = await createRuntimeFingerprint({
  adapter: 'application-runtime@1',
  build: 'my-app@1',
  configuration: 'default',
  model: 'local-model-id',
});
```

The protocol version is included automatically. Add a component when changing it would change request interpretation, provider behavior, model output shape, or adapter lifecycle. Do not include prompts, credentials, signed URLs, user identifiers, or other secrets. The manifest values become a digest, but hashing does not make sensitive configuration safe to disclose.

Every page and SharedWorker entry under one namespace must resolve the same digest. A mixed deployment receives `RUNTIME_MISMATCH` before the adapter executes. The fingerprint is not authorization or remote attestation.

## SharedWorker host integration

The application owns the worker entry because only it knows the adapter and provider policy. With Vite, use the generated worker constructor rather than supplying a URL that the bundler cannot discover:

```ts
// app.ts
import TabLoomHost from './tabloom-host?sharedworker';
import { ApplicationAdapter } from './application-adapter';
import { runtimeFingerprint } from './runtime-identity';
import { createAdaptiveBrowserBroker } from '@aantenore/tabloom/shared-worker';

const selection = await createAdaptiveBrowserBroker({
  adapter: new ApplicationAdapter(),
  config: {
    namespace: 'my-app-local-inference',
    queueCapacity: 4,
    requestTimeoutMs: 30_000,
    runtimeFingerprint,
  },
  topology: {
    mode: 'auto',
    name: 'my-app-local-inference',
    requiredCapabilities: [],
    workerFactory: ({ name }) => new TabLoomHost({ name }),
  },
});

await selection.broker.start();
```

```ts
// tabloom-host.ts
import { ApplicationAdapter } from './application-adapter';
import { runtimeFingerprint } from './runtime-identity';
import { createSharedWorkerBrokerHost } from '@aantenore/tabloom/shared-worker';

createSharedWorkerBrokerHost({
  adapter: new ApplicationAdapter(),
  config: {
    namespace: 'my-app-local-inference',
    queueCapacity: 4,
    requestTimeoutMs: 30_000,
    runtimeFingerprint,
  },
  scope: globalThis,
});
```

Keep the worker output as an ES module and install the host during module bootstrap. The page and worker can derive the shared fingerprint asynchronously during module evaluation; the browser queues the SharedWorker connection until that module evaluation completes.

The page-side adapter exists to preserve one topology-independent factory shape. It initializes only when `page-owner` is selected. The host-side adapter initializes only after the fingerprinted prepare/commit handshake. Do not catch a post-commit startup error and create another runtime manually.

Use `requiredCapabilities` for host requirements such as `webgpu`. It is an admission probe, not a guarantee that a particular model fits the device. Observe `selection.topology` and `selection.fallbackReason` in safe diagnostics.

## Shipped WebLLM adapter

[WebLLM](https://github.com/mlc-ai/web-llm) already supplies model loading, caching, WebGPU execution, and OpenAI-shaped chat streaming. TabLoom ships an optional adapter at `@aantenore/tabloom/adapters/webllm`, pinned to the verified `0.2.84` contract.

| TabLoom hook         | WebLLM responsibility                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| `initialize(signal)` | Create one engine and load the configured model only in the selected owner        |
| `run(request, ctx)`  | Stream OpenAI-shaped chunks, aggregate choice zero, and retain final usage        |
| `ctx.signal`         | Interrupt generation, drain the provider iterator, then report typed cancellation |
| `dispose()`          | Wait for active generation cleanup, unload resources, then release ownership      |

The package declares WebLLM as an optional exact peer. It uses a lazy import during owner initialization, so importing TabLoom or the adapter subpath does not load or bundle the provider. The host must install the peer, choose the model and cache policy, and provide the complete conversation history on every request.

The adapter deliberately fixes the configured model, `n = 1`, and streaming mode after merging the request. Keep the broker at `maxConcurrent: 1`, because WebLLM serializes work per model and its interruption API applies to the engine rather than one arbitrary request.

Do not place `ServiceWorkerMLCEngine` behind this adapter. WebLLM's service-worker topology and TabLoom's page-owner or SharedWorker host are alternative runtime ownership strategies. TabLoom is useful when the application needs provider-neutral fencing, bounded admission, explicit runtime compatibility, observable ownership, and takeover semantics.

The repository WebLLM lab can run either the page-owner baseline or a dedicated Vite-bundled SharedWorker host. That lab is opt-in because it can download model artifacts and requires WebGPU. Its result is evidence for the recorded environment only, not a general browser or device support claim.

## Transformers.js seam

[Transformers.js](https://huggingface.co/docs/transformers.js/main/en/index) exposes browser pipelines and task-specific streaming mechanisms. A TabLoom adapter can initialize one pipeline in the owner, convert provider callbacks into `ctx.emit` calls, and dispose task resources when leadership ends.

Pipeline input/output shapes differ substantially by task. Keep that schema in the adapter type parameters rather than adding provider cases to the broker core.

## Why integrations stay optional

- Applications can choose runtime, model, quantization, cache, and worker topology independently.
- The core package remains small and does not force WebGPU on consumers.
- Provider upgrades do not require a coordination-schema change, but incompatible upgrades must change the runtime fingerprint.
- The deterministic adapter keeps failure and takeover tests reproducible on CI runners without GPU claims.

See [ADR 0002](adr/0002-optional-webllm-adapter.md) for the dependency decision, [ADR 0003](adr/0003-adaptive-topology.md) for topology selection, and [ADR 0004](adr/0004-runtime-identity-and-epoch-journal.md) for compatibility identity.
