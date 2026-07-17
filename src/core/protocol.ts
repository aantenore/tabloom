import { z } from 'zod';

const baseEnvelopeSchema = z.object({
  messageId: z.string().min(1).max(160),
  protocolVersion: z.number().int().positive().max(65_535),
  sentAt: z.number().finite().nonnegative(),
  sourceId: z.string().min(1).max(160),
});

const presenceSchema = baseEnvelopeSchema.extend({
  kind: z.literal('presence'),
  supportedVersions: z
    .array(z.number().int().positive().max(65_535))
    .min(1)
    .max(16),
});

const leaderSchema = baseEnvelopeSchema.extend({
  adapter: z.object({
    evidence: z.enum(['deterministic-simulation', 'provider-runtime']),
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    version: z.string().min(1).max(80),
  }),
  capacity: z.number().int().positive().max(1_024),
  epoch: z.number().int().positive(),
  kind: z.literal('leader'),
  queueDepth: z.number().int().nonnegative().max(1_024),
  readiness: z.enum(['initializing', 'ready']),
});

const requestSchema = baseEnvelopeSchema.extend({
  attempt: z.number().int().positive(),
  clientId: z.string().min(1).max(160),
  deadlineAt: z.number().finite().positive(),
  epoch: z.number().int().positive(),
  kind: z.literal('request'),
  payload: z.unknown(),
  requestId: z.string().min(1).max(160),
});

const cancelSchema = baseEnvelopeSchema.extend({
  clientId: z.string().min(1).max(160),
  epoch: z.number().int().positive(),
  kind: z.literal('cancel'),
  reason: z.enum(['client', 'timeout']),
  requestId: z.string().min(1).max(160),
});

const acceptedSchema = baseEnvelopeSchema.extend({
  attempt: z.number().int().positive(),
  clientId: z.string().min(1).max(160),
  epoch: z.number().int().positive(),
  kind: z.literal('accepted'),
  queueDepth: z.number().int().nonnegative().max(1_024),
  requestId: z.string().min(1).max(160),
});

const chunkSchema = baseEnvelopeSchema.extend({
  attempt: z.number().int().positive(),
  chunk: z.unknown(),
  clientId: z.string().min(1).max(160),
  epoch: z.number().int().positive(),
  kind: z.literal('chunk'),
  requestId: z.string().min(1).max(160),
  sequence: z.number().int().nonnegative(),
});

const terminalSchema = baseEnvelopeSchema.extend({
  attempt: z.number().int().positive(),
  clientId: z.string().min(1).max(160),
  epoch: z.number().int().positive(),
  error: z
    .object({
      code: z.enum([
        'ADAPTER_FAILED',
        'BACKPRESSURE',
        'CANCELLED',
        'PROTOCOL_MISMATCH',
        'TIMEOUT',
      ]),
      message: z.string().min(1).max(500),
    })
    .optional(),
  kind: z.literal('terminal'),
  requestId: z.string().min(1).max(160),
  result: z.unknown().optional(),
  status: z.enum([
    'backpressure',
    'cancelled',
    'completed',
    'failed',
    'protocol_error',
    'timed_out',
  ]),
});

export const protocolEnvelopeSchema = z.discriminatedUnion('kind', [
  acceptedSchema,
  cancelSchema,
  chunkSchema,
  leaderSchema,
  presenceSchema,
  requestSchema,
  terminalSchema,
]);

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type PresenceEnvelope = z.infer<typeof presenceSchema>;
export type LeaderEnvelope = z.infer<typeof leaderSchema>;
export type RequestEnvelope = z.infer<typeof requestSchema>;
export type CancelEnvelope = z.infer<typeof cancelSchema>;
export type AcceptedEnvelope = z.infer<typeof acceptedSchema>;
export type ChunkEnvelope = z.infer<typeof chunkSchema>;
export type TerminalEnvelope = z.infer<typeof terminalSchema>;

export function parseProtocolEnvelope(
  input: unknown,
): ProtocolEnvelope | undefined {
  const parsed = protocolEnvelopeSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export function isProtocolCompatible(
  localVersions: readonly number[],
  remoteVersion: number,
): boolean {
  return localVersions.includes(remoteVersion);
}
