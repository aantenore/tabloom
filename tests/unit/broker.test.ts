import { afterEach, describe, expect, it } from 'vitest';
import {
  DeterministicInferenceAdapter,
  type DeterministicChunk,
  type DeterministicRequest,
  type DeterministicResult,
} from '../../src/adapters/deterministic.js';
import {
  InMemoryElectionCoordinator,
  InMemoryTransportHub,
} from '../../src/adapters/in-memory.js';
import {
  CollectingTelemetry,
  SequenceIdProvider,
  SystemClock,
} from '../../src/adapters/runtime.js';
import { TabLoomBroker } from '../../src/core/broker.js';
import { TabLoomError } from '../../src/core/errors.js';
import type {
  BrokerSnapshot,
  ElectionPort,
  InferenceAdapter,
} from '../../src/core/types.js';

type TestBroker = TabLoomBroker<
  DeterministicRequest,
  DeterministicChunk,
  DeterministicResult
>;

const brokers: TestBroker[] = [];

afterEach(async () => {
  await Promise.all(brokers.splice(0).map(async (broker) => broker.stop()));
});

describe('in-memory broker cluster', () => {
  it('requires startup and validates per-request timeout', async () => {
    const broker = createBrokerFixture('single');
    expect(() => broker.request({ text: 'before start' })).toThrowError(
      TabLoomError,
    );
    await broker.start();
    await broker.start();
    expect(() =>
      broker.request({ text: 'bad timeout' }, { timeoutMs: 1 }),
    ).toThrowError(TabLoomError);
    await broker.stop();
    await broker.stop();
  });

  it('elects one owner and streams peer work', async () => {
    const cluster = await createCluster(3);
    await waitFor(
      () => roles(cluster).leader === 1 && roles(cluster).peer === 2,
    );
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer');
    expect(peer).toBeDefined();
    const session = peer?.request({
      chunkDelayMs: 0,
      chunkSize: 3,
      text: 'hello',
    });
    expect(session).toBeDefined();
    const chunks: string[] = [];
    for await (const chunk of session!) {
      chunks.push(chunk.text);
    }
    await expect(session?.result).resolves.toEqual({
      chunkCount: 6,
      text: 'Woven once: hello',
    });
    expect(chunks.join('')).toBe('Woven once: hello');
  });

  it('runs a request from the owner itself', async () => {
    const cluster = await createCluster(1);
    const owner = cluster[0]!;
    await waitFor(() => owner.snapshot.role === 'leader');
    const session = owner.request({ chunkDelayMs: 0, text: 'local' });
    await expect(session.result).resolves.toMatchObject({
      text: 'Woven once: local',
    });
  });

  it('rejects work beyond configured capacity', async () => {
    const cluster = await createCluster(3, { queueCapacity: 1 });
    await waitFor(
      () => roles(cluster).leader === 1 && roles(cluster).peer === 2,
    );
    const peers = cluster.filter((broker) => broker.snapshot.role === 'peer');
    const first = peers[0]!.request({
      chunkDelayMs: 50,
      chunkSize: 1,
      text: 'long',
    });
    const second = peers[1]!.request({
      chunkDelayMs: 50,
      chunkSize: 1,
      text: 'other',
    });
    void first.result.catch(() => undefined);
    await expect(second.result).rejects.toMatchObject({ code: 'BACKPRESSURE' });
    first.cancel();
    await expect(first.result).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('cancels active work and drains the owner', async () => {
    const cluster = await createCluster(2);
    await waitFor(() => roles(cluster).peer === 1);
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer')!;
    const owner = cluster.find((broker) => broker.snapshot.role === 'leader')!;
    const session = peer.request({
      chunkDelayMs: 40,
      chunkSize: 1,
      text: 'cancel',
    });
    await waitFor(() => owner.snapshot.queueDepth === 1);
    session.cancel();
    await expect(session.result).rejects.toMatchObject({ code: 'CANCELLED' });
    await waitFor(() => owner.snapshot.queueDepth === 0);
  });

  it('removes queued work on cancellation', async () => {
    const cluster = await createCluster(2, { queueCapacity: 2 });
    await waitFor(() => roles(cluster).peer === 1);
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer')!;
    const owner = cluster.find((broker) => broker.snapshot.role === 'leader')!;
    const active = peer.request({
      chunkDelayMs: 50,
      chunkSize: 1,
      text: 'active',
    });
    const queued = peer.request({
      chunkDelayMs: 50,
      chunkSize: 1,
      text: 'queued',
    });
    void active.result.catch(() => undefined);
    await waitFor(() => owner.snapshot.queueDepth === 2);
    queued.cancel();
    await expect(queued.result).rejects.toMatchObject({ code: 'CANCELLED' });
    await waitFor(() => owner.snapshot.queueDepth === 1);
    active.cancel();
    await expect(active.result).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('connects an external abort signal to cancellation', async () => {
    const cluster = await createCluster(2);
    await waitFor(() => roles(cluster).peer === 1);
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer')!;
    const controller = new AbortController();
    const session = peer.request(
      { chunkDelayMs: 100, chunkSize: 1, text: 'signal' },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(session.result).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('times out active work', async () => {
    const cluster = await createCluster(2);
    await waitFor(() => roles(cluster).peer === 1);
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer')!;
    const session = peer.request(
      { chunkDelayMs: 250, chunkSize: 1, text: 'timeout' },
      { timeoutMs: 100 },
    );
    await expect(session.result).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('takes over and produces one client terminal outcome', async () => {
    const cluster = await createCluster(3);
    await waitFor(
      () => roles(cluster).leader === 1 && roles(cluster).peer === 2,
    );
    const owner = cluster.find((broker) => broker.snapshot.role === 'leader')!;
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer')!;
    const session = peer.request({
      chunkDelayMs: 25,
      chunkSize: 1,
      text: 'takeover',
    });
    const iterator = session[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const oldEpoch = owner.snapshot.epoch;
    await owner.stop();
    await waitFor(
      () =>
        cluster.filter(
          (broker) => broker !== owner && broker.snapshot.role === 'leader',
        ).length === 1,
    );
    await expect(session.result).resolves.toMatchObject({
      text: 'Woven once: takeover',
    });
    expect(peer.snapshot.epoch).toBeGreaterThan(oldEpoch);
    expect(peer.snapshot.terminalCount).toBe(1);
  });

  it('normalizes provider failures', async () => {
    const cluster = await createCluster(2, {
      adapterFactory: () => ({
        descriptor: {
          evidence: 'deterministic-simulation',
          id: 'failing',
          name: 'Failing test adapter',
          version: '1',
        },
        run: () => Promise.reject(new Error('private adapter detail')),
      }),
    });
    await waitFor(() => roles(cluster).peer === 1);
    const peer = cluster.find((broker) => broker.snapshot.role === 'peer')!;
    const session = peer.request({ text: 'failure' });
    await expect(session.result).rejects.toMatchObject({
      code: 'ADAPTER_FAILED',
      message: 'The inference adapter failed.',
    });
  });

  it('times out without an owner and records invalid traffic', async () => {
    const transport = new InMemoryTransportHub();
    const port = transport.createPort('isolated');
    const telemetry = new CollectingTelemetry();
    const election: ElectionPort = {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    };
    const broker = new TabLoomBroker<
      DeterministicRequest,
      DeterministicChunk,
      DeterministicResult
    >(
      {
        heartbeatIntervalMs: 50,
        leaderTimeoutMs: 150,
        namespace: 'isolated',
        requestTimeoutMs: 100,
      },
      {
        adapter: new DeterministicInferenceAdapter(),
        clock: new SystemClock(),
        election,
        ids: new SequenceIdProvider('isolated'),
        telemetry,
        transport: port,
      },
    );
    brokers.push(broker);
    await broker.start();
    port.deliver({ invalid: true });
    const session = broker.request({ text: 'no owner' });
    await expect(session.result).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(telemetry.events).toContainEqual(
      expect.objectContaining({
        kind: 'message_rejected',
        reason: 'invalid-envelope',
      }),
    );
  });
});

async function createCluster(
  count: number,
  overrides: {
    adapterFactory?: () => InferenceAdapter<
      DeterministicRequest,
      DeterministicChunk,
      DeterministicResult
    >;
    queueCapacity?: number;
  } = {},
): Promise<TestBroker[]> {
  const election = new InMemoryElectionCoordinator();
  const transport = new InMemoryTransportHub();
  const cluster = Array.from({ length: count }, (_, index) => {
    const identity = `tab-${index + 1}`;
    const telemetry = new CollectingTelemetry();
    const broker = new TabLoomBroker<
      DeterministicRequest,
      DeterministicChunk,
      DeterministicResult
    >(
      {
        heartbeatIntervalMs: 50,
        leaderTimeoutMs: 150,
        namespace: 'unit-cluster',
        queueCapacity: overrides.queueCapacity ?? 8,
        requestTimeoutMs: 2_000,
      },
      {
        adapter:
          overrides.adapterFactory?.() ??
          new DeterministicInferenceAdapter({ defaultChunkDelayMs: 0 }),
        clock: new SystemClock(),
        election: election.createPort(identity),
        ids: new SequenceIdProvider(identity),
        telemetry,
        transport: transport.createPort(identity),
      },
    );
    brokers.push(broker);
    return broker;
  });
  await Promise.all(cluster.map(async (broker) => broker.start()));
  return cluster;
}

function createBrokerFixture(identity: string): TestBroker {
  const election = new InMemoryElectionCoordinator();
  const transport = new InMemoryTransportHub();
  const broker = new TabLoomBroker<
    DeterministicRequest,
    DeterministicChunk,
    DeterministicResult
  >(
    {
      heartbeatIntervalMs: 50,
      leaderTimeoutMs: 150,
      namespace: identity,
      requestTimeoutMs: 1_000,
    },
    {
      adapter: new DeterministicInferenceAdapter({ defaultChunkDelayMs: 0 }),
      clock: new SystemClock(),
      election: election.createPort(identity),
      ids: new SequenceIdProvider(identity),
      telemetry: new CollectingTelemetry(),
      transport: transport.createPort(identity),
    },
  );
  brokers.push(broker);
  return broker;
}

function roles(cluster: TestBroker[]): Record<BrokerSnapshot['role'], number> {
  return cluster.reduce<Record<BrokerSnapshot['role'], number>>(
    (counts, broker) => {
      counts[broker.snapshot.role] += 1;
      return counts;
    },
    { candidate: 0, leader: 0, peer: 0, stopped: 0 },
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Condition was not reached.');
}
