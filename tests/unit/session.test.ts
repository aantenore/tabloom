import { describe, expect, it, vi } from 'vitest';
import { TabLoomError } from '../../src/core/errors.js';
import { ManagedInferenceSession } from '../../src/core/session.js';

describe('managed inference session', () => {
  it('streams ordered chunks and resolves one result', async () => {
    const session = new ManagedInferenceSession<string, string>(
      'request-1',
      vi.fn(),
    );
    expect(session.beginAttempt(1)).toBe(1);
    expect(session.acceptChunk(1, 1, 0, 'a')).toBe(true);
    expect(session.acceptChunk(1, 1, 0, 'duplicate')).toBe(false);
    expect(session.acceptChunk(1, 1, 1, 'b')).toBe(true);
    expect(session.complete(1, 1, 'ab')).toBe(true);
    expect(session.complete(1, 1, 'ignored')).toBe(false);

    const chunks: string[] = [];
    for await (const chunk of session) {
      chunks.push(chunk);
    }
    await expect(session.result).resolves.toBe('ab');
    expect(chunks).toEqual(['a', 'b']);
  });

  it('fences old attempts after takeover', async () => {
    const session = new ManagedInferenceSession<string, string>(
      'request-1',
      vi.fn(),
    );
    session.beginAttempt(1);
    session.acceptChunk(1, 1, 0, 'old');
    expect(session.beginAttempt(2)).toBe(2);
    expect(session.acceptChunk(1, 1, 1, 'stale')).toBe(false);
    expect(session.complete(1, 1, 'stale')).toBe(false);
    expect(session.complete(2, 2, 'new')).toBe(true);
    await expect(session.result).resolves.toBe('new');
  });

  it('cancels at most once', () => {
    const cancel = vi.fn();
    const session = new ManagedInferenceSession<string, string>(
      'request-1',
      cancel,
    );
    session.cancel();
    session.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('fails the result and iterator with a typed error', async () => {
    const session = new ManagedInferenceSession<string, string>(
      'request-1',
      vi.fn(),
    );
    session.beginAttempt(1);
    const next = session[Symbol.asyncIterator]().next();
    const error = new TabLoomError('TIMEOUT', 'Timed out.');
    expect(session.fail(1, 1, error)).toBe(true);
    await expect(session.result).rejects.toBe(error);
    await expect(next).rejects.toBe(error);
  });

  it('stops a pending session and ignores stale terminal calls', async () => {
    const session = new ManagedInferenceSession<string, string>(
      'request-1',
      vi.fn(),
    );
    const error = new TabLoomError('BROKER_STOPPED', 'Stopped.');
    session.stop(error);
    session.stop(error);
    expect(session.fail(0, 0, error)).toBe(false);
    await expect(session.result).rejects.toBe(error);
    await expect(session[Symbol.asyncIterator]().next()).rejects.toBe(error);
  });

  it('delivers a chunk to a waiting iterator', async () => {
    const session = new ManagedInferenceSession<string, string>(
      'request-1',
      vi.fn(),
    );
    session.beginAttempt(1);
    const next = session[Symbol.asyncIterator]().next();
    session.acceptChunk(1, 1, 0, 'live');
    await expect(next).resolves.toEqual({ done: false, value: 'live' });
    session.complete(1, 1, 'done');
  });
});
