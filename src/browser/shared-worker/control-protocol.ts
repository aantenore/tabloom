import { z } from 'zod';
import { protocolEnvelopeSchema } from '../../core/protocol.js';
import { runtimeFingerprintSchema } from '../../core/runtime-fingerprint.js';

const nonceSchema = z.string().min(1).max(160);
const namespaceSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._-]+$/);
const capabilitiesSchema = z
  .array(z.string().min(1).max(80))
  .max(16)
  .transform((values) => [...new Set(values)].sort());

const helloSchema = z.object({
  kind: z.literal('hello'),
  namespace: namespaceSchema,
  nonce: nonceSchema,
  protocolVersion: z.number().int().positive().max(65_535),
  requiredCapabilities: capabilitiesSchema,
  runtimeFingerprint: runtimeFingerprintSchema,
});

const preparedSchema = z.object({
  hostId: z.string().min(1).max(160),
  kind: z.literal('prepared'),
  namespace: namespaceSchema,
  nonce: nonceSchema,
  protocolVersion: z.number().int().positive().max(65_535),
  runtimeFingerprint: runtimeFingerprintSchema,
});

const commitSchema = z.object({
  kind: z.literal('commit'),
  nonce: nonceSchema,
});

const readySchema = z.object({
  hostId: z.string().min(1).max(160),
  kind: z.literal('ready'),
  nonce: nonceSchema,
  topology: z.literal('shared-worker'),
});

const challengeSchema = z.object({
  hostId: z.string().min(1).max(160),
  kind: z.literal('challenge'),
  namespace: namespaceSchema,
  protocolVersion: z.number().int().positive().max(65_535),
  runtimeFingerprint: runtimeFingerprintSchema,
});

const pingSchema = z.object({
  hostId: z.string().min(1).max(160),
  kind: z.literal('ping'),
  nonce: nonceSchema,
});

const pongSchema = z.object({
  hostId: z.string().min(1).max(160),
  kind: z.literal('pong'),
  nonce: nonceSchema,
});

const abortSchema = z.object({
  kind: z.literal('abort'),
  nonce: nonceSchema,
  reason: z.enum(['client', 'timeout']),
});

const fatalSchema = z.object({
  code: z.enum([
    'PROTOCOL_MISMATCH',
    'RUNTIME_MISMATCH',
    'TOPOLOGY_UNAVAILABLE',
    'TRANSPORT_FAILED',
  ]),
  kind: z.literal('fatal'),
  message: z.string().min(1).max(300),
  nonce: nonceSchema,
});

const disconnectSchema = z.object({
  kind: z.literal('disconnect'),
  nonce: nonceSchema,
});

const protocolSchema = z.object({
  envelope: protocolEnvelopeSchema,
  kind: z.literal('protocol'),
});

export const sharedWorkerControlMessageSchema = z.discriminatedUnion('kind', [
  abortSchema,
  challengeSchema,
  commitSchema,
  disconnectSchema,
  fatalSchema,
  helloSchema,
  pingSchema,
  pongSchema,
  preparedSchema,
  protocolSchema,
  readySchema,
]);

export type SharedWorkerControlMessage = z.infer<
  typeof sharedWorkerControlMessageSchema
>;
export type SharedWorkerHello = z.infer<typeof helloSchema>;
export type SharedWorkerFatal = z.infer<typeof fatalSchema>;
export type SharedWorkerChallenge = z.infer<typeof challengeSchema>;

export function parseSharedWorkerControlMessage(
  input: unknown,
): SharedWorkerControlMessage | undefined {
  const parsed = sharedWorkerControlMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}
