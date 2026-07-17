import type { BrokerSnapshot } from '@tabloom';
import { AlertIcon, SendIcon, ShieldIcon, SlidersIcon } from '../icons.js';

interface ControlsProps {
  readonly active: boolean;
  readonly capacityDraft: number;
  readonly error: string | undefined;
  readonly output: string;
  readonly prompt: string;
  readonly requestStatus: string;
  readonly snapshot: BrokerSnapshot;
  readonly onCancel: () => void;
  readonly onCapacityChange: (value: number) => void;
  readonly onOpenPeer: () => void;
  readonly onPromptChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onSimulateCrash: () => void;
}

export function Controls({
  active,
  capacityDraft,
  error,
  output,
  prompt,
  requestStatus,
  snapshot,
  onCancel,
  onCapacityChange,
  onOpenPeer,
  onPromptChange,
  onSend,
  onSimulateCrash,
}: ControlsProps) {
  return (
    <aside className="controls" aria-labelledby="controls-title">
      <header className="section-header controls-header">
        <div className="section-title">
          <SlidersIcon />
          <h2 id="controls-title">Broker controls</h2>
        </div>
      </header>

      <div className="control-body">
        <label className="prompt-field">
          <span>Prompt</span>
          <textarea
            data-testid="prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Synthetic input for the deterministic adapter"
            maxLength={2_000}
          />
          <small>
            {prompt.length} characters · content stays out of telemetry
          </small>
        </label>

        <div className="button-row">
          <button
            className="primary-button"
            data-testid="send"
            onClick={onSend}
            disabled={
              active ||
              prompt.trim().length === 0 ||
              snapshot.role === 'stopped'
            }
          >
            <SendIcon />
            Send stream
          </button>
          <button
            className="quiet-button"
            data-testid="cancel"
            onClick={onCancel}
            disabled={!active}
          >
            Cancel
          </button>
        </div>

        <button
          className="danger-button"
          data-testid="simulate-crash"
          onClick={onSimulateCrash}
          disabled={snapshot.role !== 'leader'}
        >
          <AlertIcon />
          Simulate owner stop
        </button>

        <button className="secondary-button" onClick={onOpenPeer}>
          Open sibling tab
        </button>

        <div className="range-control">
          <div>
            <span>Queue limit</span>
            <strong>{capacityDraft}</strong>
          </div>
          <input
            aria-label="Queue limit"
            type="range"
            min="1"
            max="16"
            value={capacityDraft}
            onChange={(event) => onCapacityChange(Number(event.target.value))}
          />
          <small>Applied to newly opened sibling tabs.</small>
        </div>

        <section className="privacy-note">
          <ShieldIcon />
          <div>
            <strong>Privacy-safe telemetry</strong>
            <p>Counts, timings, safe codes, and state changes only.</p>
            <p>No prompt content recorded.</p>
          </div>
        </section>

        <dl className="protocol-status">
          <div>
            <dt>Protocol</dt>
            <dd>v{snapshot.config.protocolVersion}</dd>
          </div>
          <div>
            <dt>Fencing epoch</dt>
            <dd data-testid="epoch">{snapshot.epoch}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd data-testid="role">{snapshot.role}</dd>
          </div>
          <div>
            <dt>Queue</dt>
            <dd data-testid="queue-depth">{snapshot.queueDepth}</dd>
          </div>
          <div>
            <dt>Adapter</dt>
            <dd>{snapshot.adapter.name}</dd>
          </div>
        </dl>

        <section className="request-output" aria-live="polite">
          <div>
            <span>Status</span>
            <strong data-testid="request-status">{requestStatus}</strong>
          </div>
          <pre data-testid="output">
            {output || 'Stream output will appear here.'}
          </pre>
          {error === undefined ? null : <p className="error-copy">{error}</p>}
        </section>
      </div>
    </aside>
  );
}
