import { describe, expect, it } from 'vitest';
import { parseBrokerConfig } from '../../src/core/config.js';
import { TabLoomError } from '../../src/core/errors.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

describe('broker configuration', () => {
  it('applies safe defaults', () => {
    expect(
      parseBrokerConfig({
        namespace: 'demo',
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      }),
    ).toEqual({
      heartbeatIntervalMs: 250,
      leaderTimeoutMs: 1_000,
      maxConcurrent: 1,
      namespace: 'demo',
      protocolVersion: 2,
      queueCapacity: 8,
      requestTimeoutMs: 30_000,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
  });

  it.each([
    {
      namespace: 'bad namespace',
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    },
    {
      heartbeatIntervalMs: 100,
      leaderTimeoutMs: 150,
      namespace: 'demo',
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    },
    {
      maxConcurrent: 2,
      namespace: 'demo',
      queueCapacity: 1,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    },
  ])('fails fast for invalid input %#', (input) => {
    expect(() => parseBrokerConfig(input)).toThrowError(TabLoomError);
  });
});
