import { createRuntimeFingerprint } from '@aantenore/tabloom/core';

export const runtimeManifest = {
  adapter: 'webllm@0.2.84',
  build: 'tabloom-vite-webllm-starter@1',
  configuration: 'single-generation-defaults@1',
  model: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
} as const;

export const starterPolicy = {
  broker: {
    heartbeatIntervalMs: 500,
    leaderTimeoutMs: 3_000,
    maxConcurrent: 1,
    namespace: 'tabloom-vite-webllm-starter',
    queueCapacity: 4,
    requestTimeoutMs: 180_000,
  },
  generation: {
    maxTokens: 96,
    temperature: 0,
  },
  host: {
    clientLivenessIntervalMs: 1_000,
    clientLivenessTimeoutMs: 5_000,
    idleTimeoutMs: 30_000,
  },
  topology: {
    lifecyclePolicy: 'portable',
    mode: 'auto',
    requiredCapabilities: ['webgpu'],
  },
} as const;

export async function resolveRuntimeConfig() {
  const runtimeFingerprint = await createRuntimeFingerprint({
    ...runtimeManifest,
    brokerPolicy: JSON.stringify(starterPolicy.broker),
    generationPolicy: JSON.stringify(starterPolicy.generation),
  });

  return {
    broker: { ...starterPolicy.broker, runtimeFingerprint },
    generation: starterPolicy.generation,
    host: starterPolicy.host,
    modelId: runtimeManifest.model,
    topology: starterPolicy.topology,
    workerName: `${starterPolicy.broker.namespace}:${runtimeFingerprint}`,
  } as const;
}
