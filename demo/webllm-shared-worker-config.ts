import { createRuntimeFingerprint } from '../src/core/runtime-fingerprint.js';

const WORKER_NAME_PREFIX = 'tabloom-webllm-v1?';

export interface WebLlmSharedWorkerConfig {
  readonly modelId: string;
  readonly namespace: string;
}

export function createWebLlmSharedWorkerName(
  config: WebLlmSharedWorkerConfig,
): string {
  return `${WORKER_NAME_PREFIX}${new URLSearchParams({
    model: config.modelId,
    namespace: config.namespace,
  }).toString()}`;
}

export function parseWebLlmSharedWorkerName(
  name: string,
): WebLlmSharedWorkerConfig {
  if (!name.startsWith(WORKER_NAME_PREFIX)) {
    throw new Error('The WebLLM SharedWorker name is incompatible.');
  }
  const search = new URLSearchParams(name.slice(WORKER_NAME_PREFIX.length));
  const namespace = search.get('namespace') ?? '';
  const modelId = search.get('model') ?? '';
  if (
    !/^[a-zA-Z0-9._-]{1,80}$/.test(namespace) ||
    !/^[a-zA-Z0-9._/-]{1,160}$/.test(modelId)
  ) {
    throw new Error('The WebLLM SharedWorker configuration is invalid.');
  }
  return { modelId, namespace };
}

export function createWebLlmRuntimeFingerprint(modelId: string) {
  return createRuntimeFingerprint({
    adapter: 'webllm@0.2.84',
    build: 'tabloom-webllm-live-lab-v1',
    configuration: 'default',
    model: modelId,
  });
}
