import { createRuntimeFingerprint } from '@aantenore/tabloom/core';
import type { AppConfig, MLCEngineConfig, ModelRecord } from '@mlc-ai/web-llm';

export const runtimeManifest = {
  adapter: 'webllm@0.2.84',
  build: 'tabloom-vite-webllm-starter@1',
  configuration: 'single-generation-defaults@1',
  controlPlane: 'tabloom@0.3.0-alpha.2',
  controlPlaneIntegrity:
    'sha512-E9LQMl+dovCjAksjA6jrmfFemviu6uT45IwjUK2dcsvnINiUPPiZUzXHd8pwbTHQhPeIft0SrnFcdTFNdxL3hg==',
  modelConfigIntegrity:
    'sha384-q5g7Vr8NPimskWQfkKEHbD/LHSezXA8Jd/6026NLSMR2rWz/4RoTUK9HsuC3seC4',
  modelId: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
  modelLibraryIntegrity:
    'sha384-orS1wyCqzySQio0yY+PZDZZAZclbgZNdjmO4FRo/7SF1jyUPqMHVwkvUo28pPsCB',
  modelLibraryUrl:
    'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/SmolLM2-360M-Instruct-q4f16_1_cs1k-webgpu.wasm',
  modelUrl:
    'https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f16_1-MLC/resolve/3a622fd89e0216e8bb10c410c007c786baa8a033/',
  tokenizerIntegrity:
    'sha384-TYQ9bvLe/Vytaer+YyXqKp0FA6bauwU+PxOlTcHSoLqTCPKrQwSHApOPo4MCLoB0',
} as const;

const modelOptions = {
  contextWindowSize: 4_096,
  lowResourceRequired: true,
  requiredFeatures: ['shader-f16'],
  vramRequiredMb: 376.06,
} as const;

const artifactPolicy = {
  cacheBackend: 'cache',
  integrityMode: 'error',
  tokenizerFiles: ['tokenizer.json'],
} as const;

const modelRecord = {
  integrity: {
    config: runtimeManifest.modelConfigIntegrity,
    model_lib: runtimeManifest.modelLibraryIntegrity,
    onFailure: artifactPolicy.integrityMode,
    tokenizer: {
      [artifactPolicy.tokenizerFiles[0]]: runtimeManifest.tokenizerIntegrity,
    },
  },
  low_resource_required: modelOptions.lowResourceRequired,
  model: runtimeManifest.modelUrl,
  model_id: runtimeManifest.modelId,
  model_lib: runtimeManifest.modelLibraryUrl,
  overrides: { context_window_size: modelOptions.contextWindowSize },
  required_features: [...modelOptions.requiredFeatures],
  vram_required_MB: modelOptions.vramRequiredMb,
} satisfies ModelRecord;

const appConfig = {
  cacheBackend: artifactPolicy.cacheBackend,
  model_list: [modelRecord],
} satisfies AppConfig;

const engineConfig = { appConfig } satisfies MLCEngineConfig;

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
    artifactPolicy: JSON.stringify(artifactPolicy),
    brokerPolicy: JSON.stringify(starterPolicy.broker),
    generationPolicy: JSON.stringify(starterPolicy.generation),
    hostPolicy: JSON.stringify(starterPolicy.host),
    modelOptions: JSON.stringify(modelOptions),
    topologyPolicy: JSON.stringify(starterPolicy.topology),
  });

  return {
    broker: { ...starterPolicy.broker, runtimeFingerprint },
    engineConfig,
    generation: starterPolicy.generation,
    host: starterPolicy.host,
    modelId: runtimeManifest.modelId,
    topology: starterPolicy.topology,
    workerName: `${starterPolicy.broker.namespace}:${runtimeFingerprint}`,
  } as const;
}
