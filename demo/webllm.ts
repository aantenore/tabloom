import WebLlmSharedWorkerHost from './webllm-shared-worker-host?sharedworker';
import { WebLlmInferenceAdapter } from '../src/adapters/webllm.js';
import { createBrowserBroker } from '../src/browser.js';
import { createAdaptiveBrowserBroker } from '../src/shared-worker.js';
import {
  createWebLlmRuntimeFingerprint,
  createWebLlmSharedWorkerName,
} from './webllm-shared-worker-config.js';

const DEFAULT_MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';

const elements = {
  epoch: requiredElement('epoch'),
  evidence: requiredElement('evidence'),
  progressEventCount: requiredElement('progress-event-count'),
  modelId: requiredElement('model-id'),
  openPeer: requiredButton('open-peer'),
  output: requiredOutput('output'),
  ownerId: requiredElement('owner-id'),
  peerCount: requiredElement('peer-count'),
  progress: requiredElement('progress'),
  prompt: requiredTextArea('prompt'),
  readiness: requiredElement('readiness'),
  requestStatus: requiredElement('request-status'),
  resultText: requiredElement('result-text'),
  role: requiredElement('role'),
  send: requiredButton('send'),
  tabId: requiredElement('tab-id'),
  terminalCount: requiredElement('terminal-count'),
  topology: requiredElement('topology'),
  usageTokens: requiredElement('usage-tokens'),
  webgpu: requiredElement('webgpu'),
};

void runLiveLab();

async function runLiveLab(): Promise<void> {
  const search = new URLSearchParams(window.location.search);
  const namespace = sanitizeNamespace(
    search.get('namespace') ?? `tabloom-webllm-${crypto.randomUUID()}`,
  );
  const modelId = sanitizeModelId(search.get('model') ?? DEFAULT_MODEL_ID);
  const topology =
    search.get('topology') === 'shared-worker' ? 'shared-worker' : 'page-owner';
  const gpuAvailable = Reflect.has(navigator, 'gpu');

  elements.modelId.textContent = modelId;
  elements.webgpu.textContent = gpuAvailable ? 'available' : 'unavailable';
  elements.openPeer.addEventListener('click', () => {
    const peerUrl = new URL(window.location.href);
    peerUrl.searchParams.set('namespace', namespace);
    peerUrl.searchParams.set('model', modelId);
    window.open(peerUrl, '_blank', 'noopener');
  });

  if (!gpuAvailable) {
    setStatus('WebGPU is unavailable in this browser.', true);
    elements.progress.textContent = 'The provider runtime was not started.';
    return;
  }

  try {
    let progressEventCount = 0;
    const adapter = new WebLlmInferenceAdapter({
      modelId,
      onProgress: (progress) => {
        progressEventCount += 1;
        elements.progressEventCount.textContent = String(progressEventCount);
        elements.progress.textContent = progressMessage(progress);
      },
    });
    const runtimeFingerprint = await createWebLlmRuntimeFingerprint(modelId);
    const config = {
      heartbeatIntervalMs: 500,
      leaderTimeoutMs: 3_000,
      maxConcurrent: 1,
      namespace,
      queueCapacity: 2,
      requestTimeoutMs: 180_000,
      runtimeFingerprint,
    } as const;
    const selection =
      topology === 'shared-worker'
        ? await createAdaptiveBrowserBroker({
            adapter,
            config,
            topology: {
              mode: 'shared-worker',
              name: createWebLlmSharedWorkerName({ modelId, namespace }),
              requiredCapabilities: ['webgpu'],
              workerFactory: (options) =>
                new WebLlmSharedWorkerHost({ name: options.name }),
            },
          })
        : {
            broker: createBrowserBroker({ adapter, config }),
            topology: 'page-owner' as const,
          };
    const broker = selection.broker;
    elements.topology.textContent = selection.topology;
    let active = false;
    let role = broker.snapshot.role;
    let readiness = broker.snapshot.readiness;

    const refreshSend = () => {
      elements.send.disabled =
        active || role !== 'peer' || readiness !== 'ready';
    };

    const unsubscribe = broker.subscribe((snapshot) => {
      role = snapshot.role;
      readiness = snapshot.readiness;
      elements.role.textContent = snapshot.role;
      elements.role.className = `role-${snapshot.role}`;
      elements.readiness.textContent = snapshot.readiness;
      elements.readiness.className =
        snapshot.readiness === 'ready' ? 'status-ready' : '';
      elements.evidence.textContent = snapshot.adapter.evidence;
      elements.peerCount.textContent = String(snapshot.knownPeers.length);
      elements.ownerId.textContent =
        snapshot.role === 'leader' ? snapshot.tabId : (snapshot.leaderId ?? '');
      elements.tabId.textContent = snapshot.tabId;
      elements.epoch.textContent = String(snapshot.epoch);
      elements.terminalCount.textContent = String(snapshot.terminalCount);
      if (
        snapshot.readiness === 'ready' &&
        elements.progress.textContent === 'Waiting to start.'
      ) {
        elements.progress.textContent = 'Runtime ready on the elected owner.';
      }
      refreshSend();
    });

    elements.send.addEventListener('click', () => {
      if (active || role !== 'peer' || readiness !== 'ready') {
        return;
      }
      const prompt = elements.prompt.value.trim();
      if (prompt.length === 0) {
        setStatus('Enter a prompt before submitting.', true);
        return;
      }

      active = true;
      elements.output.textContent = '';
      setStatus('waiting for owner');
      refreshSend();

      const session = broker.request({
        max_tokens: 32,
        messages: [{ content: prompt, role: 'user' }],
        stream_options: { include_usage: true },
        temperature: 0,
      });
      const resultPromise = session.result;
      void resultPromise.catch(() => undefined);
      void (async () => {
        let streamedText = '';
        try {
          setStatus('streaming');
          for await (const chunk of session) {
            streamedText += deltaText(chunk);
            elements.output.textContent = streamedText;
          }
          const result = await resultPromise;
          elements.resultText.textContent = result.text;
          elements.usageTokens.textContent = String(
            result.usage?.total_tokens ?? 0,
          );
          elements.output.textContent = streamedText || resultText(result);
          setStatus('completed');
        } catch (cause) {
          setStatus(safeMessage(cause), true);
        } finally {
          active = false;
          refreshSend();
        }
      })();
    });

    window.addEventListener(
      'pagehide',
      () => {
        unsubscribe();
        void broker.stop();
      },
      { once: true },
    );

    setStatus('starting broker');
    await broker.start();
  } catch (cause) {
    setStatus(safeMessage(cause), true);
    elements.progress.textContent = 'The provider runtime could not start.';
  }
}

function deltaText(chunk: unknown): string {
  if (!isRecord(chunk)) {
    return '';
  }
  const choices = chunk['choices'];
  if (!Array.isArray(choices)) {
    return '';
  }
  const firstChoice: unknown = choices[0];
  if (!isRecord(firstChoice)) {
    return '';
  }
  const delta = firstChoice['delta'];
  if (!isRecord(delta)) {
    return '';
  }
  const content = delta['content'];
  return typeof content === 'string' ? content : '';
}

function resultText(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }
  const text = result['text'];
  return typeof text === 'string' ? text : '';
}

function progressMessage(progress: unknown): string {
  if (typeof progress === 'string') {
    return progress;
  }
  if (!isRecord(progress)) {
    return 'Initializing provider runtime.';
  }

  const label = [progress['text'], progress['message']].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const ratio = progress['progress'];
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    return label === undefined ? `${percent}%` : `${label} (${percent}%)`;
  }
  return label ?? 'Initializing provider runtime.';
}

function setStatus(message: string, error = false): void {
  elements.requestStatus.textContent = message;
  elements.requestStatus.className = error ? 'status-error' : '';
}

function safeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The live request failed.';
}

function sanitizeNamespace(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/gu, '').slice(0, 80);
  return safe.length > 0 ? safe : 'tabloom-webllm';
}

function sanitizeModelId(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._/-]/gu, '').slice(0, 160);
  return safe.length > 0 ? safe : DEFAULT_MODEL_ID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing live lab element: ${id}`);
  }
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Live lab element is not a button: ${id}`);
  }
  return element;
}

function requiredOutput(id: string): HTMLOutputElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLOutputElement)) {
    throw new Error(`Live lab element is not an output: ${id}`);
  }
  return element;
}

function requiredTextArea(id: string): HTMLTextAreaElement {
  const element = requiredElement(id);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`Live lab element is not a textarea: ${id}`);
  }
  return element;
}
