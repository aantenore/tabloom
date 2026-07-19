import TabLoomWorker from './tabloom.worker?sharedworker';
import { WebLlmInferenceAdapter } from '@aantenore/tabloom/adapters/webllm';
import { createAdaptiveBrowserBroker } from '@aantenore/tabloom/shared-worker';
import { resolveRuntimeConfig } from './runtime-config';
import './styles.css';

const elements = {
  epoch: requiredElement<HTMLElement>('epoch'),
  form: requiredElement<HTMLFormElement>('form'),
  model: requiredElement<HTMLElement>('model'),
  output: requiredElement<HTMLElement>('output'),
  peer: requiredElement<HTMLButtonElement>('peer'),
  prompt: requiredElement<HTMLTextAreaElement>('prompt'),
  readiness: requiredElement<HTMLElement>('readiness'),
  role: requiredElement<HTMLElement>('role'),
  status: requiredElement<HTMLElement>('status'),
  submit: requiredElement<HTMLButtonElement>('submit'),
  topology: requiredElement<HTMLElement>('topology'),
};

elements.peer.addEventListener('click', () => {
  window.open(window.location.href, '_blank', 'noopener');
});

void start();

async function start(): Promise<void> {
  if (!window.isSecureContext || !Reflect.has(navigator, 'gpu')) {
    setStatus(
      'WebGPU requires a compatible browser on HTTPS or loopback.',
      true,
    );
    return;
  }

  const runtime = await resolveRuntimeConfig();
  elements.model.textContent = runtime.modelId;
  let active = false;
  let canSubmit = false;
  let terminalStatus = false;

  const adapter = new WebLlmInferenceAdapter({
    engineConfig: runtime.engineConfig,
    modelId: runtime.modelId,
    onProgress: ({ progress, text }) => {
      setStatus(
        `${text || 'Loading the local runtime'} (${Math.round(progress * 100)}%)`,
      );
    },
  });

  try {
    const selection = await createAdaptiveBrowserBroker({
      adapter,
      config: runtime.broker,
      topology: {
        lifecyclePolicy: runtime.topology.lifecyclePolicy,
        mode: runtime.topology.mode,
        name: runtime.workerName,
        requiredCapabilities: runtime.topology.requiredCapabilities,
        workerFactory: ({ name }) => new TabLoomWorker({ name }),
      },
    });
    const broker = selection.broker;
    elements.topology.textContent = selection.topology;

    const refreshSubmit = () => {
      elements.submit.disabled = active || !canSubmit;
    };
    const unsubscribe = broker.subscribe((snapshot) => {
      elements.epoch.textContent = String(snapshot.epoch);
      elements.readiness.textContent = snapshot.readiness;
      elements.role.textContent = snapshot.role;
      canSubmit =
        snapshot.readiness === 'ready' &&
        (selection.topology === 'shared-worker' || snapshot.role === 'peer');
      if (!active && !terminalStatus) {
        if (
          snapshot.readiness === 'ready' &&
          selection.topology === 'page-owner' &&
          snapshot.role === 'leader'
        ) {
          setStatus('Runtime ready. Open a sibling page to submit work.');
        } else if (snapshot.readiness === 'ready') {
          setStatus('Runtime ready for local inference.');
        }
      }
      refreshSubmit();
    });

    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!active && canSubmit) {
        void runPrompt();
      }
    });

    async function runPrompt(): Promise<void> {
      const prompt = elements.prompt.value.trim();
      if (prompt.length === 0) {
        terminalStatus = true;
        setStatus('Enter a prompt before running inference.', true);
        return;
      }

      active = true;
      terminalStatus = false;
      refreshSubmit();
      elements.output.textContent = '';
      setStatus('Running on the selected local owner.');

      try {
        const session = broker.request({
          max_tokens: runtime.generation.maxTokens,
          messages: [{ content: prompt, role: 'user' }],
          stream_options: { include_usage: true },
          temperature: runtime.generation.temperature,
        });
        const resultPromise = session.result;
        void resultPromise.catch(() => undefined);
        let streamedText = '';
        for await (const chunk of session) {
          streamedText += chunk.choices[0]?.delta.content ?? '';
          elements.output.textContent = streamedText;
        }
        const result = await resultPromise;
        elements.output.textContent = result.text;
        terminalStatus = true;
        setStatus('Completed locally.');
      } catch (cause) {
        terminalStatus = true;
        setStatus(messageFrom(cause), true);
      } finally {
        active = false;
        refreshSubmit();
      }
    }

    window.addEventListener(
      'pagehide',
      () => {
        unsubscribe();
        void broker.stop();
      },
      { once: true },
    );

    setStatus('Starting the broker and local runtime.');
    await broker.start();
  } catch (cause) {
    setStatus(messageFrom(cause), true);
  }
}

function requiredElement<T extends Element>(field: string): T {
  const element = document.querySelector(`[data-field="${field}"]`);
  if (element === null) {
    throw new Error(`Missing required element: ${field}`);
  }
  return element as T;
}

function setStatus(message: string, error = false): void {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', error);
}

function messageFrom(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Local inference failed.';
}
