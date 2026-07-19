import { parseBrokerConfig, type BrokerConfigInput } from './config.js';
import {
  asTabLoomError,
  TabLoomError,
  type TabLoomErrorCode,
} from './errors.js';
import {
  isProtocolCompatible,
  parseProtocolEnvelope,
  type AcceptedEnvelope,
  type CancelEnvelope,
  type ChunkEnvelope,
  type LeaderEnvelope,
  type RequestEnvelope,
  type TerminalEnvelope,
} from './protocol.js';
import { ManagedInferenceSession } from './session.js';
import {
  initialBrokerMachineState,
  transitionBrokerState,
  type BrokerMachineState,
} from './state-machine.js';
import type {
  BrokerDependencies,
  BrokerEvent,
  BrokerSnapshot,
  InferenceSession,
  LeadershipLease,
  PeerSnapshot,
  RequestOptions,
  SafeTelemetryEvent,
  TerminalStatus,
} from './types.js';

type BrokerListener = (snapshot: BrokerSnapshot, event?: BrokerEvent) => void;

interface PendingClient<TRequest, TChunk, TResult> {
  readonly deadlineAt: number;
  readonly detachSignal?: () => void;
  dispatchedEpoch: number;
  readonly payload: TRequest;
  readonly session: ManagedInferenceSession<TChunk, TResult>;
  readonly timeoutHandle: unknown;
}

type OwnerCancelReason = 'client' | 'lease_lost' | 'timeout';

interface OwnerWork {
  readonly abortController: AbortController;
  cancelReason?: OwnerCancelReason;
  readonly envelope: RequestEnvelope;
  readonly timeoutHandle: unknown;
}

export class TabLoomBroker<TRequest, TChunk, TResult> {
  readonly config;
  readonly tabId: string;
  #activeOwnerWork = new Map<string, OwnerWork>();
  #dependencies: BrokerDependencies<TRequest, TChunk, TResult>;
  #electionTask: Promise<void> | undefined;
  #heartbeatHandle?: unknown;
  #knownPeers = new Map<string, number>();
  #leader: LeaderEnvelope | undefined;
  #listeners = new Set<BrokerListener>();
  #machine: BrokerMachineState = initialBrokerMachineState;
  #ownerQueue: RequestEnvelope[] = [];
  #pendingClients = new Map<string, PendingClient<TRequest, TChunk, TResult>>();
  #presenceHandle?: unknown;
  #runtimeMismatch: LeaderEnvelope | undefined;
  #started = false;
  #startTask: Promise<void> | undefined;
  #terminated = false;
  #terminalCount = 0;
  #unsubscribeTransport: (() => void) | undefined;

  constructor(
    config: BrokerConfigInput,
    dependencies: BrokerDependencies<TRequest, TChunk, TResult>,
  ) {
    this.config = parseBrokerConfig(config);
    this.#dependencies = dependencies;
    this.tabId = dependencies.ids.next();
  }

  get snapshot(): BrokerSnapshot {
    const cutoff =
      this.#dependencies.clock.now() - this.config.leaderTimeoutMs * 3;
    const knownPeers: PeerSnapshot[] = [];
    for (const [id, lastSeenAt] of this.#knownPeers) {
      if (lastSeenAt >= cutoff) {
        knownPeers.push({ id, lastSeenAt });
      }
    }
    knownPeers.sort((left, right) => left.id.localeCompare(right.id));

    const runtimeCompatibility =
      this.#runtimeMismatch !== undefined
        ? 'mismatch'
        : this.#machine.role === 'leader' || this.#leader !== undefined
          ? 'compatible'
          : 'unknown';
    const base = {
      adapter: this.#dependencies.adapter.descriptor,
      config: this.config,
      epoch: this.#machine.epoch,
      knownPeers,
      queueDepth: this.#ownerQueue.length + this.#activeOwnerWork.size,
      readiness: this.#machine.readiness,
      role: this.#machine.role,
      runtimeCompatibility,
      tabId: this.tabId,
      terminalCount: this.#terminalCount,
    } as const;
    const withLeader =
      this.#machine.leaderId === undefined
        ? base
        : { ...base, leaderId: this.#machine.leaderId };
    const leaderAdapter =
      this.#leader?.adapter ?? this.#runtimeMismatch?.adapter;
    return leaderAdapter === undefined
      ? withLeader
      : { ...withLeader, leaderAdapter };
  }

  subscribe(listener: BrokerListener): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  start(): Promise<void> {
    if (this.#terminated) {
      return Promise.reject(
        new TabLoomError(
          'BROKER_STOPPED',
          'A stopped broker cannot be started again. Create a new broker.',
        ),
      );
    }
    if (this.#startTask !== undefined) {
      return this.#startTask;
    }
    if (this.#started) {
      return Promise.resolve();
    }

    const startTask = this.#start();
    this.#startTask = startTask;
    const clearStartTask = () => {
      if (this.#startTask === startTask) {
        this.#startTask = undefined;
      }
    };
    void startTask.then(clearStartTask, clearStartTask);
    return startTask;
  }

  async #start(): Promise<void> {
    this.#started = true;
    this.#machine = transitionBrokerState(this.#machine, { type: 'start' });
    try {
      this.#unsubscribeTransport = this.#dependencies.transport.subscribe(
        (input) => {
          this.#handleRawEnvelope(input);
        },
      );
      this.#sendPresence();
      this.#presenceHandle = this.#dependencies.clock.setInterval(
        () => this.#sendPresence(),
        this.config.heartbeatIntervalMs,
      );
      const electionTask = this.#dependencies.election.start(async (lease) =>
        this.#holdLeadership(lease),
      );
      this.#electionTask = electionTask;
      await electionTask;
      this.#record({ kind: 'broker_started' });
      this.#notify();
    } catch (error) {
      await this.#rollbackStart();
      throw new TabLoomError(
        'CAPABILITY_UNAVAILABLE',
        'The broker could not start with the configured browser capabilities.',
        {},
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  request(
    payload: TRequest,
    options: RequestOptions = {},
  ): InferenceSession<TChunk, TResult> {
    if (!this.#started || this.#machine.role === 'stopped') {
      throw new TabLoomError(
        'BROKER_STOPPED',
        'Start the broker before requesting work.',
      );
    }

    const requestId = this.#dependencies.ids.next();
    const timeoutMs = options.timeoutMs ?? this.config.requestTimeoutMs;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 600_000
    ) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'Request timeout is outside the allowed range.',
        {
          timeoutMs,
        },
      );
    }

    const session = new ManagedInferenceSession<TChunk, TResult>(
      requestId,
      () => this.#cancelClient(requestId, 'client'),
    );
    const deadlineAt = this.#dependencies.clock.now() + timeoutMs;
    const timeoutHandle = this.#dependencies.clock.setTimeout(
      () => this.#cancelClient(requestId, 'timeout'),
      timeoutMs,
    );

    let detachSignal: (() => void) | undefined;
    if (options.signal !== undefined) {
      const cancel = () => session.cancel();
      if (options.signal.aborted) {
        this.#dependencies.clock.setTimeout(cancel, 0);
      } else {
        options.signal.addEventListener('abort', cancel, { once: true });
        detachSignal = () =>
          options.signal?.removeEventListener('abort', cancel);
      }
    }

    const pendingBase = {
      deadlineAt,
      dispatchedEpoch: 0,
      payload,
      session,
      timeoutHandle,
    } as const;
    this.#pendingClients.set(
      requestId,
      detachSignal === undefined
        ? pendingBase
        : { ...pendingBase, detachSignal },
    );
    this.#dispatchClient(requestId);
    return session;
  }

  async stop(): Promise<void> {
    const startTask = this.#startTask;
    if (startTask !== undefined) {
      try {
        await startTask;
      } catch {
        return;
      }
    }
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#terminated = true;
    this.#machine = transitionBrokerState(this.#machine, { type: 'stop' });
    if (this.#presenceHandle !== undefined) {
      this.#dependencies.clock.clearInterval(this.#presenceHandle);
      this.#presenceHandle = undefined;
    }
    if (this.#heartbeatHandle !== undefined) {
      this.#dependencies.clock.clearInterval(this.#heartbeatHandle);
      this.#heartbeatHandle = undefined;
    }
    this.#unsubscribeTransport?.();
    this.#unsubscribeTransport = undefined;

    const stoppedError = new TabLoomError(
      'BROKER_STOPPED',
      'The broker stopped before completion.',
    );
    for (const requestId of [...this.#pendingClients.keys()]) {
      const pending = this.#pendingClients.get(requestId);
      pending?.session.stop(stoppedError);
      this.#deletePendingClient(requestId);
    }
    this.#abortOwnerWorkForLeaseLoss();
    try {
      await this.#dependencies.election.stop();
      await this.#electionTask;
    } finally {
      this.#electionTask = undefined;
      this.#dependencies.transport.close();
      this.#record({ kind: 'broker_stopped' });
      this.#notify();
    }
  }

  async #rollbackStart(): Promise<void> {
    this.#started = false;
    if (this.#presenceHandle !== undefined) {
      this.#dependencies.clock.clearInterval(this.#presenceHandle);
      this.#presenceHandle = undefined;
    }
    if (this.#heartbeatHandle !== undefined) {
      this.#dependencies.clock.clearInterval(this.#heartbeatHandle);
      this.#heartbeatHandle = undefined;
    }
    this.#unsubscribeTransport?.();
    this.#unsubscribeTransport = undefined;
    this.#abortOwnerWorkForLeaseLoss();
    try {
      await this.#dependencies.election.stop();
    } catch {
      // Preserve the startup failure while still returning to a retryable state.
    }
    this.#electionTask = undefined;
    this.#leader = undefined;
    this.#runtimeMismatch = undefined;
    this.#knownPeers.clear();
    this.#machine = transitionBrokerState(this.#machine, { type: 'stop' });
    this.#notify();
  }

  #handleRawEnvelope(input: unknown): void {
    const envelope = parseProtocolEnvelope(input);
    if (envelope === undefined) {
      this.#record({ kind: 'message_rejected', reason: 'invalid-envelope' });
      return;
    }
    if (envelope.sourceId === this.tabId) {
      return;
    }

    if (
      envelope.kind !== 'leader' &&
      envelope.protocolVersion !== this.config.protocolVersion
    ) {
      this.#record({
        kind: 'message_rejected',
        reason: 'protocol-mismatch',
      });
      return;
    }
    if (
      envelope.kind !== 'leader' &&
      envelope.runtimeFingerprint !== this.config.runtimeFingerprint
    ) {
      this.#record({
        kind: 'message_rejected',
        reason: 'runtime-mismatch',
      });
      return;
    }

    this.#knownPeers.set(envelope.sourceId, this.#dependencies.clock.now());
    switch (envelope.kind) {
      case 'presence':
        if (this.#machine.role === 'leader') {
          this.#broadcastLeader();
        }
        this.#notify();
        break;
      case 'leader':
        this.#observeLeader(envelope);
        break;
      case 'request':
        this.#handleOwnerRequest(envelope);
        break;
      case 'cancel':
        this.#handleOwnerCancel(envelope);
        break;
      case 'accepted':
      case 'chunk':
      case 'terminal':
        this.#handleClientEnvelope(envelope);
        break;
    }
  }

  async #holdLeadership(lease: LeadershipLease): Promise<void> {
    if (!this.#started || lease.signal.aborted) {
      return;
    }
    try {
      this.#machine = transitionBrokerState(this.#machine, {
        epoch: lease.epoch,
        type: 'leadership-granted',
      });
      this.#leader = undefined;
      this.#runtimeMismatch = undefined;
      this.#record({ epoch: lease.epoch, kind: 'leader_acquired' });
      this.#notify({
        at: this.#dependencies.clock.now(),
        epoch: lease.epoch,
        sourceId: this.tabId,
        type: 'leader-acquired',
      });
      this.#broadcastLeader();
      await this.#dependencies.adapter.initialize?.(lease.signal);
      if (isSignalAborted(lease.signal) || !this.#isStarted()) {
        return;
      }
      this.#machine = transitionBrokerState(this.#machine, {
        type: 'adapter-ready',
      });
      this.#broadcastLeader();
      this.#dispatchAllClients();
      this.#heartbeatHandle = this.#dependencies.clock.setInterval(
        () => this.#broadcastLeader(),
        this.config.heartbeatIntervalMs,
      );
      await waitForAbort(lease.signal);
    } catch (error) {
      const safeError = asTabLoomError(error);
      this.#record({ kind: 'adapter_failed', reason: safeError.code });
    } finally {
      if (this.#heartbeatHandle !== undefined) {
        this.#dependencies.clock.clearInterval(this.#heartbeatHandle);
        this.#heartbeatHandle = undefined;
      }
      this.#abortOwnerWorkForLeaseLoss();
      await this.#dependencies.adapter.dispose?.();
      if (this.#machine.role !== 'stopped') {
        this.#machine = transitionBrokerState(this.#machine, {
          type: 'leadership-lost',
        });
        this.#notify();
      }
    }
  }

  #observeLeader(envelope: LeaderEnvelope): void {
    if (
      !isProtocolCompatible(
        [this.config.protocolVersion],
        envelope.protocolVersion,
      )
    ) {
      this.#notify({
        at: this.#dependencies.clock.now(),
        epoch: envelope.epoch,
        sourceId: envelope.sourceId,
        type: 'protocol-rejected',
      });
      this.#record({
        epoch: envelope.epoch,
        kind: 'message_rejected',
        reason: 'protocol-mismatch',
      });
      return;
    }
    if (this.#machine.role === 'leader') {
      this.#record({
        epoch: envelope.epoch,
        kind: 'message_rejected',
        reason: 'external-owner-while-leading',
      });
      return;
    }

    if (envelope.runtimeFingerprint !== this.config.runtimeFingerprint) {
      const next = transitionBrokerState(this.#machine, {
        epoch: envelope.epoch,
        leaderId: envelope.sourceId,
        readiness: envelope.readiness,
        type: 'leader-observed',
      });
      if (next === this.#machine) {
        this.#notify({
          at: this.#dependencies.clock.now(),
          epoch: envelope.epoch,
          sourceId: envelope.sourceId,
          type: 'stale-rejected',
        });
        return;
      }
      this.#machine = next;
      this.#leader = undefined;
      this.#runtimeMismatch = envelope;
      this.#record({
        epoch: envelope.epoch,
        kind: 'message_rejected',
        reason: 'runtime-mismatch',
      });
      this.#rejectPendingRuntimeMismatch();
      this.#notify({
        at: this.#dependencies.clock.now(),
        epoch: envelope.epoch,
        sourceId: envelope.sourceId,
        type: 'runtime-rejected',
      });
      return;
    }

    const previousEpoch = this.#machine.epoch;
    const previousLeaderId = this.#machine.leaderId;
    const next = transitionBrokerState(this.#machine, {
      epoch: envelope.epoch,
      leaderId: envelope.sourceId,
      readiness: envelope.readiness,
      type: 'leader-observed',
    });
    if (next === this.#machine) {
      this.#notify({
        at: this.#dependencies.clock.now(),
        epoch: envelope.epoch,
        sourceId: envelope.sourceId,
        type: 'stale-rejected',
      });
      return;
    }

    this.#machine = next;
    this.#leader = envelope;
    this.#runtimeMismatch = undefined;
    if (previousEpoch !== next.epoch || previousLeaderId !== next.leaderId) {
      this.#record({ epoch: envelope.epoch, kind: 'leader_changed' });
      this.#notify({
        at: this.#dependencies.clock.now(),
        epoch: envelope.epoch,
        sourceId: envelope.sourceId,
        type: 'leader-changed',
      });
    } else {
      this.#notify();
    }
    if (envelope.readiness === 'ready') {
      this.#dispatchAllClients();
    }
  }

  #dispatchAllClients(): void {
    for (const requestId of this.#pendingClients.keys()) {
      this.#dispatchClient(requestId);
    }
  }

  #dispatchClient(requestId: string): void {
    const pending = this.#pendingClients.get(requestId);
    if (pending === undefined || pending.session.isTerminal) {
      return;
    }
    if (this.#runtimeMismatch !== undefined) {
      this.#rejectPendingRuntimeMismatch();
      return;
    }

    const ownLeader =
      this.#machine.role === 'leader' && this.#machine.readiness === 'ready';
    const remoteLeader =
      this.#machine.role === 'peer' &&
      this.#machine.readiness === 'ready' &&
      this.#leader !== undefined;
    if (!ownLeader && !remoteLeader) {
      return;
    }

    const epoch = this.#machine.epoch;
    if (pending.dispatchedEpoch === epoch) {
      return;
    }
    const attempt = pending.session.beginAttempt(epoch);
    if (attempt === 0 || pending.session.epoch !== epoch) {
      return;
    }
    pending.dispatchedEpoch = epoch;

    const envelope: RequestEnvelope = {
      attempt,
      clientId: this.tabId,
      deadlineAt: pending.deadlineAt,
      epoch,
      kind: 'request',
      messageId: this.#dependencies.ids.next(),
      payload: pending.payload,
      protocolVersion: this.config.protocolVersion,
      runtimeFingerprint: this.config.runtimeFingerprint,
      requestId,
      sentAt: this.#dependencies.clock.now(),
      sourceId: this.tabId,
    };
    this.#notify({
      at: envelope.sentAt,
      attempt,
      epoch,
      requestId,
      sourceId: this.tabId,
      type: attempt === 1 ? 'request' : 'retry',
    });
    if (ownLeader) {
      this.#handleOwnerRequest(envelope);
    } else {
      this.#dependencies.transport.send(envelope);
    }
  }

  #cancelClient(requestId: string, reason: 'client' | 'timeout'): void {
    const pending = this.#pendingClients.get(requestId);
    if (pending === undefined || pending.session.isTerminal) {
      return;
    }
    const error =
      reason === 'timeout'
        ? new TabLoomError('TIMEOUT', 'The inference request timed out.')
        : new TabLoomError('CANCELLED', 'The inference request was cancelled.');

    if (pending.session.attempt > 0) {
      const envelope: CancelEnvelope = {
        clientId: this.tabId,
        epoch: pending.session.epoch,
        kind: 'cancel',
        messageId: this.#dependencies.ids.next(),
        protocolVersion: this.config.protocolVersion,
        runtimeFingerprint: this.config.runtimeFingerprint,
        reason,
        requestId,
        sentAt: this.#dependencies.clock.now(),
        sourceId: this.tabId,
      };
      if (this.#machine.role === 'leader') {
        this.#handleOwnerCancel(envelope);
      } else {
        this.#dependencies.transport.send(envelope);
      }
    }

    pending.session.fail(pending.session.epoch, pending.session.attempt, error);
    this.#terminalCount += 1;
    this.#deletePendingClient(requestId);
    this.#record({
      epoch: pending.session.epoch,
      kind: reason === 'timeout' ? 'request_timed_out' : 'request_cancelled',
      requestId,
    });
    this.#notify({
      at: this.#dependencies.clock.now(),
      epoch: pending.session.epoch,
      requestId,
      type: reason === 'timeout' ? 'timed-out' : 'cancelled',
    });
  }

  #handleOwnerRequest(envelope: RequestEnvelope): void {
    if (
      this.#machine.role !== 'leader' ||
      this.#machine.readiness !== 'ready' ||
      envelope.epoch !== this.#machine.epoch
    ) {
      return;
    }
    if (envelope.protocolVersion !== this.config.protocolVersion) {
      this.#sendTerminal(envelope, 'protocol_error', undefined, {
        code: 'PROTOCOL_MISMATCH',
        message: 'The request protocol is not supported by the current owner.',
      });
      return;
    }
    if (
      this.#activeOwnerWork.has(envelope.requestId) ||
      this.#ownerQueue.some(
        (candidate) => candidate.requestId === envelope.requestId,
      )
    ) {
      return;
    }

    const depth = this.#activeOwnerWork.size + this.#ownerQueue.length;
    if (depth >= this.config.queueCapacity) {
      this.#record({
        epoch: envelope.epoch,
        kind: 'admission_rejected',
        queueDepth: depth,
        requestId: envelope.requestId,
      });
      this.#sendTerminal(envelope, 'backpressure', undefined, {
        code: 'BACKPRESSURE',
        message: 'The owner queue is at capacity.',
      });
      return;
    }

    this.#ownerQueue.push(envelope);
    const accepted: AcceptedEnvelope = {
      attempt: envelope.attempt,
      clientId: envelope.clientId,
      epoch: envelope.epoch,
      kind: 'accepted',
      messageId: this.#dependencies.ids.next(),
      protocolVersion: this.config.protocolVersion,
      runtimeFingerprint: this.config.runtimeFingerprint,
      queueDepth: this.#activeOwnerWork.size + this.#ownerQueue.length,
      requestId: envelope.requestId,
      sentAt: this.#dependencies.clock.now(),
      sourceId: this.tabId,
    };
    this.#sendToClient(accepted);
    this.#record({
      epoch: envelope.epoch,
      kind: 'request_started',
      queueDepth: accepted.queueDepth,
      requestId: envelope.requestId,
    });
    this.#broadcastLeader();
    this.#pumpOwnerQueue();
  }

  #handleOwnerCancel(envelope: CancelEnvelope): void {
    if (
      this.#machine.role !== 'leader' ||
      envelope.epoch !== this.#machine.epoch
    ) {
      return;
    }
    const queueIndex = this.#ownerQueue.findIndex(
      (candidate) =>
        candidate.requestId === envelope.requestId &&
        candidate.clientId === envelope.clientId,
    );
    if (queueIndex >= 0) {
      const [queued] = this.#ownerQueue.splice(queueIndex, 1);
      if (queued !== undefined) {
        this.#sendTerminal(
          queued,
          envelope.reason === 'timeout' ? 'timed_out' : 'cancelled',
          undefined,
          envelope.reason === 'timeout'
            ? { code: 'TIMEOUT', message: 'The inference request timed out.' }
            : {
                code: 'CANCELLED',
                message: 'The inference request was cancelled.',
              },
        );
      }
      this.#broadcastLeader();
      return;
    }

    const active = this.#activeOwnerWork.get(envelope.requestId);
    if (
      active !== undefined &&
      active.envelope.clientId === envelope.clientId
    ) {
      active.cancelReason = envelope.reason;
      active.abortController.abort();
    }
  }

  #pumpOwnerQueue(): void {
    while (
      this.#machine.role === 'leader' &&
      this.#machine.readiness === 'ready' &&
      this.#activeOwnerWork.size < this.config.maxConcurrent
    ) {
      const envelope = this.#ownerQueue.shift();
      if (envelope === undefined) {
        break;
      }
      if (envelope.deadlineAt <= this.#dependencies.clock.now()) {
        this.#sendTerminal(envelope, 'timed_out', undefined, {
          code: 'TIMEOUT',
          message: 'The inference request timed out.',
        });
        continue;
      }
      this.#runOwnerWork(envelope);
    }
    this.#broadcastLeader();
  }

  #runOwnerWork(envelope: RequestEnvelope): void {
    const abortController = new AbortController();
    const remainingMs = Math.max(
      0,
      envelope.deadlineAt - this.#dependencies.clock.now(),
    );
    const timeoutHandle = this.#dependencies.clock.setTimeout(() => {
      const active = this.#activeOwnerWork.get(envelope.requestId);
      if (active !== undefined) {
        active.cancelReason = 'timeout';
        active.abortController.abort();
      }
    }, remainingMs);
    const active: OwnerWork = { abortController, envelope, timeoutHandle };
    this.#activeOwnerWork.set(envelope.requestId, active);
    this.#broadcastLeader();

    let sequence = 0;
    void this.#dependencies.adapter
      .run(envelope.payload as TRequest, {
        attempt: envelope.attempt,
        emit: (chunk) => {
          if (
            abortController.signal.aborted ||
            this.#machine.role !== 'leader' ||
            this.#machine.epoch !== envelope.epoch
          ) {
            return;
          }
          const message: ChunkEnvelope = {
            attempt: envelope.attempt,
            chunk,
            clientId: envelope.clientId,
            epoch: envelope.epoch,
            kind: 'chunk',
            messageId: this.#dependencies.ids.next(),
            protocolVersion: this.config.protocolVersion,
            runtimeFingerprint: this.config.runtimeFingerprint,
            requestId: envelope.requestId,
            sentAt: this.#dependencies.clock.now(),
            sequence,
            sourceId: this.tabId,
          };
          sequence += 1;
          this.#sendToClient(message);
          this.#record({
            epoch: envelope.epoch,
            kind: 'chunk_emitted',
            requestId: envelope.requestId,
          });
        },
        epoch: envelope.epoch,
        requestId: envelope.requestId,
        signal: abortController.signal,
      })
      .then((result) => {
        if (
          !abortController.signal.aborted &&
          this.#machine.role === 'leader' &&
          this.#machine.epoch === envelope.epoch
        ) {
          this.#sendTerminal(envelope, 'completed', result);
        }
      })
      .catch((error: unknown) => {
        if (active.cancelReason === 'lease_lost') {
          return;
        }
        if (active.cancelReason === 'client') {
          this.#sendTerminal(envelope, 'cancelled', undefined, {
            code: 'CANCELLED',
            message: 'The inference request was cancelled.',
          });
          return;
        }
        if (active.cancelReason === 'timeout') {
          this.#sendTerminal(envelope, 'timed_out', undefined, {
            code: 'TIMEOUT',
            message: 'The inference request timed out.',
          });
          return;
        }
        const safeError = asTabLoomError(error);
        this.#record({
          epoch: envelope.epoch,
          kind: 'adapter_failed',
          reason: safeError.code,
          requestId: envelope.requestId,
        });
        this.#sendTerminal(envelope, 'failed', undefined, {
          code: 'ADAPTER_FAILED',
          message: 'The inference adapter failed.',
        });
      })
      .finally(() => {
        this.#dependencies.clock.clearTimeout(timeoutHandle);
        this.#activeOwnerWork.delete(envelope.requestId);
        this.#pumpOwnerQueue();
      });
  }

  #sendTerminal(
    request: RequestEnvelope,
    status: TerminalStatus,
    result?: TResult,
    error?: {
      readonly code: Exclude<
        TabLoomErrorCode,
        | 'BROKER_STOPPED'
        | 'CAPABILITY_UNAVAILABLE'
        | 'INVALID_CONFIG'
        | 'NO_LEADER'
        | 'RUNTIME_MISMATCH'
      >;
      readonly message: string;
    },
  ): void {
    const base: TerminalEnvelope = {
      attempt: request.attempt,
      clientId: request.clientId,
      epoch: request.epoch,
      kind: 'terminal',
      messageId: this.#dependencies.ids.next(),
      protocolVersion: this.config.protocolVersion,
      runtimeFingerprint: this.config.runtimeFingerprint,
      requestId: request.requestId,
      sentAt: this.#dependencies.clock.now(),
      sourceId: this.tabId,
      status,
      ...(error === undefined ? {} : { error }),
      ...(status === 'completed' ? { result } : {}),
    };
    this.#sendToClient(base);
    if (status === 'completed') {
      this.#record({
        epoch: request.epoch,
        kind: 'request_completed',
        requestId: request.requestId,
      });
    }
  }

  #sendToClient(
    envelope: AcceptedEnvelope | ChunkEnvelope | TerminalEnvelope,
  ): void {
    if (envelope.clientId === this.tabId) {
      this.#handleClientEnvelope(envelope);
    } else {
      this.#dependencies.transport.send(envelope);
    }
  }

  #handleClientEnvelope(
    envelope: AcceptedEnvelope | ChunkEnvelope | TerminalEnvelope,
  ): void {
    const pending = this.#pendingClients.get(envelope.requestId);
    if (pending === undefined) {
      return;
    }
    if (!this.#isEnvelopeFromCurrentOwner(envelope)) {
      this.#notify({
        at: this.#dependencies.clock.now(),
        attempt: envelope.attempt,
        epoch: envelope.epoch,
        requestId: envelope.requestId,
        sourceId: envelope.sourceId,
        type: 'stale-rejected',
      });
      return;
    }

    if (envelope.kind === 'accepted') {
      this.#notify({
        at: this.#dependencies.clock.now(),
        attempt: envelope.attempt,
        epoch: envelope.epoch,
        queueDepth: envelope.queueDepth,
        requestId: envelope.requestId,
        sourceId: envelope.sourceId,
        type: 'accepted',
      });
      return;
    }
    if (envelope.kind === 'chunk') {
      if (
        pending.session.acceptChunk(
          envelope.epoch,
          envelope.attempt,
          envelope.sequence,
          envelope.chunk as TChunk,
        )
      ) {
        this.#notify({
          at: this.#dependencies.clock.now(),
          attempt: envelope.attempt,
          epoch: envelope.epoch,
          requestId: envelope.requestId,
          sourceId: envelope.sourceId,
          type: 'chunk',
        });
      }
      return;
    }

    const accepted = this.#terminalizeClient(pending, envelope);
    if (!accepted) {
      this.#notify({
        at: this.#dependencies.clock.now(),
        attempt: envelope.attempt,
        epoch: envelope.epoch,
        requestId: envelope.requestId,
        sourceId: envelope.sourceId,
        type: 'stale-rejected',
      });
      return;
    }
    this.#terminalCount += 1;
    this.#deletePendingClient(envelope.requestId);
    this.#notify({
      at: this.#dependencies.clock.now(),
      attempt: envelope.attempt,
      epoch: envelope.epoch,
      requestId: envelope.requestId,
      sourceId: envelope.sourceId,
      type: terminalEventType(envelope.status),
    });
  }

  #terminalizeClient(
    pending: PendingClient<TRequest, TChunk, TResult>,
    envelope: TerminalEnvelope,
  ): boolean {
    if (envelope.status === 'completed') {
      return pending.session.complete(
        envelope.epoch,
        envelope.attempt,
        envelope.result as TResult,
      );
    }
    const code = terminalErrorCode(envelope.status);
    return pending.session.fail(
      envelope.epoch,
      envelope.attempt,
      new TabLoomError(
        code,
        envelope.error?.message ?? terminalDefaultMessage(envelope.status),
      ),
    );
  }

  #isEnvelopeFromCurrentOwner(
    envelope: AcceptedEnvelope | ChunkEnvelope | TerminalEnvelope,
  ): boolean {
    if (envelope.epoch !== this.#machine.epoch) {
      return false;
    }
    return this.#machine.role === 'leader'
      ? envelope.sourceId === this.tabId
      : envelope.sourceId === this.#machine.leaderId;
  }

  #abortOwnerWorkForLeaseLoss(): void {
    this.#ownerQueue = [];
    for (const active of this.#activeOwnerWork.values()) {
      active.cancelReason = 'lease_lost';
      active.abortController.abort();
      this.#dependencies.clock.clearTimeout(active.timeoutHandle);
    }
    this.#activeOwnerWork.clear();
  }

  #deletePendingClient(requestId: string): void {
    const pending = this.#pendingClients.get(requestId);
    if (pending === undefined) {
      return;
    }
    this.#dependencies.clock.clearTimeout(pending.timeoutHandle);
    pending.detachSignal?.();
    this.#pendingClients.delete(requestId);
  }

  #rejectPendingRuntimeMismatch(): void {
    const mismatch = this.#runtimeMismatch;
    if (mismatch === undefined) {
      return;
    }
    const error = new TabLoomError(
      'RUNTIME_MISMATCH',
      'The observed owner has a different runtime fingerprint.',
    );
    for (const requestId of [...this.#pendingClients.keys()]) {
      const pending = this.#pendingClients.get(requestId);
      if (pending === undefined || pending.session.isTerminal) {
        continue;
      }
      pending.session.stop(error);
      this.#terminalCount += 1;
      this.#deletePendingClient(requestId);
      this.#notify({
        at: this.#dependencies.clock.now(),
        epoch: mismatch.epoch,
        requestId,
        sourceId: mismatch.sourceId,
        type: 'runtime-rejected',
      });
    }
  }

  #sendPresence(): void {
    if (!this.#started) {
      return;
    }
    this.#dependencies.transport.send({
      kind: 'presence',
      messageId: this.#dependencies.ids.next(),
      protocolVersion: this.config.protocolVersion,
      runtimeFingerprint: this.config.runtimeFingerprint,
      sentAt: this.#dependencies.clock.now(),
      sourceId: this.tabId,
      supportedVersions: [this.config.protocolVersion],
    });
  }

  #broadcastLeader(): void {
    if (this.#machine.role !== 'leader') {
      return;
    }
    this.#dependencies.transport.send({
      adapter: this.#dependencies.adapter.descriptor,
      capacity: this.config.queueCapacity,
      epoch: this.#machine.epoch,
      kind: 'leader',
      messageId: this.#dependencies.ids.next(),
      protocolVersion: this.config.protocolVersion,
      runtimeFingerprint: this.config.runtimeFingerprint,
      queueDepth: this.#ownerQueue.length + this.#activeOwnerWork.size,
      readiness: this.#machine.readiness === 'ready' ? 'ready' : 'initializing',
      sentAt: this.#dependencies.clock.now(),
      sourceId: this.tabId,
    });
    this.#notify();
  }

  #notify(event?: BrokerEvent): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) {
      listener(snapshot, event);
    }
  }

  #record(event: Omit<SafeTelemetryEvent, 'at' | 'tabId'>): void {
    this.#dependencies.telemetry.record({
      ...event,
      at: this.#dependencies.clock.now(),
      tabId: this.tabId,
    });
  }

  #isStarted(): boolean {
    return this.#started;
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function terminalErrorCode(status: TerminalStatus): TabLoomErrorCode {
  switch (status) {
    case 'backpressure':
      return 'BACKPRESSURE';
    case 'cancelled':
      return 'CANCELLED';
    case 'protocol_error':
      return 'PROTOCOL_MISMATCH';
    case 'timed_out':
      return 'TIMEOUT';
    case 'failed':
    case 'completed':
      return 'ADAPTER_FAILED';
  }
}

function terminalDefaultMessage(status: TerminalStatus): string {
  switch (status) {
    case 'backpressure':
      return 'The owner queue is at capacity.';
    case 'cancelled':
      return 'The inference request was cancelled.';
    case 'protocol_error':
      return 'The request protocol is not supported.';
    case 'timed_out':
      return 'The inference request timed out.';
    case 'failed':
    case 'completed':
      return 'The inference adapter failed.';
  }
}

function terminalEventType(status: TerminalStatus): BrokerEvent['type'] {
  switch (status) {
    case 'backpressure':
      return 'backpressure';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return 'completed';
    case 'protocol_error':
      return 'protocol-rejected';
    case 'timed_out':
      return 'timed-out';
    case 'failed':
      return 'failed';
  }
}

function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
