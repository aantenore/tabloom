import { z } from 'zod';
import { TabLoomError } from './errors.js';
import { runtimeFingerprintSchema } from './runtime-fingerprint.js';
import { TABLOOM_PROTOCOL_VERSION } from './version.js';

const brokerConfigSchema = z
  .object({
    heartbeatIntervalMs: z.number().int().min(50).max(60_000).default(250),
    leaderTimeoutMs: z.number().int().min(150).max(180_000).default(1_000),
    maxConcurrent: z.number().int().min(1).max(16).default(1),
    namespace: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(
        /^[a-zA-Z0-9._-]+$/,
        'Use letters, digits, dot, underscore, or dash.',
      ),
    protocolVersion: z
      .literal(TABLOOM_PROTOCOL_VERSION)
      .default(TABLOOM_PROTOCOL_VERSION),
    queueCapacity: z.number().int().min(1).max(1_024).default(8),
    requestTimeoutMs: z.number().int().min(100).max(600_000).default(30_000),
    runtimeFingerprint: runtimeFingerprintSchema,
  })
  .superRefine((value, context) => {
    if (value.leaderTimeoutMs < value.heartbeatIntervalMs * 2) {
      context.addIssue({
        code: 'custom',
        message: 'leaderTimeoutMs must be at least two heartbeat intervals.',
        path: ['leaderTimeoutMs'],
      });
    }

    if (value.maxConcurrent > value.queueCapacity) {
      context.addIssue({
        code: 'custom',
        message: 'maxConcurrent cannot exceed queueCapacity.',
        path: ['maxConcurrent'],
      });
    }
  });

export type BrokerConfigInput = z.input<typeof brokerConfigSchema>;
export type BrokerConfig = z.output<typeof brokerConfigSchema>;

export function parseBrokerConfig(input: BrokerConfigInput): BrokerConfig {
  const parsed = brokerConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new TabLoomError(
      'INVALID_CONFIG',
      'Broker configuration is invalid.',
      {
        issueCount: parsed.error.issues.length,
        issues: parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`,
          )
          .join('; '),
      },
    );
  }

  return parsed.data;
}
