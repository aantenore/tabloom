import { afterEach, describe, expect, it } from 'vitest';
import { TabLoomError } from '../../src/core/errors.js';
import {
  createRuntimeFingerprint,
  parseRuntimeFingerprint,
} from '../../src/core/runtime-fingerprint.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'crypto',
);

afterEach(() => {
  if (originalCryptoDescriptor === undefined) {
    Reflect.deleteProperty(globalThis, 'crypto');
  } else {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  }
});

describe('runtime fingerprints', () => {
  it('creates a stable protocol-bound digest independent of key order', async () => {
    const first = await createRuntimeFingerprint({
      adapter: 'deterministic@1',
      artifact: 'fixture',
      build: 'tabloom-demo-v1',
      configuration: 'default',
    });
    const reordered = await createRuntimeFingerprint({
      configuration: 'default',
      build: 'tabloom-demo-v1',
      artifact: 'fixture',
      adapter: 'deterministic@1',
    });

    expect(first).toBe(
      'sha256:bd97fbba284706821da6ff2fd09e86a9c6f9d423eac97218ce8a74f864ab73e6',
    );
    expect(reordered).toBe(first);
  });

  it('parses only canonical lowercase sha256 fingerprints', () => {
    expect(parseRuntimeFingerprint(TEST_RUNTIME_FINGERPRINT)).toBe(
      TEST_RUNTIME_FINGERPRINT,
    );
    expect(() => parseRuntimeFingerprint('SHA256:invalid')).toThrowError(
      TabLoomError,
    );
  });

  it.each([
    {},
    { protocolVersion: 'caller-controlled' },
    { Bad: 'value' },
    { valid: '' },
    { valid: ' padded ' },
    { valid: 'x'.repeat(513) },
    Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`item${index}`, 'value']),
    ),
  ])('rejects ambiguous component manifests %#', async (components) => {
    await expect(createRuntimeFingerprint(components)).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
  });

  it('fails closed when Web Crypto is unavailable', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });
    await expect(
      createRuntimeFingerprint({ adapter: 'deterministic@1' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });
});
