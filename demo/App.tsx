import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DeterministicInferenceAdapter,
  TabLoomError,
  createBrowserBroker,
  type BrokerEvent,
  type BrokerSnapshot,
  type DeterministicChunk,
  type DeterministicRequest,
  type DeterministicResult,
  type InferenceSession,
} from '@tabloom';
import { CollectingTelemetry } from '../src/adapters/runtime.js';
import { Controls } from './components/Controls.js';
import { Timeline } from './components/Timeline.js';
import { Topology } from './components/Topology.js';
import { LoomMark, ShieldIcon } from './icons.js';
import { DEMO_RUNTIME_FINGERPRINT } from './runtime.js';

type DemoSession = InferenceSession<DeterministicChunk, DeterministicResult>;

interface DemoConfig {
  readonly capacity: number;
  readonly delayMs: number;
  readonly namespace: string;
}

export function App() {
  const config = useMemo(() => readDemoConfig(), []);
  const telemetry = useMemo(() => new CollectingTelemetry(), []);
  const adapter = useMemo(
    () =>
      new DeterministicInferenceAdapter({
        defaultChunkDelayMs: config.delayMs,
        defaultChunkSize: 6,
      }),
    [config.delayMs],
  );
  const broker = useMemo(
    () =>
      createBrowserBroker<
        DeterministicRequest,
        DeterministicChunk,
        DeterministicResult
      >({
        adapter,
        config: {
          heartbeatIntervalMs: 150,
          leaderTimeoutMs: 600,
          namespace: config.namespace,
          queueCapacity: config.capacity,
          requestTimeoutMs: 12_000,
          runtimeFingerprint: DEMO_RUNTIME_FINGERPRINT,
        },
        telemetry,
      }),
    [adapter, config.capacity, config.namespace, telemetry],
  );
  const [snapshot, setSnapshot] = useState<BrokerSnapshot>(broker.snapshot);
  const snapshotRef = useRef(snapshot);
  const [events, setEvents] = useState<BrokerEvent[]>([]);
  const [prompt, setPrompt] = useState(
    'Coordinate one local model runtime across these browser tabs.',
  );
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string>();
  const [requestStatus, setRequestStatus] = useState('idle');
  const [isActive, setIsActive] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [terminalCount, setTerminalCount] = useState(0);
  const [capacityDraft, setCapacityDraft] = useState(config.capacity);
  const activeSession = useRef<DemoSession | undefined>(undefined);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const unsubscribe = broker.subscribe((nextSnapshot, event) => {
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      if (event !== undefined) {
        setEvents((current) => [event, ...current].slice(0, 80));
        if (
          event.type === 'retry' &&
          event.requestId === activeSession.current?.id
        ) {
          setOutput('');
          setChunkCount(0);
          setRequestStatus('retrying on new owner');
        }
      }
    });
    void broker.start().catch((cause: unknown) => {
      setError(safeMessage(cause));
      setRequestStatus('capability error');
    });
    return () => {
      unsubscribe();
      void broker.stop();
    };
  }, [broker]);

  const send = useCallback(() => {
    if (activeSession.current !== undefined || prompt.trim().length === 0) {
      return;
    }
    setOutput('');
    setError(undefined);
    setChunkCount(0);
    setRequestStatus('waiting for owner');
    const session = broker.request({
      chunkDelayMs: config.delayMs,
      chunkSize: 6,
      text: prompt.trim(),
    });
    activeSession.current = session;
    setIsActive(true);
    const resultPromise = session.result;
    void resultPromise.catch(() => undefined);
    void (async () => {
      try {
        setRequestStatus('streaming');
        for await (const chunk of session) {
          setOutput((current) => current + chunk.text);
          setChunkCount((current) => current + 1);
        }
        await resultPromise;
        setRequestStatus('completed');
      } catch (cause) {
        const code =
          cause instanceof TabLoomError ? cause.code : 'ADAPTER_FAILED';
        setRequestStatus(statusForError(code));
        setError(safeMessage(cause));
      } finally {
        activeSession.current = undefined;
        setIsActive(false);
        setTerminalCount((current) => current + 1);
      }
    })();
  }, [broker, config.delayMs, prompt]);

  const cancel = useCallback(() => {
    activeSession.current?.cancel();
  }, []);

  const simulateCrash = useCallback(() => {
    if (snapshotRef.current.role === 'leader') {
      void broker.stop();
      setRequestStatus('owner stopped');
    }
  }, [broker]);

  const openPeer = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('namespace', config.namespace);
    url.searchParams.set('capacity', String(capacityDraft));
    window.open(url, '_blank', 'noopener');
  }, [capacityDraft, config.namespace]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <LoomMark />
          <span>TabLoom</span>
        </div>
        <div className="header-divider" />
        <span className="protocol-label">
          <span className="status-dot" /> Protocol v
          {snapshot.config.protocolVersion}
        </span>
        <div className="header-divider" />
        <span>Epoch {snapshot.epoch}</span>
        <div className="header-spacer" />
        <span className="fencing-label">
          <ShieldIcon /> Fencing epoch: {snapshot.epoch}
        </span>
        <span className={`health-label health-${snapshot.readiness}`}>
          <span className="status-dot" /> Broker: {snapshot.readiness}
        </span>
      </header>

      <div className="workspace">
        <Topology snapshot={snapshot} />
        <Controls
          active={isActive}
          capacityDraft={capacityDraft}
          error={error}
          output={output}
          prompt={prompt}
          requestStatus={requestStatus}
          snapshot={snapshot}
          onCancel={cancel}
          onCapacityChange={setCapacityDraft}
          onOpenPeer={openPeer}
          onPromptChange={setPrompt}
          onSend={send}
          onSimulateCrash={simulateCrash}
        />
      </div>

      <Timeline events={events} onClear={() => setEvents([])} />

      <output className="test-evidence" aria-label="Test evidence">
        <span data-testid="chunk-count">{chunkCount}</span>
        <span data-testid="terminal-count">{terminalCount}</span>
        <span data-testid="peer-count">{snapshot.knownPeers.length}</span>
        <span data-testid="leader-id">
          {snapshot.role === 'leader'
            ? snapshot.tabId
            : (snapshot.leaderId ?? '')}
        </span>
      </output>
    </main>
  );
}

function readDemoConfig(): DemoConfig {
  const search = new URLSearchParams(window.location.search);
  return {
    capacity: boundedInteger(search.get('capacity'), 1, 16, 8),
    delayMs: boundedInteger(search.get('delay'), 0, 2_000, 45),
    namespace: sanitizeNamespace(search.get('namespace') ?? 'tabloom-demo'),
  };
}

function boundedInteger(
  value: string | null,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function sanitizeNamespace(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/gu, '').slice(0, 80);
  return safe.length === 0 ? 'tabloom-demo' : safe;
}

function safeMessage(cause: unknown): string {
  return cause instanceof TabLoomError
    ? cause.message
    : 'The broker operation failed.';
}

function statusForError(code: TabLoomError['code']): string {
  switch (code) {
    case 'BACKPRESSURE':
      return 'backpressure';
    case 'CANCELLED':
      return 'cancelled';
    case 'TIMEOUT':
      return 'timed out';
    case 'PROTOCOL_MISMATCH':
      return 'protocol mismatch';
    case 'RUNTIME_MISMATCH':
      return 'runtime mismatch';
    case 'ADAPTER_FAILED':
      return 'adapter failed';
    case 'BROKER_STOPPED':
    case 'CAPABILITY_UNAVAILABLE':
    case 'EPOCH_JOURNAL_FAILED':
    case 'INVALID_CONFIG':
    case 'NO_LEADER':
    case 'START_FAILED':
    case 'TOPOLOGY_UNAVAILABLE':
    case 'TRANSPORT_FAILED':
      return 'failed';
  }
}
