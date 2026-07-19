import { CryptoIdProvider, SystemClock } from '../../adapters/runtime.js';
import { TabLoomError } from '../../core/errors.js';
import { parseRuntimeFingerprint } from '../../core/runtime-fingerprint.js';
import type { ClockPort, IdPort, TransportPort } from '../../core/types.js';
import { TABLOOM_PROTOCOL_VERSION } from '../../core/version.js';
import type { ProtocolEnvelope } from '../../core/protocol.js';
import {
  parseSharedWorkerControlMessage,
  type SharedWorkerControlMessage,
  type SharedWorkerFatal,
  type SharedWorkerHello,
} from './control-protocol.js';
import type { MessagePortLike } from './message-port.js';

type HostClientState = 'waiting' | 'preparing' | 'prepared' | 'ready';
export type SharedWorkerConnectionChange = 'attached' | 'closed' | 'stale';

interface HostClient {
  readonly onMessage: (event: MessageEvent<unknown>) => void;
  readonly onMessageError: (event: MessageEvent<unknown>) => void;
  readonly port: MessagePortLike;
  lastSeenAt: number;
  livenessNonce?: string;
  nonce?: string;
  state: HostClientState;
  timeoutHandle: unknown;
}

export interface SharedWorkerHostTransportOptions {
  readonly capabilityProbe?: (
    requiredCapabilities: readonly string[],
  ) => boolean | Promise<boolean>;
  readonly clock?: ClockPort;
  readonly handshakeTimeoutMs?: number;
  readonly ids?: IdPort;
  readonly livenessIntervalMs?: number;
  readonly livenessTimeoutMs?: number;
  readonly namespace: string;
  readonly onConnectionCountChanged?: (
    count: number,
    reason: SharedWorkerConnectionChange,
  ) => void;
  readonly prepareHost: () => Promise<void>;
  readonly runtimeFingerprint: string;
}

export class SharedWorkerHostTransport implements TransportPort {
  readonly hostId: string;
  #capabilityProbe: NonNullable<
    SharedWorkerHostTransportOptions['capabilityProbe']
  >;
  #clients = new Set<HostClient>();
  #clock: ClockPort;
  #closed = false;
  #handshakeTimeoutMs: number;
  #ids: IdPort;
  #livenessHandle: unknown;
  #livenessIntervalMs: number;
  #livenessTimeoutMs: number;
  #listeners = new Set<(envelope: unknown) => void>();
  #namespace: string;
  #onConnectionCountChanged:
    SharedWorkerHostTransportOptions['onConnectionCountChanged'] | undefined;
  #prepareHost: () => Promise<void>;
  #prepareTask: Promise<void> | undefined;
  #runtimeFingerprint: string;

  constructor(options: SharedWorkerHostTransportOptions) {
    const livenessIntervalMs = options.livenessIntervalMs ?? 5_000;
    const livenessTimeoutMs = options.livenessTimeoutMs ?? 15_000;
    if (
      !/^[a-zA-Z0-9._-]{1,80}$/.test(options.namespace) ||
      !Number.isInteger(options.handshakeTimeoutMs ?? 5_000) ||
      (options.handshakeTimeoutMs ?? 5_000) < 100 ||
      (options.handshakeTimeoutMs ?? 5_000) > 180_000 ||
      !Number.isInteger(livenessIntervalMs) ||
      livenessIntervalMs < 100 ||
      livenessIntervalMs > 60_000 ||
      !Number.isInteger(livenessTimeoutMs) ||
      livenessTimeoutMs < livenessIntervalMs * 2 ||
      livenessTimeoutMs > 300_000
    ) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'SharedWorker host configuration is invalid.',
      );
    }
    this.#capabilityProbe = options.capabilityProbe ?? (() => true);
    this.#clock = options.clock ?? new SystemClock();
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
    this.#ids = options.ids ?? new CryptoIdProvider();
    this.hostId = this.#ids.next();
    this.#livenessIntervalMs = livenessIntervalMs;
    this.#livenessTimeoutMs = livenessTimeoutMs;
    this.#namespace = options.namespace;
    this.#onConnectionCountChanged = options.onConnectionCountChanged;
    this.#prepareHost = options.prepareHost;
    this.#runtimeFingerprint = parseRuntimeFingerprint(
      options.runtimeFingerprint,
    );
    this.#livenessHandle = this.#clock.setInterval(
      () => this.#sweepLiveness(),
      this.#livenessIntervalMs,
    );
  }

  get clientCount(): number {
    let count = 0;
    for (const client of this.#clients) {
      count += client.state === 'ready' ? 1 : 0;
    }
    return count;
  }

  get connectionCount(): number {
    return this.#clients.size;
  }

  attach(port: MessagePortLike): void {
    if (this.#closed) {
      port.close();
      return;
    }
    const client: HostClient = {
      lastSeenAt: this.#clock.now(),
      onMessage: (event) => {
        void this.#handleMessage(client, event.data);
      },
      onMessageError: () => {
        this.#fatal(
          client,
          'TRANSPORT_FAILED',
          'SharedWorker message deserialization failed.',
        );
      },
      port,
      state: 'waiting',
      timeoutHandle: this.#clock.setTimeout(
        () => this.#remove(client),
        this.#handshakeTimeoutMs,
      ),
    };
    this.#clients.add(client);
    this.#onConnectionCountChanged?.(this.connectionCount, 'attached');
    port.addEventListener('message', client.onMessage);
    port.addEventListener('messageerror', client.onMessageError);
    port.start();
    this.#post(client, {
      hostId: this.hostId,
      kind: 'challenge',
      namespace: this.#namespace,
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: this.#runtimeFingerprint,
    });
  }

  send(envelope: ProtocolEnvelope): void {
    if (this.#closed) {
      return;
    }
    this.#broadcast({ envelope, kind: 'protocol' });
  }

  subscribe(listener: (envelope: unknown) => void): () => void {
    if (this.#closed) {
      throw new TabLoomError(
        'TRANSPORT_FAILED',
        'The SharedWorker host transport is closed.',
      );
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#clock.clearInterval(this.#livenessHandle);
    for (const client of [...this.#clients]) {
      this.#remove(client);
    }
    this.#listeners.clear();
  }

  fatalAll(code: SharedWorkerFatal['code'], message: string): void {
    for (const client of [...this.#clients]) {
      this.#fatal(client, code, message);
    }
  }

  async #handleMessage(client: HostClient, input: unknown): Promise<void> {
    if (!this.#clients.has(client)) {
      return;
    }
    const message = parseSharedWorkerControlMessage(input);
    if (message === undefined) {
      return;
    }
    switch (message.kind) {
      case 'hello':
        client.lastSeenAt = this.#clock.now();
        await this.#handleHello(client, message);
        break;
      case 'commit':
        client.lastSeenAt = this.#clock.now();
        await this.#handleCommit(client, message.nonce);
        break;
      case 'protocol':
        if (
          client.state === 'ready' &&
          message.envelope.runtimeFingerprint === this.#runtimeFingerprint
        ) {
          client.lastSeenAt = this.#clock.now();
          this.#broadcast(message);
          for (const listener of this.#listeners) {
            listener(message.envelope);
          }
        }
        break;
      case 'abort':
      case 'disconnect':
        if (client.nonce === message.nonce) {
          this.#remove(client);
        }
        break;
      case 'pong':
        if (
          client.state === 'ready' &&
          message.hostId === this.hostId &&
          client.livenessNonce === message.nonce
        ) {
          client.lastSeenAt = this.#clock.now();
          delete client.livenessNonce;
        }
        break;
      case 'challenge':
      case 'fatal':
      case 'ping':
      case 'prepared':
      case 'ready':
        break;
    }
  }

  async #handleHello(
    client: HostClient,
    message: SharedWorkerHello,
  ): Promise<void> {
    if (client.state !== 'waiting') {
      return;
    }
    client.nonce = message.nonce;
    if (message.protocolVersion !== TABLOOM_PROTOCOL_VERSION) {
      this.#fatal(
        client,
        'PROTOCOL_MISMATCH',
        'The SharedWorker protocol version is incompatible.',
      );
      return;
    }
    if (message.runtimeFingerprint !== this.#runtimeFingerprint) {
      this.#fatal(
        client,
        'RUNTIME_MISMATCH',
        'The SharedWorker runtime fingerprint is incompatible.',
      );
      return;
    }
    if (message.namespace !== this.#namespace) {
      this.#fatal(
        client,
        'TOPOLOGY_UNAVAILABLE',
        'The SharedWorker namespace is incompatible.',
      );
      return;
    }
    client.state = 'preparing';
    let capable: boolean;
    try {
      capable = await this.#capabilityProbe(message.requiredCapabilities);
    } catch {
      capable = false;
    }
    if (!this.#clients.has(client)) {
      return;
    }
    if (!capable) {
      this.#fatal(
        client,
        'TOPOLOGY_UNAVAILABLE',
        'The SharedWorker does not provide the required capabilities.',
      );
      return;
    }
    client.state = 'prepared';
    this.#post(client, {
      hostId: this.hostId,
      kind: 'prepared',
      namespace: this.#namespace,
      nonce: message.nonce,
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: this.#runtimeFingerprint,
    });
  }

  async #handleCommit(client: HostClient, nonce: string): Promise<void> {
    if (client.state !== 'prepared' || client.nonce !== nonce) {
      return;
    }
    const prepareTask = this.#prepareTask ?? this.#prepareHost();
    this.#prepareTask = prepareTask;
    try {
      await prepareTask;
    } catch {
      if (this.#prepareTask === prepareTask) {
        this.#prepareTask = undefined;
      }
      this.#fatal(
        client,
        'TOPOLOGY_UNAVAILABLE',
        'The SharedWorker host could not start.',
      );
      return;
    }
    if (!this.#clients.has(client)) {
      return;
    }
    client.state = 'ready';
    client.lastSeenAt = this.#clock.now();
    this.#clock.clearTimeout(client.timeoutHandle);
    this.#post(client, {
      hostId: this.hostId,
      kind: 'ready',
      nonce,
      topology: 'shared-worker',
    });
  }

  #broadcast(message: SharedWorkerControlMessage): void {
    for (const client of [...this.#clients]) {
      if (client.state === 'ready') {
        this.#post(client, message);
      }
    }
  }

  #post(client: HostClient, message: SharedWorkerControlMessage): void {
    try {
      client.port.postMessage(message);
    } catch {
      this.#remove(client);
    }
  }

  #fatal(
    client: HostClient,
    code: SharedWorkerFatal['code'],
    message: string,
  ): void {
    const nonce = client.nonce;
    if (nonce !== undefined) {
      this.#post(client, { code, kind: 'fatal', message, nonce });
    }
    this.#remove(client);
  }

  #sweepLiveness(): void {
    if (this.#closed) {
      return;
    }
    const now = this.#clock.now();
    for (const client of [...this.#clients]) {
      if (client.state !== 'ready') {
        continue;
      }
      if (now - client.lastSeenAt >= this.#livenessTimeoutMs) {
        this.#remove(client, 'stale');
        continue;
      }
      const nonce = this.#ids.next();
      client.livenessNonce = nonce;
      this.#post(client, {
        hostId: this.hostId,
        kind: 'ping',
        nonce,
      });
    }
  }

  #remove(
    client: HostClient,
    reason: SharedWorkerConnectionChange = 'closed',
  ): void {
    if (!this.#clients.delete(client)) {
      return;
    }
    this.#clock.clearTimeout(client.timeoutHandle);
    client.port.removeEventListener('message', client.onMessage);
    client.port.removeEventListener('messageerror', client.onMessageError);
    client.port.close();
    this.#onConnectionCountChanged?.(this.connectionCount, reason);
  }
}
