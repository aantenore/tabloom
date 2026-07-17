import type { BrokerConfig } from './config.js';
import type { ProtocolEnvelope } from './protocol.js';

export type BrokerRole = 'candidate' | 'leader' | 'peer' | 'stopped';
export type BrokerReadiness = 'idle' | 'initializing' | 'ready' | 'stopped';
export type TerminalStatus =
  | 'backpressure'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'protocol_error'
  | 'timed_out';

export interface AdapterDescriptor {
  readonly evidence: 'deterministic-simulation' | 'provider-runtime';
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export interface InferenceContext<TChunk> {
  readonly attempt: number;
  readonly emit: (chunk: TChunk) => void;
  readonly epoch: number;
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export interface InferenceAdapter<TRequest, TChunk, TResult> {
  readonly descriptor: AdapterDescriptor;
  dispose?(): Promise<void> | void;
  initialize?(signal: AbortSignal): Promise<void> | void;
  run(request: TRequest, context: InferenceContext<TChunk>): Promise<TResult>;
}

export interface LeadershipLease {
  readonly epoch: number;
  readonly signal: AbortSignal;
}

export interface ElectionPort {
  start(listener: (lease: LeadershipLease) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export interface TransportPort {
  close(): void;
  send(envelope: ProtocolEnvelope): void;
  subscribe(listener: (envelope: unknown) => void): () => void;
}

export interface ClockPort {
  now(): number;
  setInterval(callback: () => void, delayMs: number): unknown;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
  clearTimeout(handle: unknown): void;
}

export interface IdPort {
  next(): string;
}

export type SafeTelemetryEvent = Readonly<{
  at: number;
  durationMs?: number;
  epoch?: number;
  kind:
    | 'adapter_failed'
    | 'admission_rejected'
    | 'broker_started'
    | 'broker_stopped'
    | 'chunk_emitted'
    | 'leader_acquired'
    | 'leader_changed'
    | 'message_rejected'
    | 'request_cancelled'
    | 'request_completed'
    | 'request_started'
    | 'request_timed_out';
  queueDepth?: number;
  reason?: string;
  requestId?: string;
  tabId: string;
}>;

export interface TelemetryPort {
  record(event: SafeTelemetryEvent): void;
}

export interface PeerSnapshot {
  readonly id: string;
  readonly lastSeenAt: number;
}

export interface BrokerSnapshot {
  readonly adapter: AdapterDescriptor;
  readonly config: BrokerConfig;
  readonly epoch: number;
  readonly knownPeers: readonly PeerSnapshot[];
  readonly leaderId?: string;
  readonly queueDepth: number;
  readonly readiness: BrokerReadiness;
  readonly role: BrokerRole;
  readonly tabId: string;
  readonly terminalCount: number;
}

export type BrokerEventType =
  | 'accepted'
  | 'backpressure'
  | 'cancelled'
  | 'chunk'
  | 'completed'
  | 'failed'
  | 'leader-acquired'
  | 'leader-changed'
  | 'protocol-rejected'
  | 'request'
  | 'retry'
  | 'stale-rejected'
  | 'timed-out';

export interface BrokerEvent {
  readonly at: number;
  readonly attempt?: number;
  readonly epoch?: number;
  readonly queueDepth?: number;
  readonly requestId?: string;
  readonly sourceId?: string;
  readonly type: BrokerEventType;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface InferenceSession<
  TChunk,
  TResult,
> extends AsyncIterable<TChunk> {
  readonly id: string;
  readonly result: Promise<TResult>;
  cancel(): void;
}

export interface BrokerDependencies<TRequest, TChunk, TResult> {
  readonly adapter: InferenceAdapter<TRequest, TChunk, TResult>;
  readonly clock: ClockPort;
  readonly election: ElectionPort;
  readonly ids: IdPort;
  readonly telemetry: TelemetryPort;
  readonly transport: TransportPort;
}
