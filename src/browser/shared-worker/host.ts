import { NoopTelemetry, SystemClock } from '../../adapters/runtime.js';
import { BrowserBroadcastTransport } from '../broadcast-channel-transport.js';
import { IndexedDbEpochStore } from '../indexeddb-epoch-store.js';
import { BrowserWebLockElection } from '../web-lock-election.js';
import { TabLoomBroker } from '../../core/broker.js';
import {
  parseBrokerConfig,
  type BrokerConfigInput,
} from '../../core/config.js';
import { TabLoomError } from '../../core/errors.js';
import type {
  ClockPort,
  InferenceAdapter,
  TelemetryPort,
} from '../../core/types.js';
import { CryptoIdProvider } from '../../adapters/runtime.js';
import { SharedWorkerBridgeTransport } from './bridge-transport.js';
import { SharedWorkerHostTransport } from './host-transport.js';
import type { MessagePortLike } from './message-port.js';

export interface SharedWorkerConnectEventLike {
  readonly ports: readonly MessagePortLike[];
}

export interface SharedWorkerScopeLike {
  addEventListener(
    type: 'connect',
    listener: (event: SharedWorkerConnectEventLike) => void,
  ): void;
  close?(): void;
  removeEventListener(
    type: 'connect',
    listener: (event: SharedWorkerConnectEventLike) => void,
  ): void;
}

export interface SharedWorkerBrokerHostOptions<TRequest, TChunk, TResult> {
  readonly adapter: InferenceAdapter<TRequest, TChunk, TResult>;
  readonly capabilityProbe?: (
    requiredCapabilities: readonly string[],
  ) => boolean | Promise<boolean>;
  readonly clock?: ClockPort;
  readonly clientLivenessIntervalMs?: number;
  readonly clientLivenessTimeoutMs?: number;
  readonly config: BrokerConfigInput;
  readonly handshakeTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly scope: SharedWorkerScopeLike;
  readonly telemetry?: TelemetryPort;
}

export interface SharedWorkerBrokerHost<TRequest, TChunk, TResult> {
  readonly broker: TabLoomBroker<TRequest, TChunk, TResult>;
  readonly clientCount: number;
  stop(): Promise<void>;
}

export function createSharedWorkerBrokerHost<TRequest, TChunk, TResult>(
  options: SharedWorkerBrokerHostOptions<TRequest, TChunk, TResult>,
): SharedWorkerBrokerHost<TRequest, TChunk, TResult> {
  const config = parseBrokerConfig(options.config);
  const clock = options.clock ?? new SystemClock();
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
  if (
    !Number.isInteger(idleTimeoutMs) ||
    idleTimeoutMs < 0 ||
    idleTimeoutMs > 600_000
  ) {
    throw new TabLoomError(
      'INVALID_CONFIG',
      'SharedWorker idle timeout is invalid.',
    );
  }

  const ids = new CryptoIdProvider();
  let brokerStarted = false;
  let stopped = false;
  let idleHandle: unknown;
  let unsubscribeBroker: (() => void) | undefined;

  const clearIdle = () => {
    if (idleHandle !== undefined) {
      clock.clearTimeout(idleHandle);
      idleHandle = undefined;
    }
  };

  const scheduleIdleIfUnused = () => {
    clearIdle();
    if (hub.connectionCount === 0 && !stopped) {
      idleHandle = clock.setTimeout(() => {
        void controller.stop().finally(() => options.scope.close?.());
      }, idleTimeoutMs);
    }
  };

  const stopOrphanedHost = () => {
    if (!stopped && brokerStarted) {
      queueMicrotask(() => {
        void controller.stop().finally(() => options.scope.close?.());
      });
    }
  };

  const hub = new SharedWorkerHostTransport({
    capabilityProbe: options.capabilityProbe ?? probeSharedWorkerCapabilities,
    clock,
    ...(options.handshakeTimeoutMs === undefined
      ? {}
      : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    ids,
    ...(options.clientLivenessIntervalMs === undefined
      ? {}
      : { livenessIntervalMs: options.clientLivenessIntervalMs }),
    ...(options.clientLivenessTimeoutMs === undefined
      ? {}
      : { livenessTimeoutMs: options.clientLivenessTimeoutMs }),
    namespace: config.namespace,
    onConnectionCountChanged: (count, reason) => {
      if (count === 0 && reason === 'stale') {
        clearIdle();
        stopOrphanedHost();
        return;
      }
      scheduleIdleIfUnused();
    },
    prepareHost: async () => {
      if (!brokerStarted) {
        await broker.start();
        brokerStarted = true;
        unsubscribeBroker = broker.subscribe((snapshot, event) => {
          if (
            (event?.type === 'broker-failed' || snapshot.role === 'stopped') &&
            !stopped
          ) {
            hub.fatalAll(
              'TRANSPORT_FAILED',
              'The SharedWorker broker stopped unexpectedly.',
            );
            queueMicrotask(() => {
              void controller.stop().finally(() => options.scope.close?.());
            });
          }
        });
        scheduleIdleIfUnused();
      }
    },
    runtimeFingerprint: config.runtimeFingerprint,
  });
  const bridge = new SharedWorkerBridgeTransport(
    hub,
    new BrowserBroadcastTransport(config.namespace),
  );
  const broker = new TabLoomBroker(config, {
    adapter: options.adapter,
    clock,
    election: new BrowserWebLockElection(
      config.namespace,
      new IndexedDbEpochStore(config.namespace, config.runtimeFingerprint),
    ),
    ids,
    telemetry: options.telemetry ?? new NoopTelemetry(),
    transport: bridge,
  });

  const onConnect = (event: SharedWorkerConnectEventLike) => {
    const port = event.ports[0];
    if (port !== undefined) {
      hub.attach(port);
    }
  };
  options.scope.addEventListener('connect', onConnect);

  const controller: SharedWorkerBrokerHost<TRequest, TChunk, TResult> = {
    broker,
    get clientCount() {
      return hub.clientCount;
    },
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearIdle();
      unsubscribeBroker?.();
      unsubscribeBroker = undefined;
      options.scope.removeEventListener('connect', onConnect);
      try {
        if (brokerStarted) {
          await broker.stop();
        }
      } finally {
        bridge.close();
      }
    },
  };
  return controller;
}

export function probeSharedWorkerCapabilities(
  requiredCapabilities: readonly string[],
): boolean {
  const navigatorValue = Reflect.get(globalThis, 'navigator') as
    Navigator | undefined;
  return requiredCapabilities.every(
    (capability) =>
      capability === 'webgpu' &&
      navigatorValue !== undefined &&
      Reflect.has(navigatorValue, 'gpu'),
  );
}
