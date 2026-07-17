import { describe, expect, it } from 'vitest';
import { DeterministicInferenceAdapter } from '../../src/adapters/deterministic.js';
import { TabLoomError } from '../../src/core/errors.js';

describe('deterministic adapter', () => {
  it('emits repeatable chunks and a matching result', async () => {
    const adapter = new DeterministicInferenceAdapter({
      defaultChunkDelayMs: 0,
      defaultChunkSize: 4,
      prefix: 'out:',
    });
    const chunks: string[] = [];
    const result = await adapter.run(
      { text: 'abc' },
      {
        attempt: 1,
        emit: (chunk) => chunks.push(chunk.text),
        epoch: 1,
        requestId: 'request-1',
        signal: new AbortController().signal,
      },
    );

    expect(chunks.join('')).toBe('out:abc');
    expect(result).toEqual({ chunkCount: 2, text: 'out:abc' });
  });

  it('validates request shape', async () => {
    const adapter = new DeterministicInferenceAdapter();
    await expect(
      adapter.run(
        { text: 'x', chunkSize: 0 },
        {
          attempt: 1,
          emit: () => undefined,
          epoch: 1,
          requestId: 'request-1',
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toBeInstanceOf(TabLoomError);
  });

  it('honors cancellation while delayed', async () => {
    const adapter = new DeterministicInferenceAdapter({
      defaultChunkDelayMs: 100,
    });
    const controller = new AbortController();
    const run = adapter.run(
      { text: 'cancel me' },
      {
        attempt: 1,
        emit: () => undefined,
        epoch: 1,
        requestId: 'request-1',
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('fails immediately for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new DeterministicInferenceAdapter().run(
        { text: 'x' },
        {
          attempt: 1,
          emit: () => undefined,
          epoch: 1,
          requestId: 'request-1',
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('emits one empty chunk for empty text', async () => {
    const emitted: string[] = [];
    const result = await new DeterministicInferenceAdapter({
      defaultChunkDelayMs: 0,
      prefix: '',
    }).run(
      { text: '' },
      {
        attempt: 1,
        emit: (chunk) => emitted.push(chunk.text),
        epoch: 1,
        requestId: 'request-1',
        signal: new AbortController().signal,
      },
    );
    expect(emitted).toEqual(['']);
    expect(result.chunkCount).toBe(1);
  });
});
