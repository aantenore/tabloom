import { z } from 'zod';
import { TabLoomError } from './errors.js';
import { TABLOOM_PROTOCOL_VERSION } from './version.js';

const fingerprintPattern = /^sha256:[0-9a-f]{64}$/;
const componentKeyPattern = /^[a-z][a-zA-Z0-9._-]{0,63}$/;

export const runtimeFingerprintSchema = z
  .string()
  .regex(fingerprintPattern, 'Use a lowercase sha256:<64 hex characters>.');

declare const runtimeFingerprintBrand: unique symbol;

export type RuntimeFingerprint = string & {
  readonly [runtimeFingerprintBrand]: true;
};

export type RuntimeFingerprintComponents = Readonly<Record<string, string>>;

export function parseRuntimeFingerprint(input: unknown): RuntimeFingerprint {
  const parsed = runtimeFingerprintSchema.safeParse(input);
  if (!parsed.success) {
    throw new TabLoomError(
      'INVALID_CONFIG',
      'The runtime fingerprint is invalid.',
    );
  }
  return parsed.data as RuntimeFingerprint;
}

export async function createRuntimeFingerprint(
  components: RuntimeFingerprintComponents,
): Promise<RuntimeFingerprint> {
  const entries = Object.entries(components).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0 || entries.length > 32) {
    throw new TabLoomError(
      'INVALID_CONFIG',
      'A runtime fingerprint requires between one and 32 components.',
    );
  }

  for (const [key, value] of entries) {
    if (
      key === 'protocolVersion' ||
      !componentKeyPattern.test(key) ||
      value.length === 0 ||
      value.length > 512 ||
      value !== value.trim()
    ) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'Runtime fingerprint components are invalid.',
        { component: key },
      );
    }
  }

  const cryptoProvider = Reflect.get(globalThis, 'crypto') as
    Crypto | undefined;
  if (cryptoProvider?.subtle === undefined) {
    throw new TabLoomError(
      'CAPABILITY_UNAVAILABLE',
      'Web Crypto is required to create a runtime fingerprint.',
    );
  }

  const canonicalManifest = JSON.stringify([
    ['protocolVersion', String(TABLOOM_PROTOCOL_VERSION)],
    ...entries,
  ]);
  const digest = await cryptoProvider.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalManifest),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return parseRuntimeFingerprint(`sha256:${hex}`);
}
