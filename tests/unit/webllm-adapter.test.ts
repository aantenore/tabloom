import { describe, expect, it, vi } from 'vitest';
import {
  WebLlmInferenceAdapter,
  type WebLlmChunk,
  type WebLlmEngine,
  type WebLlmEngineFactory,
} from '../../src/adapters/webllm.js';

describe('WebLLM adapter', () => {
  it('initializes the configured model and aggregates typed stream chunks', async () => {
    const usage = {
      completion_tokens: 2,
      extra: {
        decode_tokens_per_s: 10,
        e2e_latency_s: 0.2,
        prefill_tokens_per_s: 20,
        time_per_output_token_s: 0.1,
        time_to_first_token_s: 0.1,
      },
      prompt_tokens: 1,
      total_tokens: 3,
    };
    const chunks = [
      makeChunk('Hel'),
      makeChunk('lo', 'stop'),
      makeUsageChunk(usage),
    ];
    const fake = createFakeEngine(async function* () {
      await Promise.resolve();
      yield* chunks;
    });
    const onProgress = vi.fn();
    const factory = vi.fn<WebLlmEngineFactory>((_modelId, engineConfig) => {
      engineConfig?.initProgressCallback?.({
        progress: 0.5,
        text: 'loading',
        timeElapsed: 1,
      });
      return Promise.resolve(fake.engine);
    });
    const adapter = new WebLlmInferenceAdapter({
      chatOptions: { context_window_size: 512 },
      engineConfig: {},
      engineFactory: factory,
      modelId: 'model-a',
      onProgress,
    });

    await adapter.initialize(new AbortController().signal);
    await adapter.initialize(new AbortController().signal);
    const emitted: WebLlmChunk[] = [];
    const result = await adapter.run(
      { messages: [{ content: 'hello', role: 'user' }] },
      context((chunk) => emitted.push(chunk)),
    );

    expect(adapter.descriptor).toMatchObject({
      evidence: 'provider-runtime',
      version: '0.2.84',
    });
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0]?.[0]).toBe('model-a');
    expect(factory.mock.calls[0]?.[2]).toEqual({ context_window_size: 512 });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(fake.requests[0]).toMatchObject({
      model: 'model-a',
      n: 1,
      stream: true,
    });
    expect(emitted).toEqual(chunks.slice(0, 2));
    expect(result).toEqual({
      chunkCount: 2,
      finishReason: 'stop',
      text: 'Hello',
      usage,
    });

    await adapter.dispose();
    expect(fake.unload).toHaveBeenCalledOnce();
  });

  it('requires a model and owner initialization before generation', async () => {
    expect(() => new WebLlmInferenceAdapter({ modelId: '   ' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' }),
    );

    const adapter = new WebLlmInferenceAdapter({
      engineFactory: () => Promise.resolve(createFakeEngine().engine),
      modelId: 'model-a',
    });
    await expect(
      adapter.run({ messages: [] }, context()),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });

  it('keeps disposal pending until a cancelled late engine is unloaded', async () => {
    const pending = deferred<WebLlmEngine>();
    const unloadStarted = deferred<void>();
    const releaseUnload = deferred<void>();
    const fake = createFakeEngine();
    fake.unload.mockImplementation(() => {
      unloadStarted.resolve();
      return releaseUnload.promise;
    });
    const adapter = new WebLlmInferenceAdapter({
      engineFactory: () => pending.promise,
      modelId: 'model-a',
    });
    const controller = new AbortController();
    const first = adapter.initialize(controller.signal);

    await expect(
      adapter.initialize(new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ADAPTER_FAILED' });
    controller.abort();
    const initialization = expect(first).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    let disposed = false;
    const disposal = adapter.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    pending.resolve(fake.engine);
    await unloadStarted.promise;
    expect(disposed).toBe(false);
    releaseUnload.resolve();
    await initialization;
    await disposal;
    expect(disposed).toBe(true);
    expect(fake.unload).toHaveBeenCalledOnce();
  });

  it('rejects a second generation while one is active', async () => {
    const release = deferred<void>();
    const started = deferred<void>();
    const fake = createFakeEngine(async function* () {
      yield makeChunk('one');
      await release.promise;
      yield makeChunk(' two', 'stop');
    });
    const adapter = await initializedAdapter(fake.engine);
    const first = adapter.run(
      { messages: [{ content: 'go', role: 'user' }] },
      context(() => started.resolve()),
    );
    await started.promise;

    await expect(
      adapter.run({ messages: [] }, context()),
    ).rejects.toMatchObject({
      code: 'ADAPTER_FAILED',
      details: { reason: 'concurrent-run' },
    });
    release.resolve();
    await expect(first).resolves.toMatchObject({ text: 'one two' });
  });

  it('interrupts WebLLM when the owner cancels generation', async () => {
    const release = deferred<void>();
    const started = deferred<void>();
    const fake = createFakeEngine(async function* () {
      yield makeChunk('partial');
      await release.promise;
    });
    fake.interrupt.mockImplementation(() => release.resolve());
    const adapter = await initializedAdapter(fake.engine);
    const controller = new AbortController();
    const run = adapter.run(
      { messages: [{ content: 'go', role: 'user' }] },
      context(() => started.resolve(), controller.signal),
    );
    await started.promise;
    controller.abort();

    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.interrupt).toHaveBeenCalledOnce();
  });

  it('drains an active generation before disposal unloads the engine', async () => {
    const release = deferred<void>();
    const started = deferred<void>();
    const fake = createFakeEngine(async function* () {
      yield makeChunk('partial');
      await release.promise;
      yield makeChunk('discarded', 'abort');
    });
    fake.interrupt.mockImplementation(() => release.resolve());
    const adapter = await initializedAdapter(fake.engine);
    const run = adapter.run(
      { messages: [{ content: 'go', role: 'user' }] },
      context(() => started.resolve()),
    );
    await started.promise;

    await adapter.dispose();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fake.interrupt).toHaveBeenCalledOnce();
    expect(fake.unload).toHaveBeenCalledOnce();
  });

  it('shares one disposal task across concurrent callers', async () => {
    const releaseUnload = deferred<void>();
    const fake = createFakeEngine();
    fake.unload.mockImplementation(() => releaseUnload.promise);
    const adapter = await initializedAdapter(fake.engine);

    const first = adapter.dispose();
    const second = adapter.dispose();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(fake.unload).toHaveBeenCalledOnce();
    releaseUnload.resolve();
    await Promise.all([first, second]);
  });

  it('wraps provider failures and reports unload failures', async () => {
    const generationFailure = createFakeEngine(() => failingStream());
    const adapter = await initializedAdapter(generationFailure.engine);
    await expect(
      adapter.run({ messages: [] }, context()),
    ).rejects.toMatchObject({ code: 'ADAPTER_FAILED' });

    generationFailure.unload.mockRejectedValueOnce(
      new Error('provider unload failed'),
    );
    await expect(adapter.dispose()).rejects.toMatchObject({
      code: 'ADAPTER_FAILED',
    });
  });

  it('fails immediately for an already aborted initialization or run', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new WebLlmInferenceAdapter({
      engineFactory: () => Promise.resolve(createFakeEngine().engine),
      modelId: 'model-a',
    });
    await expect(adapter.initialize(controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    });

    const ready = await initializedAdapter(createFakeEngine().engine);
    await expect(
      ready.run({ messages: [] }, context(undefined, controller.signal)),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

function context(
  emit: ((chunk: WebLlmChunk) => void) | undefined = undefined,
  signal = new AbortController().signal,
) {
  return {
    attempt: 1,
    emit: emit ?? (() => undefined),
    epoch: 1,
    requestId: 'request-1',
    signal,
  };
}

function createFakeEngine(
  stream: () => AsyncIterable<WebLlmChunk> = emptyStream,
) {
  const requests: Array<
    Parameters<WebLlmEngine['chat']['completions']['create']>[0]
  > = [];
  const interrupt = vi.fn<() => void>();
  const unload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const engine: WebLlmEngine = {
    chat: {
      completions: {
        create: (request) => {
          requests.push(request);
          return Promise.resolve(stream());
        },
      },
    },
    interruptGenerate: interrupt,
    unload,
  };
  return { engine, interrupt, requests, unload };
}

async function initializedAdapter(
  engine: WebLlmEngine,
): Promise<WebLlmInferenceAdapter> {
  const adapter = new WebLlmInferenceAdapter({
    engineFactory: () => Promise.resolve(engine),
    modelId: 'model-a',
  });
  await adapter.initialize(new AbortController().signal);
  return adapter;
}

function emptyStream(): AsyncIterable<WebLlmChunk> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.resolve({ done: true, value: undefined }),
    }),
  };
}

function failingStream(): AsyncIterable<WebLlmChunk> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new Error('provider generation failed')),
    }),
  };
}

function makeChunk(
  content: string,
  finishReason: 'abort' | 'length' | 'stop' | 'tool_calls' | null = null,
  usage?: WebLlmChunk['usage'],
): WebLlmChunk {
  const chunk: WebLlmChunk = {
    choices: [
      {
        delta: { content },
        finish_reason: finishReason,
        index: 0,
      },
    ],
    created: 1,
    id: 'chunk-1',
    model: 'model-a',
    object: 'chat.completion.chunk',
  };
  return usage === undefined ? chunk : { ...chunk, usage };
}

function makeUsageChunk(usage: NonNullable<WebLlmChunk['usage']>): WebLlmChunk {
  return {
    choices: [],
    created: 1,
    id: 'chunk-1',
    model: 'model-a',
    object: 'chat.completion.chunk',
    usage,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
