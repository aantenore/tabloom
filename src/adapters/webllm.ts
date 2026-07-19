import type {
  ChatCompletionChunk,
  ChatCompletionFinishReason,
  ChatCompletionRequestBase,
  ChatCompletionRequestStreaming,
  ChatOptions,
  CompletionUsage,
  InitProgressReport,
  MLCEngineConfig,
} from '@mlc-ai/web-llm';
import { TabLoomError } from '../core/errors.js';
import type { InferenceAdapter, InferenceContext } from '../core/types.js';

const WEBLLM_VERSION = '0.2.84';

export type WebLlmRequest = Readonly<
  Omit<ChatCompletionRequestBase, 'model' | 'n' | 'stream'>
>;
export type WebLlmChunk = ChatCompletionChunk;

export interface WebLlmResult {
  readonly chunkCount: number;
  readonly finishReason: ChatCompletionFinishReason | null;
  readonly text: string;
  readonly usage?: CompletionUsage;
}

export interface WebLlmEngine {
  readonly chat: {
    readonly completions: {
      create(
        request: ChatCompletionRequestStreaming,
      ): Promise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
  interruptGenerate(): Promise<void> | void;
  unload(): Promise<void>;
}

export type WebLlmEngineFactory = (
  modelId: string,
  engineConfig?: MLCEngineConfig,
  chatOptions?: ChatOptions,
  signal?: AbortSignal,
) => Promise<WebLlmEngine>;

export interface WebLlmAdapterConfig {
  readonly chatOptions?: ChatOptions;
  readonly engineConfig?: MLCEngineConfig;
  readonly engineFactory?: WebLlmEngineFactory;
  readonly modelId: string;
  readonly onProgress?: (report: InitProgressReport) => void;
}

type AdapterState = 'idle' | 'initializing' | 'ready' | 'disposing';

export class WebLlmInferenceAdapter implements InferenceAdapter<
  WebLlmRequest,
  WebLlmChunk,
  WebLlmResult
> {
  readonly descriptor = {
    evidence: 'provider-runtime',
    id: 'webllm',
    name: 'WebLLM browser runtime',
    version: WEBLLM_VERSION,
  } as const;

  #activeRun = false;
  #activeRunDone: Promise<void> | undefined;
  #chatOptions: ChatOptions | undefined;
  #disposeTask: Promise<void> | undefined;
  #engine: WebLlmEngine | undefined;
  #engineConfig: MLCEngineConfig | undefined;
  #engineFactory: WebLlmEngineFactory;
  #initializationController: AbortController | undefined;
  #initializationTask: Promise<void> | undefined;
  #lifecycle = 0;
  #modelId: string;
  #onProgress: ((report: InitProgressReport) => void) | undefined;
  #state: AdapterState = 'idle';

  constructor(config: WebLlmAdapterConfig) {
    if (config.modelId.trim().length === 0) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'A non-empty WebLLM model ID is required.',
      );
    }
    this.#chatOptions = config.chatOptions;
    this.#engineConfig = config.engineConfig;
    this.#engineFactory = config.engineFactory ?? createWebLlmEngine;
    this.#modelId = config.modelId;
    this.#onProgress = config.onProgress;
  }

  async initialize(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw cancelled('WebLLM initialization was cancelled.');
    }
    if (this.#state === 'ready') {
      return;
    }
    if (this.#state !== 'idle') {
      throw new TabLoomError(
        'ADAPTER_FAILED',
        'WebLLM initialization is already in progress.',
        { state: this.#state },
      );
    }

    this.#state = 'initializing';
    const lifecycle = ++this.#lifecycle;
    const controller = new AbortController();
    this.#initializationController = controller;
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (isAborted(signal)) {
      onAbort();
    }
    const engineConfig = this.#createEngineConfig(lifecycle, signal);
    const initializationTask = this.#initializeEngine(
      lifecycle,
      controller.signal,
      engineConfig,
    );
    this.#initializationTask = initializationTask;
    try {
      await initializationTask;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (this.#initializationTask === initializationTask) {
        this.#initializationController = undefined;
        this.#initializationTask = undefined;
      }
      if (this.#hasState('initializing') && lifecycle === this.#lifecycle) {
        this.#state = 'idle';
      }
    }
  }

  async run(
    request: WebLlmRequest,
    context: InferenceContext<WebLlmChunk>,
  ): Promise<WebLlmResult> {
    const engine = this.#engine;
    if (this.#state !== 'ready' || engine === undefined) {
      throw new TabLoomError(
        'CAPABILITY_UNAVAILABLE',
        'WebLLM is not initialized on the current owner.',
      );
    }
    if (this.#activeRun) {
      throw new TabLoomError(
        'ADAPTER_FAILED',
        'WebLLM only accepts one active generation per owner.',
        { reason: 'concurrent-run' },
      );
    }
    if (context.signal.aborted) {
      throw cancelled('WebLLM generation was cancelled.');
    }

    this.#activeRun = true;
    let completeRun: () => void = () => undefined;
    this.#activeRunDone = new Promise<void>((resolve) => {
      completeRun = resolve;
    });
    const onAbort = () => interruptQuietly(engine);
    context.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const stream = await engine.chat.completions.create({
        ...request,
        model: this.#modelId,
        n: 1,
        stream: true,
      });
      let chunkCount = 0;
      let finishReason: ChatCompletionFinishReason | null = null;
      let text = '';
      let usage: CompletionUsage | undefined;

      for await (const chunk of stream) {
        if (chunk.usage !== undefined) {
          usage = chunk.usage;
        }
        if (isAborted(context.signal) || !this.#hasState('ready')) {
          continue;
        }
        const choice = chunk.choices.find((candidate) => candidate.index === 0);
        if (choice === undefined) {
          continue;
        }
        context.emit(chunk);
        chunkCount += 1;
        text += choice.delta.content ?? '';
        if (choice.finish_reason != null) {
          finishReason = choice.finish_reason;
        }
      }

      if (isAborted(context.signal) || !this.#hasState('ready')) {
        throw cancelled('WebLLM generation was cancelled.');
      }
      return usage === undefined
        ? { chunkCount, finishReason, text }
        : { chunkCount, finishReason, text, usage };
    } catch (error) {
      if (isAborted(context.signal) || !this.#hasState('ready')) {
        throw cancelled('WebLLM generation was cancelled.');
      }
      throw adapterFailure('WebLLM generation failed.', error);
    } finally {
      context.signal.removeEventListener('abort', onAbort);
      this.#activeRun = false;
      this.#activeRunDone = undefined;
      completeRun();
    }
  }

  dispose(): Promise<void> {
    if (this.#disposeTask !== undefined) {
      return this.#disposeTask;
    }
    const disposeTask = this.#dispose();
    this.#disposeTask = disposeTask;
    const clear = () => {
      if (this.#disposeTask === disposeTask) {
        this.#disposeTask = undefined;
      }
    };
    void disposeTask.then(clear, clear);
    return disposeTask;
  }

  async #dispose(): Promise<void> {
    ++this.#lifecycle;
    this.#state = 'disposing';
    this.#initializationController?.abort();
    const initializationTask = this.#initializationTask;
    const engine = this.#engine;
    this.#engine = undefined;
    const activeRunDone = this.#activeRunDone;
    if (engine !== undefined && this.#activeRun) {
      interruptQuietly(engine);
    }
    try {
      if (activeRunDone !== undefined) {
        await activeRunDone;
      }
      if (initializationTask !== undefined) {
        try {
          await initializationTask;
        } catch {
          // The initialization caller owns its typed failure after cleanup settles.
        }
      }
      await engine?.unload();
    } catch (error) {
      throw adapterFailure('WebLLM disposal failed.', error);
    } finally {
      this.#state = 'idle';
    }
  }

  async #initializeEngine(
    lifecycle: number,
    signal: AbortSignal,
    engineConfig: MLCEngineConfig | undefined,
  ): Promise<void> {
    let engine: WebLlmEngine;
    try {
      engine = await this.#engineFactory(
        this.#modelId,
        engineConfig,
        this.#chatOptions,
        signal,
      );
    } catch (error) {
      if (isAborted(signal) || lifecycle !== this.#lifecycle) {
        throw cancelled('WebLLM initialization was cancelled.');
      }
      throw adapterFailure('WebLLM initialization failed.', error);
    }

    if (
      isAborted(signal) ||
      lifecycle !== this.#lifecycle ||
      !this.#hasState('initializing')
    ) {
      await unloadQuietly(engine);
      throw cancelled('WebLLM initialization was cancelled.');
    }
    this.#engine = engine;
    this.#state = 'ready';
  }

  #createEngineConfig(
    lifecycle: number,
    signal: AbortSignal,
  ): MLCEngineConfig | undefined {
    const onProgress =
      this.#onProgress ?? this.#engineConfig?.initProgressCallback;
    if (onProgress === undefined) {
      return this.#engineConfig;
    }
    return {
      ...this.#engineConfig,
      initProgressCallback: (report) => {
        if (!signal.aborted && lifecycle === this.#lifecycle) {
          onProgress(report);
        }
      },
    };
  }

  #hasState(state: AdapterState): boolean {
    return this.#state === state;
  }
}

async function createWebLlmEngine(
  modelId: string,
  engineConfig?: MLCEngineConfig,
  chatOptions?: ChatOptions,
  signal?: AbortSignal,
): Promise<WebLlmEngine> {
  const { MLCEngine } = await import('@mlc-ai/web-llm');
  const engine = new MLCEngine(engineConfig);
  if (isAborted(signal)) {
    await unloadQuietly(engine);
    throw cancelled('WebLLM initialization was cancelled.');
  }

  let resolveAbort: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => {
    resolveAbort = resolve;
  });
  let interruptingUnload: Promise<void> | undefined;
  const onAbort = () => {
    interruptingUnload ??= unloadQuietly(engine);
    resolveAbort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const reloadTask = engine.reload(modelId, chatOptions);
  const reloadOutcome = reloadTask.then(
    () => ({ kind: 'reloaded' }) as const,
    (error: unknown) => ({ error, kind: 'failed' }) as const,
  );
  try {
    const outcome = await Promise.race([
      reloadOutcome,
      aborted.then(() => ({ kind: 'aborted' }) as const),
    ]);
    if (outcome.kind === 'aborted' || isAborted(signal)) {
      await interruptingUnload;
      await reloadOutcome;
      await unloadQuietly(engine);
      throw cancelled('WebLLM initialization was cancelled.');
    }
    if (outcome.kind === 'failed') {
      await unloadQuietly(engine);
      throw outcome.error;
    }
    return engine;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function adapterFailure(message: string, error: unknown): TabLoomError {
  if (error instanceof TabLoomError) {
    return error;
  }
  return new TabLoomError(
    'ADAPTER_FAILED',
    message,
    {},
    error instanceof Error ? { cause: error } : undefined,
  );
}

function cancelled(message: string): TabLoomError {
  return new TabLoomError('CANCELLED', message);
}

function interruptQuietly(engine: WebLlmEngine): void {
  try {
    const interruption = engine.interruptGenerate();
    if (interruption !== undefined) {
      void interruption.catch(() => undefined);
    }
  } catch {
    // Cancellation remains authoritative even when the provider cannot interrupt.
  }
}

async function unloadQuietly(engine: WebLlmEngine): Promise<void> {
  try {
    await engine.unload();
  } catch {
    // A superseded initialization must never restore or retain its engine.
  }
}
