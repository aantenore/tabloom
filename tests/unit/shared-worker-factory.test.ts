import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeterministicInferenceAdapter } from '../../src/adapters/deterministic.js';
import { SharedWorkerHostTransport } from '../../src/browser/shared-worker/host-transport.js';
import type { TabLoomBroker } from '../../src/core/broker.js';
import {
  createAdaptiveBrowserBroker,
  createSharedWorkerBroker,
  probeSharedWorkerLifecycleCompatibility,
  type AdaptiveBrowserBrokerOptions,
  type SharedWorkerFactory,
  type SharedWorkerTopologyOptions,
} from '../../src/shared-worker.js';
import { MemoryMessagePort } from '../fakes/message-port.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

type TestBroker = TabLoomBroker<
  { readonly text: string },
  { readonly text: string },
  { readonly chunkCount: number; readonly text: string }
>;
type TestAdaptiveOptions = AdaptiveBrowserBrokerOptions<
  { readonly text: string },
  { readonly text: string },
  { readonly chunkCount: number; readonly text: string }
>;
type WorkerBrokerOptions = Omit<TestAdaptiveOptions, 'topology'> & {
  readonly topology: Exclude<
    SharedWorkerTopologyOptions,
    { readonly mode: 'page-owner' }
  >;
};

const brokers: TestBroker[] = [];
const hosts: SharedWorkerHostTransport[] = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map(async (broker) => broker.stop()));
  for (const host of hosts.splice(0)) {
    host.close();
  }
  vi.unstubAllGlobals();
});

describe('adaptive SharedWorker broker factory', () => {
  it('selects a committed SharedWorker transport', async () => {
    const { host, namespace, workerFactory } = connectedWorkerFactory(
      TEST_RUNTIME_FINGERPRINT,
    );
    hosts.push(host);
    const selection = await createSharedWorkerBroker(
      brokerOptions('shared-worker', workerFactory, namespace),
    );
    brokers.push(selection.broker);

    expect(selection).toMatchObject({ topology: 'shared-worker' });
    expect(host.clientCount).toBe(1);
    await selection.broker.start();
    expect(selection.broker.snapshot.role).toBe('candidate');
  });

  it('uses page ownership when explicitly selected', async () => {
    const workerFactory = vi.fn(() => {
      throw new Error('must not construct');
    });
    const options = brokerOptions('auto', workerFactory);
    const selection = await createAdaptiveBrowserBroker({
      ...options,
      topology: { mode: 'page-owner' },
    });
    brokers.push(selection.broker);

    expect(selection.topology).toBe('page-owner');
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('rejects adaptive modes at the explicit SharedWorker factory', async () => {
    const workerFactory = vi.fn(() => {
      throw new Error('must not construct');
    });

    await expect(
      createSharedWorkerBroker(brokerOptions('auto', workerFactory)),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('reports an unavailable native SharedWorker before handshaking', async () => {
    vi.stubGlobal('SharedWorker', undefined);
    const options = brokerOptions('shared-worker', () => {
      throw new Error('custom factory must not run');
    });

    await expect(
      createSharedWorkerBroker({
        adapter: options.adapter,
        config: options.config,
        topology: {
          handshakeTimeoutMs: 1_000,
          mode: 'shared-worker',
          url: '/tabloom-worker.js',
        },
      }),
    ).rejects.toMatchObject({ code: 'TOPOLOGY_UNAVAILABLE' });
  });

  it('falls back only for unavailable topology or transport', async () => {
    const unavailableFactory = vi.fn(() => {
      throw new Error('worker disabled');
    });
    const selection = await createAdaptiveBrowserBroker(
      brokerOptions('auto', unavailableFactory),
    );
    brokers.push(selection.broker);
    expect(selection).toMatchObject({
      fallbackReason: 'TOPOLOGY_UNAVAILABLE',
      topology: 'page-owner',
    });

    const [failingPort] = MemoryMessagePort.pair();
    failingPort.failPost = true;
    const transportSelection = await createAdaptiveBrowserBroker(
      brokerOptions('auto', () => ({ port: failingPort })),
    );
    brokers.push(transportSelection.broker);
    expect(transportSelection).toMatchObject({
      fallbackReason: 'TRANSPORT_FAILED',
      topology: 'page-owner',
    });
  });

  it('does not hide a runtime mismatch behind fallback', async () => {
    const { host, namespace, workerFactory } = connectedWorkerFactory(
      `sha256:${'1'.repeat(64)}`,
    );
    hosts.push(host);

    await expect(
      createAdaptiveBrowserBroker(
        brokerOptions('auto', workerFactory, namespace),
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_MISMATCH' });
  });

  it('closes a constructed port when topology validation fails', async () => {
    const [port] = MemoryMessagePort.pair();
    const options = brokerOptions('shared-worker', () => ({ port }));

    await expect(
      createSharedWorkerBroker({
        ...options,
        topology: { ...options.topology, handshakeTimeoutMs: 99 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(port.closed).toBe(true);
  });

  it('uses a portable lifecycle policy across browser engines', () => {
    expect(
      probeSharedWorkerLifecycleCompatibility(
        'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
      ),
    ).toBe(false);
    expect(
      probeSharedWorkerLifecycleCompatibility(
        'Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe(true);
    expect(
      probeSharedWorkerLifecycleCompatibility('Mozilla/5.0 Firefox/142.0'),
    ).toBe(true);
    expect(
      probeSharedWorkerLifecycleCompatibility(
        'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0',
      ),
    ).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(probeSharedWorkerLifecycleCompatibility()).toBe(true);
  });

  it('falls back before construction when portable lifecycle is unverified', async () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
    });
    const workerFactory = vi.fn(() => {
      throw new Error('must not construct');
    });
    const selection = await createAdaptiveBrowserBroker(
      brokerOptions('auto', workerFactory),
    );
    brokers.push(selection.broker);

    expect(selection).toMatchObject({
      fallbackReason: 'TOPOLOGY_UNAVAILABLE',
      topology: 'page-owner',
    });
    expect(workerFactory).not.toHaveBeenCalled();

    const bestEffort = brokerOptions('auto', workerFactory);
    const attempted = await createAdaptiveBrowserBroker({
      ...bestEffort,
      topology: {
        ...bestEffort.topology,
        lifecyclePolicy: 'best-effort',
      },
    });
    brokers.push(attempted.broker);
    expect(attempted.topology).toBe('page-owner');
    expect(workerFactory).toHaveBeenCalledOnce();
  });
});

function brokerOptions(
  mode: 'auto' | 'shared-worker',
  workerFactory: SharedWorkerFactory,
  namespace = `factory-${crypto.randomUUID()}`,
): WorkerBrokerOptions {
  return {
    adapter: new DeterministicInferenceAdapter({ defaultChunkDelayMs: 0 }),
    config: {
      heartbeatIntervalMs: 50,
      leaderTimeoutMs: 150,
      namespace,
      requestTimeoutMs: 1_000,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    },
    topology: {
      handshakeTimeoutMs: 1_000,
      mode,
      workerFactory,
    },
  };
}

function connectedWorkerFactory(runtimeFingerprint: string) {
  const namespace = `factory-${crypto.randomUUID()}`;
  const [clientPort, hostPort] = MemoryMessagePort.pair();
  const host = new SharedWorkerHostTransport({
    namespace,
    prepareHost: () => Promise.resolve(),
    runtimeFingerprint,
  });
  host.attach(hostPort);
  return {
    host,
    namespace,
    workerFactory: () => ({ port: clientPort }),
  };
}
