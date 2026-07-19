import SharedWorkerHost from './shared-worker-host?sharedworker';
import {
  DeterministicInferenceAdapter,
  TabLoomError,
  type DeterministicChunk,
  type DeterministicResult,
  type InferenceSession,
} from '@tabloom';
import {
  createAdaptiveBrowserBroker,
  type BrowserBrokerTopologyMode,
  type SharedWorkerTopologyOptions,
} from '../src/shared-worker.js';
import { DEMO_RUNTIME_FINGERPRINT } from './runtime.js';

const alternateFingerprint = `sha256:${'1'.repeat(64)}`;
const search = new URLSearchParams(window.location.search);
const mode = parseMode(search.get('mode'));
const runtimeFingerprint = search.has('mismatch')
  ? alternateFingerprint
  : DEMO_RUNTIME_FINGERPRINT;
const requiredCapabilities = search.has('forceFallback')
  ? ['unsupported-capability']
  : [];
const topology: SharedWorkerTopologyOptions =
  mode === 'page-owner'
    ? { mode }
    : {
        mode,
        name: 'tabloom-shared-demo',
        requiredCapabilities,
        workerFactory: (options) =>
          new SharedWorkerHost({ name: options.name }),
      };

const elements = {
  cancel: requiredButton('cancel'),
  compatibility: requiredElement('compatibility'),
  epoch: requiredElement('epoch'),
  error: requiredElement('error'),
  fallback: requiredElement('fallback'),
  leaderId: requiredElement('leader-id'),
  openPeer: requiredButton('open-peer'),
  output: requiredOutput('output'),
  prompt: requiredTextArea('prompt'),
  readiness: requiredElement('readiness'),
  requestStatus: requiredElement('request-status'),
  role: requiredElement('role'),
  send: requiredButton('send'),
  tabId: requiredElement('tab-id'),
  topology: requiredElement('topology'),
};

void run();

async function run(): Promise<void> {
  let active:
    InferenceSession<DeterministicChunk, DeterministicResult> | undefined;
  elements.openPeer.addEventListener('click', () => {
    window.open(window.location.href, '_blank', 'noopener');
  });
  try {
    const selection = await createAdaptiveBrowserBroker({
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
        runtimeFingerprint,
      },
      topology,
    });
    elements.topology.textContent = selection.topology;
    elements.fallback.textContent = selection.fallbackReason ?? 'none';
    const broker = selection.broker;
    const unsubscribe = broker.subscribe((snapshot) => {
      elements.role.textContent = snapshot.role;
      elements.readiness.textContent = snapshot.readiness;
      elements.leaderId.textContent = snapshot.leaderId ?? '';
      elements.tabId.textContent = snapshot.tabId;
      elements.epoch.textContent = String(snapshot.epoch);
      elements.compatibility.textContent = snapshot.runtimeCompatibility;
      elements.send.disabled =
        snapshot.readiness !== 'ready' || active !== undefined;
    });
    await broker.start();

    const submit = async () => {
      if (active !== undefined) {
        return;
      }
      elements.output.textContent = '';
      elements.error.textContent = '';
      elements.requestStatus.textContent = 'running';
      active = broker.request({
        chunkDelayMs: 10,
        chunkSize: 4,
        text: elements.prompt.value,
      });
      const result = active.result;
      void result.catch(() => undefined);
      elements.cancel.disabled = false;
      try {
        for await (const chunk of active) {
          elements.output.textContent += chunk.text;
        }
        await result;
        elements.requestStatus.textContent = 'completed';
      } catch (error) {
        elements.error.textContent = safeCode(error);
        elements.requestStatus.textContent = 'failed';
      } finally {
        active = undefined;
        elements.cancel.disabled = true;
        elements.send.disabled = broker.snapshot.readiness !== 'ready';
      }
    };
    elements.send.addEventListener('click', () => {
      void submit();
    });
    elements.cancel.addEventListener('click', () => active?.cancel());
    window.addEventListener('pagehide', () => {
      unsubscribe();
      void broker.stop();
    });
  } catch (error) {
    elements.error.textContent = safeCode(error);
    elements.requestStatus.textContent = 'failed';
    elements.topology.textContent = 'unavailable';
  }
}

function parseMode(value: string | null): BrowserBrokerTopologyMode {
  return value === 'page-owner' || value === 'shared-worker' ? value : 'auto';
}

function safeCode(error: unknown): string {
  return error instanceof TabLoomError ? error.code : 'UNKNOWN';
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing element: ${id}`);
  }
  return element;
}

function requiredButton(id: string): HTMLButtonElement {
  return requiredElement(id) as HTMLButtonElement;
}

function requiredOutput(id: string): HTMLOutputElement {
  return requiredElement(id) as HTMLOutputElement;
}

function requiredTextArea(id: string): HTMLTextAreaElement {
  return requiredElement(id) as HTMLTextAreaElement;
}
