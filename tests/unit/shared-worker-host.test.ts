import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeterministicInferenceAdapter } from '../../src/adapters/deterministic.js';
import { SharedWorkerClientTransport } from '../../src/browser/shared-worker/client-transport.js';
import {
  parseSharedWorkerControlMessage,
  type SharedWorkerControlMessage,
} from '../../src/browser/shared-worker/control-protocol.js';
import { SharedWorkerHostTransport } from '../../src/browser/shared-worker/host-transport.js';
import {
  createSharedWorkerBrokerHost,
  probeSharedWorkerCapabilities,
  type SharedWorkerConnectEventLike,
} from '../../src/browser/shared-worker/host.js';
import { MemoryMessagePort } from '../fakes/message-port.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';
import { TABLOOM_PROTOCOL_VERSION } from '../../src/core/version.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SharedWorker broker host', () => {
  it('hosts one broker for committed clients and shuts down when idle', async () => {
    stubWebLocks();
    const scope = new MemorySharedWorkerScope();
    const namespace = `host-${crypto.randomUUID()}`;
    const host = createSharedWorkerBrokerHost({
      adapter: new DeterministicInferenceAdapter({ defaultChunkDelayMs: 0 }),
      capabilityProbe: () => true,
      config: {
        heartbeatIntervalMs: 50,
        leaderTimeoutMs: 150,
        namespace,
        requestTimeoutMs: 1_000,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      },
      idleTimeoutMs: 0,
      scope,
    });
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    scope.connect(hostPort);
    const client = new SharedWorkerClientTransport({
      handshakeTimeoutMs: 1_000,
      namespace,
      port: clientPort,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });

    await expect(client.connect()).resolves.toBeTruthy();
    expect(host.clientCount).toBe(1);
    await waitFor(() => host.broker.snapshot.role === 'leader');

    client.close();
    await waitFor(() => scope.close.mock.calls.length === 1);
    expect(host.clientCount).toBe(0);
    await host.stop();
  });

  it('can stop before the first connection and rejects invalid idle bounds', async () => {
    const scope = new MemorySharedWorkerScope();
    const host = createSharedWorkerBrokerHost({
      adapter: new DeterministicInferenceAdapter(),
      config: {
        namespace: `host-${crypto.randomUUID()}`,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      },
      scope,
    });

    await host.stop();
    await host.stop();
    expect(scope.listenerCount).toBe(0);

    expect(() =>
      createSharedWorkerBrokerHost({
        adapter: new DeterministicInferenceAdapter(),
        config: {
          namespace: `host-${crypto.randomUUID()}`,
          runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        },
        idleTimeoutMs: -1,
        scope: new MemorySharedWorkerScope(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('closes an unused host after rejecting a pre-commit client', async () => {
    const scope = new MemorySharedWorkerScope();
    const namespace = `host-${crypto.randomUUID()}`;
    const host = createSharedWorkerBrokerHost({
      adapter: new DeterministicInferenceAdapter(),
      capabilityProbe: () => false,
      config: {
        namespace,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      },
      idleTimeoutMs: 0,
      scope,
    });
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    scope.connect(hostPort);
    const client = new SharedWorkerClientTransport({
      namespace,
      port: clientPort,
      requiredCapabilities: ['webgpu'],
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: 'TOPOLOGY_UNAVAILABLE',
    });
    await waitFor(() => scope.close.mock.calls.length === 1);
    expect(scope.listenerCount).toBe(0);
    await host.stop();
  });

  it('defines transport ready before provider readiness', async () => {
    stubWebLocks();
    const scope = new MemorySharedWorkerScope();
    const namespace = `host-${crypto.randomUUID()}`;
    let resolveInitialization!: () => void;
    let markInitializationStarted!: () => void;
    const initializationStarted = new Promise<void>((resolve) => {
      markInitializationStarted = resolve;
    });
    const initialization = new Promise<void>((resolve) => {
      resolveInitialization = resolve;
    });
    const host = createSharedWorkerBrokerHost({
      adapter: {
        descriptor: {
          evidence: 'provider-runtime',
          id: 'delayed-provider',
          name: 'Delayed provider',
          version: '1',
        },
        initialize: () => {
          markInitializationStarted();
          return initialization;
        },
        run: () => Promise.reject(new Error('must not run')),
      },
      capabilityProbe: () => true,
      config: {
        heartbeatIntervalMs: 50,
        leaderTimeoutMs: 150,
        namespace,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      },
      scope,
    });
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    scope.connect(hostPort);
    const client = new SharedWorkerClientTransport({
      namespace,
      port: clientPort,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });

    const connection = client.connect();
    await initializationStarted;
    await expect(connection).resolves.toBeTruthy();
    expect(host.broker.snapshot.readiness).toBe('initializing');
    resolveInitialization();
    await waitFor(() => host.broker.snapshot.readiness === 'ready');

    client.close();
    await host.stop();
  });

  it('fatals committed clients when provider initialization fails', async () => {
    stubWebLocks();
    const scope = new MemorySharedWorkerScope();
    const namespace = `host-${crypto.randomUUID()}`;
    let rejectInitialization!: (error: Error) => void;
    let markInitializationStarted!: () => void;
    const initializationStarted = new Promise<void>((resolve) => {
      markInitializationStarted = resolve;
    });
    const initialization = new Promise<void>((_resolve, reject) => {
      rejectInitialization = reject;
    });
    const host = createSharedWorkerBrokerHost({
      adapter: {
        descriptor: {
          evidence: 'provider-runtime',
          id: 'failing-provider',
          name: 'Failing provider',
          version: '1',
        },
        initialize: () => {
          markInitializationStarted();
          return initialization;
        },
        run: () => Promise.reject(new Error('must not run')),
      },
      capabilityProbe: () => true,
      config: {
        heartbeatIntervalMs: 50,
        leaderTimeoutMs: 150,
        namespace,
        requestTimeoutMs: 1_000,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      },
      scope,
    });
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    scope.connect(hostPort);
    const client = new SharedWorkerClientTransport({
      handshakeTimeoutMs: 1_000,
      namespace,
      port: clientPort,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    await client.connect();
    await initializationStarted;
    const failure = new Promise<unknown>((resolve) => {
      client.subscribeFailures(resolve);
    });

    rejectInitialization(new Error('private provider detail'));
    await expect(failure).resolves.toMatchObject({
      code: 'TRANSPORT_FAILED',
      message: 'The SharedWorker broker stopped unexpectedly.',
    });
    await waitFor(() => host.broker.snapshot.role === 'stopped');
    await waitFor(() => scope.close.mock.calls.length === 1);
    await host.stop();
  });

  it('probes only explicitly supported worker capabilities', () => {
    vi.stubGlobal('navigator', { gpu: {} });
    expect(probeSharedWorkerCapabilities([])).toBe(true);
    expect(probeSharedWorkerCapabilities(['webgpu'])).toBe(true);
    expect(probeSharedWorkerCapabilities(['unknown'])).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(probeSharedWorkerCapabilities(['webgpu'])).toBe(false);
  });

  it('expires an orphaned ready port with a host-bound liveness lease', async () => {
    vi.useFakeTimers();
    const changes = vi.fn();
    const host = new SharedWorkerHostTransport({
      livenessIntervalMs: 100,
      livenessTimeoutMs: 200,
      namespace: 'shared-test',
      onConnectionCountChanged: changes,
      prepareHost: () => Promise.resolve(),
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    host.attach(hostPort);
    clientPort.start();
    const prepared = nextControlMessage(clientPort, 'prepared');
    clientPort.postMessage({
      kind: 'hello',
      namespace: 'shared-test',
      nonce: 'orphan-client',
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      requiredCapabilities: [],
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    await prepared;
    const ready = nextControlMessage(clientPort, 'ready');
    clientPort.postMessage({ kind: 'commit', nonce: 'orphan-client' });
    await ready;
    expect(host.clientCount).toBe(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(host.connectionCount).toBe(0);
    expect(changes).toHaveBeenLastCalledWith(0, 'stale');
    host.close();
  });

  it('keeps a client that acknowledges host-bound liveness probes', async () => {
    vi.useFakeTimers();
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const host = new SharedWorkerHostTransport({
      livenessIntervalMs: 100,
      livenessTimeoutMs: 300,
      namespace: 'shared-test',
      prepareHost: () => Promise.resolve(),
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    host.attach(hostPort);
    const client = new SharedWorkerClientTransport({
      handshakeTimeoutMs: 1_000,
      namespace: 'shared-test',
      port: clientPort,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    await client.connect();

    await vi.advanceTimersByTimeAsync(450);
    expect(host.clientCount).toBe(1);
    client.close();
    host.close();
  });
});

class MemorySharedWorkerScope {
  readonly close = vi.fn();
  #listeners = new Set<(event: SharedWorkerConnectEventLike) => void>();

  get listenerCount(): number {
    return this.#listeners.size;
  }

  addEventListener(
    _type: 'connect',
    listener: (event: SharedWorkerConnectEventLike) => void,
  ): void {
    this.#listeners.add(listener);
  }

  connect(port: MemoryMessagePort): void {
    for (const listener of this.#listeners) {
      listener({ ports: [port] });
    }
  }

  removeEventListener(
    _type: 'connect',
    listener: (event: SharedWorkerConnectEventLike) => void,
  ): void {
    this.#listeners.delete(listener);
  }
}

function stubWebLocks(): void {
  const request = vi.fn(
    async (
      name: string,
      _options: LockOptions,
      callback: (lock: Lock) => Promise<void>,
    ) => callback({ mode: 'exclusive', name }),
  );
  vi.stubGlobal('navigator', { locks: { request } });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}

function nextControlMessage(
  port: MemoryMessagePort,
  kind: SharedWorkerControlMessage['kind'],
): Promise<SharedWorkerControlMessage> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent<unknown>) => {
      const message = parseSharedWorkerControlMessage(event.data);
      if (message?.kind === kind) {
        port.removeEventListener('message', listener);
        resolve(message);
      }
    };
    port.addEventListener('message', listener);
  });
}
