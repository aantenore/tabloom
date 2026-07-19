import { WebLlmInferenceAdapter } from '@aantenore/tabloom/adapters/webllm';
import { createSharedWorkerBrokerHost } from '@aantenore/tabloom/shared-worker';
import { resolveRuntimeConfig } from './runtime-config';

const runtime = await resolveRuntimeConfig();

createSharedWorkerBrokerHost({
  adapter: new WebLlmInferenceAdapter({ modelId: runtime.modelId }),
  config: runtime.broker,
  ...runtime.host,
  scope: globalThis,
});
