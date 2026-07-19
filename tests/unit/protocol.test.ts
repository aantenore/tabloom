import { describe, expect, it } from 'vitest';
import {
  isProtocolCompatible,
  parseProtocolEnvelope,
} from '../../src/core/protocol.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

describe('protocol validation', () => {
  it('accepts a bounded presence envelope', () => {
    expect(
      parseProtocolEnvelope({
        kind: 'presence',
        messageId: 'message-1',
        protocolVersion: 2,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        sentAt: 1,
        sourceId: 'tab-a',
        supportedVersions: [2],
      }),
    ).toMatchObject({ kind: 'presence', supportedVersions: [2] });
  });

  it.each([
    null,
    {},
    { kind: 'presence' },
    {
      kind: 'presence',
      messageId: 'message-1',
      protocolVersion: 0,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      sentAt: 1,
      sourceId: 'tab-a',
      supportedVersions: [],
    },
  ])('drops invalid input %#', (input) => {
    expect(parseProtocolEnvelope(input)).toBeUndefined();
  });

  it('negotiates only an explicitly supported version', () => {
    expect(isProtocolCompatible([1, 3], 3)).toBe(true);
    expect(isProtocolCompatible([1, 3], 2)).toBe(false);
  });
});
