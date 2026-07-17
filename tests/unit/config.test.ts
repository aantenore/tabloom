import { describe, expect, it } from 'vitest';
import { parseBrokerConfig } from '../../src/core/config.js';
import { TabLoomError } from '../../src/core/errors.js';

describe('broker configuration', () => {
  it('applies safe defaults', () => {
    expect(parseBrokerConfig({ namespace: 'demo' })).toEqual({
      heartbeatIntervalMs: 250,
      leaderTimeoutMs: 1_000,
      maxConcurrent: 1,
      namespace: 'demo',
      protocolVersion: 1,
      queueCapacity: 8,
      requestTimeoutMs: 30_000,
    });
  });

  it.each([
    { namespace: 'bad namespace' },
    { heartbeatIntervalMs: 100, leaderTimeoutMs: 150, namespace: 'demo' },
    { maxConcurrent: 2, namespace: 'demo', queueCapacity: 1 },
  ])('fails fast for invalid input %#', (input) => {
    expect(() => parseBrokerConfig(input)).toThrowError(TabLoomError);
  });
});
