import { WebLlmInferenceAdapter } from '../src/adapters/webllm.js';
import { createSharedWorkerBrokerHost } from '../src/shared-worker.js';
import {
  createWebLlmRuntimeFingerprint,
  parseWebLlmSharedWorkerName,
} from './webllm-shared-worker-config.js';

const workerName: unknown = Reflect.get(globalThis, 'name');
if (typeof workerName !== 'string') {
  throw new Error('The WebLLM SharedWorker has no runtime name.');
}

const { modelId, namespace } = parseWebLlmSharedWorkerName(workerName);
const runtimeFingerprint = await createWebLlmRuntimeFingerprint(modelId);

createSharedWorkerBrokerHost({
  adapter: new WebLlmInferenceAdapter({ modelId }),
  config: {
    heartbeatIntervalMs: 500,
    leaderTimeoutMs: 3_000,
    maxConcurrent: 1,
    namespace,
    queueCapacity: 2,
    requestTimeoutMs: 180_000,
    runtimeFingerprint,
  },
  clientLivenessIntervalMs: 1_000,
  clientLivenessTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
  scope: globalThis,
});
