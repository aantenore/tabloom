import { z } from 'zod';
import { TabLoomError } from '../core/errors.js';
import type { InferenceAdapter, InferenceContext } from '../core/types.js';

const deterministicRequestSchema = z.object({
  chunkDelayMs: z.number().int().min(0).max(5_000).optional(),
  chunkSize: z.number().int().min(1).max(256).optional(),
  text: z.string().max(100_000),
});

export interface DeterministicRequest {
  readonly chunkDelayMs?: number;
  readonly chunkSize?: number;
  readonly text: string;
}

export interface DeterministicChunk {
  readonly index: number;
  readonly text: string;
}

export interface DeterministicResult {
  readonly chunkCount: number;
  readonly text: string;
}

export interface DeterministicAdapterConfig {
  readonly defaultChunkDelayMs?: number;
  readonly defaultChunkSize?: number;
  readonly prefix?: string;
}

export class DeterministicInferenceAdapter implements InferenceAdapter<
  DeterministicRequest,
  DeterministicChunk,
  DeterministicResult
> {
  readonly descriptor = {
    evidence: 'deterministic-simulation',
    id: 'deterministic-text',
    name: 'Deterministic simulation',
    version: '1.0.0',
  } as const;
  #config: Required<DeterministicAdapterConfig>;

  constructor(config: DeterministicAdapterConfig = {}) {
    this.#config = {
      defaultChunkDelayMs: config.defaultChunkDelayMs ?? 40,
      defaultChunkSize: config.defaultChunkSize ?? 8,
      prefix: config.prefix ?? 'Woven once: ',
    };
  }

  async run(
    request: DeterministicRequest,
    context: InferenceContext<DeterministicChunk>,
  ): Promise<DeterministicResult> {
    const parsed = deterministicRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new TabLoomError(
        'ADAPTER_FAILED',
        'The deterministic request is invalid.',
        {
          issueCount: parsed.error.issues.length,
        },
      );
    }
    const output = `${this.#config.prefix}${parsed.data.text}`;
    const chunkSize = parsed.data.chunkSize ?? this.#config.defaultChunkSize;
    const delayMs =
      parsed.data.chunkDelayMs ?? this.#config.defaultChunkDelayMs;
    const chunks = splitText(output, chunkSize);
    for (const [index, text] of chunks.entries()) {
      await abortableDelay(delayMs, context.signal);
      if (context.signal.aborted) {
        throw new TabLoomError(
          'CANCELLED',
          'The deterministic run was cancelled.',
        );
      }
      context.emit({ index, text });
    }
    return { chunkCount: chunks.length, text: output };
  }
}

function splitText(value: string, chunkSize: number): string[] {
  if (value.length === 0) {
    return [''];
  }
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      new TabLoomError('CANCELLED', 'The run was cancelled.'),
    );
  }
  if (delayMs === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const handle = globalThis.setTimeout(resolve, delayMs);
    signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(handle);
        reject(new TabLoomError('CANCELLED', 'The run was cancelled.'));
      },
      { once: true },
    );
  });
}
