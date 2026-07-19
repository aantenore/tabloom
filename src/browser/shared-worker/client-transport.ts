import { CryptoIdProvider, SystemClock } from '../../adapters/runtime.js';
import { TabLoomError } from '../../core/errors.js';
import { parseRuntimeFingerprint } from '../../core/runtime-fingerprint.js';
import type { ClockPort, IdPort, TransportPort } from '../../core/types.js';
import { TABLOOM_PROTOCOL_VERSION } from '../../core/version.js';
import type { ProtocolEnvelope } from '../../core/protocol.js';
import {
  parseSharedWorkerControlMessage,
  type SharedWorkerControlMessage,
} from './control-protocol.js';
import type { MessagePortLike } from './message-port.js';

type ClientState = 'connecting' | 'committed' | 'ready' | 'closed';
const MAX_RECONNECT_QUEUE = 128;

interface Deferred<T> {
  readonly promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

export interface SharedWorkerClientTransportOptions {
  readonly clock?: ClockPort;
  readonly handshakeTimeoutMs?: number;
  readonly ids?: IdPort;
  readonly namespace: string;
  readonly port: MessagePortLike;
  readonly requiredCapabilities?: readonly string[];
  readonly runtimeFingerprint: string;
}

export class SharedWorkerClientTransport implements TransportPort {
  readonly hostId: Promise<string>;
  #clock: ClockPort;
  #connectDeferred = createDeferred<string>();
  #connectStarted = false;
  #connectedOnce = false;
  #currentHostId: string | undefined;
  #handshakeTimeoutMs: number;
  #ids: IdPort;
  #failure: TabLoomError | undefined;
  #failureListeners = new Set<(error: unknown) => void>();
  #listeners = new Set<(envelope: unknown) => void>();
  #namespace: string;
  #nonce: string;
  #port: MessagePortLike;
  #requiredCapabilities: readonly string[];
  #reconnectHostId: string | undefined;
  #reconnectQueue: ProtocolEnvelope[] = [];
  #runtimeFingerprint: string;
  #state: ClientState = 'connecting';
  #timeoutHandle: unknown;

  constructor(options: SharedWorkerClientTransportOptions) {
    const requiredCapabilities = options.requiredCapabilities ?? [];
    if (
      !/^[a-zA-Z0-9._-]{1,80}$/.test(options.namespace) ||
      !Number.isInteger(options.handshakeTimeoutMs ?? 5_000) ||
      (options.handshakeTimeoutMs ?? 5_000) < 100 ||
      (options.handshakeTimeoutMs ?? 5_000) > 180_000 ||
      requiredCapabilities.length > 16 ||
      requiredCapabilities.some(
        (capability) =>
          typeof capability !== 'string' ||
          capability.length === 0 ||
          capability.length > 80,
      )
    ) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'SharedWorker client configuration is invalid.',
      );
    }
    this.#clock = options.clock ?? new SystemClock();
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
    this.#ids = options.ids ?? new CryptoIdProvider();
    this.#namespace = options.namespace;
    this.#nonce = this.#ids.next();
    this.#port = options.port;
    this.#requiredCapabilities = [...new Set(requiredCapabilities)].sort(
      compareCodeUnits,
    );
    this.#runtimeFingerprint = parseRuntimeFingerprint(
      options.runtimeFingerprint,
    );
    this.hostId = this.#connectDeferred.promise;
  }

  connect(): Promise<string> {
    if (this.#state === 'closed') {
      return Promise.reject(
        this.#failure ??
          new TabLoomError(
            'TRANSPORT_FAILED',
            'The SharedWorker connection is closed.',
          ),
      );
    }
    if (this.#connectStarted) {
      return this.hostId;
    }
    this.#connectStarted = true;
    this.#port.addEventListener('message', this.#onMessage);
    this.#port.addEventListener('messageerror', this.#onMessageError);
    this.#port.start();
    this.#armHandshakeTimeout();
    this.#sendHello();
    return this.hostId;
  }

  send(envelope: ProtocolEnvelope): void {
    if (this.#state === 'ready') {
      this.#post({ envelope, kind: 'protocol' });
      return;
    }
    if (
      this.#connectedOnce &&
      (this.#state === 'connecting' || this.#state === 'committed')
    ) {
      if (envelope.kind === 'presence') {
        const presenceIndex = this.#reconnectQueue.findIndex(
          (candidate) => candidate.kind === 'presence',
        );
        if (presenceIndex >= 0) {
          this.#reconnectQueue[presenceIndex] = envelope;
          return;
        }
      }
      if (this.#reconnectQueue.length < MAX_RECONNECT_QUEUE) {
        this.#reconnectQueue.push(envelope);
        return;
      }
      this.#failConnection(
        'TRANSPORT_FAILED',
        'The SharedWorker reconnect queue is full.',
      );
    }
    throw new TabLoomError(
      'TRANSPORT_FAILED',
      'The SharedWorker transport is not ready.',
    );
  }

  #armHandshakeTimeout(): void {
    this.#clearTimeout();
    this.#timeoutHandle = this.#clock.setTimeout(() => {
      const committed = this.#state === 'committed';
      if (committed) {
        this.#bestEffortAbort('timeout');
      }
      this.#failConnection(
        committed ? 'START_FAILED' : 'TOPOLOGY_UNAVAILABLE',
        committed
          ? 'The SharedWorker startup outcome is unknown after commit.'
          : 'SharedWorker handshake timed out.',
      );
    }, this.#handshakeTimeoutMs);
  }

  #sendHello(): void {
    this.#post({
      kind: 'hello',
      namespace: this.#namespace,
      nonce: this.#nonce,
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      requiredCapabilities: [...this.#requiredCapabilities],
      runtimeFingerprint: this.#runtimeFingerprint,
    });
  }

  subscribe(listener: (envelope: unknown) => void): () => void {
    if (this.#state === 'closed') {
      throw new TabLoomError(
        'TRANSPORT_FAILED',
        'The SharedWorker transport is closed.',
      );
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeFailures(listener: (error: unknown) => void): () => void {
    if (this.#failure !== undefined) {
      throw this.#failure;
    }
    this.#failureListeners.add(listener);
    return () => this.#failureListeners.delete(listener);
  }

  close(): void {
    if (this.#state === 'closed') {
      return;
    }
    if (this.#state === 'ready') {
      this.#post({ kind: 'disconnect', nonce: this.#nonce });
    } else {
      this.#bestEffortAbort('client');
      this.#connectDeferred.reject(
        new TabLoomError(
          'TRANSPORT_FAILED',
          'The SharedWorker connection closed before it was ready.',
        ),
      );
    }
    this.#state = 'closed';
    this.#clearTimeout();
    this.#failureListeners.clear();
    this.#listeners.clear();
    this.#port.removeEventListener('message', this.#onMessage);
    this.#port.removeEventListener('messageerror', this.#onMessageError);
    this.#port.close();
  }

  #onMessage = (event: MessageEvent<unknown>): void => {
    const message = parseSharedWorkerControlMessage(event.data);
    if (message === undefined) {
      return;
    }
    switch (message.kind) {
      case 'prepared':
        this.#handlePrepared(message);
        break;
      case 'ready':
        if (this.#state === 'committed' && message.nonce === this.#nonce) {
          if (
            this.#reconnectHostId !== undefined &&
            message.hostId !== this.#reconnectHostId
          ) {
            this.#failConnection(
              'TRANSPORT_FAILED',
              'A different SharedWorker answered the reconnect handshake.',
            );
            break;
          }
          this.#state = 'ready';
          this.#clearTimeout();
          this.#currentHostId = message.hostId;
          this.#reconnectHostId = undefined;
          if (!this.#connectedOnce) {
            this.#connectedOnce = true;
            this.#connectDeferred.resolve(message.hostId);
          }
          this.#flushReconnectQueue();
        }
        break;
      case 'challenge':
        this.#handleChallenge(message);
        break;
      case 'ping':
        if (message.hostId !== (this.#reconnectHostId ?? this.#currentHostId)) {
          break;
        }
        try {
          this.#port.postMessage({
            hostId: message.hostId,
            kind: 'pong',
            nonce: message.nonce,
          } satisfies SharedWorkerControlMessage);
        } catch {
          this.#failConnection(
            'TRANSPORT_FAILED',
            'SharedWorker liveness acknowledgement failed.',
          );
        }
        break;
      case 'fatal':
        if (message.nonce === this.#nonce) {
          this.#failConnection(
            this.#state === 'committed' &&
              (message.code === 'TOPOLOGY_UNAVAILABLE' ||
                message.code === 'TRANSPORT_FAILED')
              ? 'START_FAILED'
              : message.code,
            message.message,
          );
        }
        break;
      case 'protocol':
        if (this.#state === 'ready') {
          for (const listener of this.#listeners) {
            listener(message.envelope);
          }
        }
        break;
      case 'abort':
      case 'commit':
      case 'disconnect':
      case 'hello':
      case 'pong':
        break;
    }
  };

  #onMessageError = (): void => {
    this.#failConnection(
      this.#state === 'committed' ? 'START_FAILED' : 'TRANSPORT_FAILED',
      'SharedWorker message deserialization failed.',
    );
  };

  #handlePrepared(
    message: Extract<SharedWorkerControlMessage, { readonly kind: 'prepared' }>,
  ): void {
    if (this.#state !== 'connecting' || message.nonce !== this.#nonce) {
      return;
    }
    if (
      this.#reconnectHostId !== undefined &&
      message.hostId !== this.#reconnectHostId
    ) {
      this.#failConnection(
        'TRANSPORT_FAILED',
        'A different SharedWorker prepared the reconnect handshake.',
      );
      return;
    }
    if (message.protocolVersion !== TABLOOM_PROTOCOL_VERSION) {
      this.#failConnection(
        'PROTOCOL_MISMATCH',
        'The SharedWorker protocol version is incompatible.',
      );
      return;
    }
    if (message.runtimeFingerprint !== this.#runtimeFingerprint) {
      this.#failConnection(
        'RUNTIME_MISMATCH',
        'The SharedWorker runtime fingerprint is incompatible.',
      );
      return;
    }
    if (message.namespace !== this.#namespace) {
      this.#failConnection(
        'TOPOLOGY_UNAVAILABLE',
        'The SharedWorker namespace is incompatible.',
      );
      return;
    }
    this.#state = 'committed';
    this.#post({ kind: 'commit', nonce: this.#nonce });
  }

  #handleChallenge(
    message: Extract<
      SharedWorkerControlMessage,
      { readonly kind: 'challenge' }
    >,
  ): void {
    if (message.protocolVersion !== TABLOOM_PROTOCOL_VERSION) {
      this.#failConnection(
        'PROTOCOL_MISMATCH',
        'The replacement SharedWorker protocol version is incompatible.',
      );
      return;
    }
    if (message.runtimeFingerprint !== this.#runtimeFingerprint) {
      this.#failConnection(
        'RUNTIME_MISMATCH',
        'The replacement SharedWorker runtime fingerprint is incompatible.',
      );
      return;
    }
    if (message.namespace !== this.#namespace) {
      this.#failConnection(
        'TOPOLOGY_UNAVAILABLE',
        'The replacement SharedWorker namespace is incompatible.',
      );
      return;
    }
    if (!this.#connectedOnce || message.hostId === this.#currentHostId) {
      return;
    }
    if (this.#state !== 'ready') {
      if (message.hostId !== this.#reconnectHostId) {
        this.#failConnection(
          'TRANSPORT_FAILED',
          'Multiple SharedWorkers attempted to reconnect the same client.',
        );
      }
      return;
    }
    this.#state = 'connecting';
    this.#reconnectHostId = message.hostId;
    this.#nonce = this.#ids.next();
    this.#armHandshakeTimeout();
    this.#sendHello();
  }

  #flushReconnectQueue(): void {
    const queued = this.#reconnectQueue.splice(0);
    for (const envelope of queued) {
      if (this.#state !== 'ready') {
        return;
      }
      try {
        this.#post({ envelope, kind: 'protocol' });
      } catch {
        return;
      }
    }
  }

  #failConnection(
    code:
      | 'PROTOCOL_MISMATCH'
      | 'RUNTIME_MISMATCH'
      | 'START_FAILED'
      | 'TOPOLOGY_UNAVAILABLE'
      | 'TRANSPORT_FAILED',
    message: string,
  ): TabLoomError {
    if (this.#state === 'closed') {
      return this.#failure ?? new TabLoomError('TRANSPORT_FAILED', message);
    }
    const failure = new TabLoomError(code, message);
    const wasConnected = this.#connectedOnce;
    if (!wasConnected) {
      this.#connectDeferred.reject(failure);
    }
    this.#failure = failure;
    this.#state = 'closed';
    this.#clearTimeout();
    this.#reconnectQueue = [];
    this.#listeners.clear();
    this.#port.removeEventListener('message', this.#onMessage);
    this.#port.removeEventListener('messageerror', this.#onMessageError);
    this.#port.close();
    if (wasConnected) {
      for (const listener of this.#failureListeners) {
        listener(failure);
      }
    }
    this.#failureListeners.clear();
    return failure;
  }

  #post(message: SharedWorkerControlMessage): void {
    const wasReady = this.#state === 'ready';
    try {
      this.#port.postMessage(message);
    } catch (error) {
      const failure = this.#failConnection(
        'TRANSPORT_FAILED',
        'SharedWorker message delivery failed.',
      );
      if (wasReady) {
        throw new TabLoomError(
          failure.code,
          failure.message,
          {},
          {
            cause: error,
          },
        );
      }
    }
  }

  #bestEffortAbort(reason: 'client' | 'timeout'): void {
    if (!this.#connectStarted || this.#state === 'ready') {
      return;
    }
    try {
      this.#port.postMessage({
        kind: 'abort',
        nonce: this.#nonce,
        reason,
      } satisfies SharedWorkerControlMessage);
    } catch {
      // The connection is already unusable; local close still fails closed.
    }
  }

  #clearTimeout(): void {
    if (this.#timeoutHandle !== undefined) {
      this.#clock.clearTimeout(this.#timeoutHandle);
      this.#timeoutHandle = undefined;
    }
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
