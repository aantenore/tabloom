import { DeterministicInferenceAdapter } from '../src/adapters/deterministic.js';
import { createSharedWorkerBrokerHost } from '../src/shared-worker.js';
import { DEMO_RUNTIME_FINGERPRINT } from './runtime.js';

createSharedWorkerBrokerHost({
  adapter: new DeterministicInferenceAdapter({
    defaultChunkDelayMs: 10,
    defaultChunkSize: 4,
  }),
  config: {
    heartbeatIntervalMs: 150,
    leaderTimeoutMs: 600,
    namespace: 'tabloom-shared-demo',
    queueCapacity: 4,
    requestTimeoutMs: 12_000,
    runtimeFingerprint: DEMO_RUNTIME_FINGERPRINT,
  },
  clientLivenessIntervalMs: 100,
  clientLivenessTimeoutMs: 400,
  idleTimeoutMs: 1_000,
  scope: globalThis,
});
