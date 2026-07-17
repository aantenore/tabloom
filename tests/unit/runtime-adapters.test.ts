import { describe, expect, it } from 'vitest';
import {
  CollectingTelemetry,
  CryptoIdProvider,
  NoopTelemetry,
  SequenceIdProvider,
  SystemClock,
} from '../../src/adapters/runtime.js';

describe('runtime adapters', () => {
  it('provides unique and deterministic IDs', () => {
    expect(new CryptoIdProvider().next()).toMatch(/^[0-9a-f-]{36}$/u);
    const sequence = new SequenceIdProvider('tab');
    expect([sequence.next(), sequence.next()]).toEqual(['tab-1', 'tab-2']);
  });

  it('fails when no cryptographic UUID provider exists', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });
    try {
      expect(() => new CryptoIdProvider().next()).toThrowError(
        expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
      );
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(globalThis, 'crypto', descriptor);
      }
    }
  });

  it('collects only the safe event contract', () => {
    const telemetry = new CollectingTelemetry();
    telemetry.record({ at: 1, kind: 'broker_started', tabId: 'tab-1' });
    new NoopTelemetry().record();
    expect(telemetry.events).toHaveLength(1);
  });

  it('delegates timers and time', async () => {
    const clock = new SystemClock();
    expect(clock.now()).toBeGreaterThan(0);
    await new Promise<void>((resolve) => {
      const timeout = clock.setTimeout(() => {
        clock.clearTimeout(timeout);
        resolve();
      }, 1);
    });
    const interval = clock.setInterval(() => undefined, 100);
    clock.clearInterval(interval);
  });
});
