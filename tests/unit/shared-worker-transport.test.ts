import { describe, expect, it, vi } from 'vitest';
import { SharedWorkerClientTransport } from '../../src/browser/shared-worker/client-transport.js';
import {
  parseSharedWorkerControlMessage,
  type SharedWorkerControlMessage,
} from '../../src/browser/shared-worker/control-protocol.js';
import { SharedWorkerHostTransport } from '../../src/browser/shared-worker/host-transport.js';
import type { ProtocolEnvelope } from '../../src/core/protocol.js';
import { TABLOOM_PROTOCOL_VERSION } from '../../src/core/version.js';
import { MemoryMessagePort } from '../fakes/message-port.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

describe('SharedWorker control transport', () => {
  it('commits a fingerprinted handshake and relays protocol envelopes', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const prepareHost = vi.fn(() => Promise.resolve());
    const host = createHost(hostPort, { prepareHost });
    const client = createClient(clientPort);

    const firstConnect = client.connect();
    expect(client.connect()).toBe(firstConnect);
    await expect(firstConnect).resolves.toBe(host.hostId);
    expect(prepareHost).toHaveBeenCalledOnce();
    expect(host.clientCount).toBe(1);

    const hostReceived = new Promise<unknown>((resolve) =>
      host.subscribe(resolve),
    );
    client.send(presenceEnvelope('client-a'));
    await expect(hostReceived).resolves.toMatchObject({
      kind: 'presence',
      sourceId: 'client-a',
    });

    const clientReceived = new Promise<unknown>((resolve) =>
      client.subscribe(resolve),
    );
    host.send(presenceEnvelope('host-a'));
    await expect(clientReceived).resolves.toMatchObject({
      kind: 'presence',
      sourceId: 'host-a',
    });

    client.close();
    await waitFor(() => host.clientCount === 0);
    host.close();
  });

  it('rejects a runtime mismatch without preparing the host', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const prepareHost = vi.fn(() => Promise.resolve());
    const host = createHost(hostPort, { prepareHost });
    const client = createClient(clientPort, `sha256:${'1'.repeat(64)}`);

    await expect(client.connect()).rejects.toMatchObject({
      code: 'RUNTIME_MISMATCH',
    });
    expect(prepareHost).not.toHaveBeenCalled();
    expect(host.clientCount).toBe(0);
    host.close();
  });

  it('rejects unsupported capabilities and host preparation failures', async () => {
    const [capabilityClientPort, capabilityHostPort] = MemoryMessagePort.pair();
    const capabilityHost = createHost(capabilityHostPort, {
      capabilityProbe: () => false,
    });
    const capabilityClient = createClient(
      capabilityClientPort,
      TEST_RUNTIME_FINGERPRINT,
      ['webgpu'],
    );
    await expect(capabilityClient.connect()).rejects.toMatchObject({
      code: 'TOPOLOGY_UNAVAILABLE',
    });
    capabilityHost.close();

    const [failingClientPort, failingHostPort] = MemoryMessagePort.pair();
    const failingHost = createHost(failingHostPort, {
      prepareHost: () => Promise.reject(new Error('private host detail')),
    });
    const failingClient = createClient(failingClientPort);
    await expect(failingClient.connect()).rejects.toMatchObject({
      code: 'START_FAILED',
      message: 'The SharedWorker host could not start.',
    });
    failingHost.close();
  });

  it('rejects malformed capability requirements before handshaking', () => {
    const [port] = MemoryMessagePort.pair();

    expect(() => createClient(port, TEST_RUNTIME_FINGERPRINT, [''])).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' }),
    );
    expect(() =>
      createClient(
        port,
        TEST_RUNTIME_FINGERPRINT,
        Array.from({ length: 17 }, (_, index) => `capability-${index}`),
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      createClient(port, TEST_RUNTIME_FINGERPRINT, ['x'.repeat(81)]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      createClient(port, TEST_RUNTIME_FINGERPRINT, [1 as unknown as string]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('treats a timeout after commit as a hard failure and aborts the host client', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    let releaseHost!: () => void;
    const prepareHost = new Promise<void>((resolve) => {
      releaseHost = resolve;
    });
    const host = createHost(hostPort, {
      prepareHost: () => prepareHost,
    });
    const client = createClient(clientPort, TEST_RUNTIME_FINGERPRINT, [], {
      handshakeTimeoutMs: 100,
    });

    await expect(client.connect()).rejects.toMatchObject({
      code: 'START_FAILED',
      message: 'The SharedWorker startup outcome is unknown after commit.',
    });
    await waitFor(() => host.connectionCount === 0);
    releaseHost();
    host.close();
  });

  it('notifies active brokers when a ready port fails', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const host = createHost(hostPort);
    const client = createClient(clientPort);
    await client.connect();
    const failure = vi.fn();
    client.subscribeFailures(failure);
    clientPort.failPost = true;

    expect(() => client.send(presenceEnvelope('failed-send'))).toThrowError(
      expect.objectContaining({ code: 'TRANSPORT_FAILED' }),
    );
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TRANSPORT_FAILED' }),
    );
    host.close();
  });

  it('retries host preparation after a transactional failure', async () => {
    let attempts = 0;
    const prepareHost = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('first attempt failed'))
        : Promise.resolve();
    });
    const firstPair = MemoryMessagePort.pair();
    const host = createHost(firstPair[1], { prepareHost });
    await expect(createClient(firstPair[0]).connect()).rejects.toMatchObject({
      code: 'START_FAILED',
    });

    const secondPair = MemoryMessagePort.pair();
    host.attach(secondPair[1]);
    await expect(createClient(secondPair[0]).connect()).resolves.toBe(
      host.hostId,
    );
    expect(prepareHost).toHaveBeenCalledTimes(2);
    host.close();
  });

  it('reports protocol mismatch instead of falling back silently', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const host = createHost(hostPort);
    const fatal = nextControlMessage(clientPort, 'fatal');
    clientPort.start();
    clientPort.postMessage({
      kind: 'hello',
      namespace: 'shared-test',
      nonce: 'old-client',
      protocolVersion: 1,
      requiredCapabilities: [],
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });

    await expect(fatal).resolves.toMatchObject({
      code: 'PROTOCOL_MISMATCH',
      kind: 'fatal',
    });
    host.close();
  });

  it('times out an incomplete handshake and normalizes port failures', async () => {
    const [timeoutPort] = MemoryMessagePort.pair();
    const timedOut = createClient(timeoutPort, TEST_RUNTIME_FINGERPRINT, [], {
      handshakeTimeoutMs: 100,
    });
    await expect(timedOut.connect()).rejects.toMatchObject({
      code: 'TOPOLOGY_UNAVAILABLE',
    });

    const [failingPort] = MemoryMessagePort.pair();
    failingPort.failPost = true;
    const failing = createClient(failingPort);
    await expect(failing.connect()).rejects.toMatchObject({
      code: 'TRANSPORT_FAILED',
    });
  });

  it('closes on message deserialization failure', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const host = createHost(hostPort);
    const client = createClient(clientPort);
    const connection = client.connect();
    clientPort.emitMessageError();
    await expect(connection).rejects.toMatchObject({
      code: 'TRANSPORT_FAILED',
    });
    host.close();
  });

  it('re-handshakes with a replacement host and flushes bounded traffic', async () => {
    const [clientPort, hostPort] = MemoryMessagePort.pair();
    const client = createClient(clientPort);
    const firstHello = nextControlMessage(hostPort, 'hello');
    const connection = client.connect();
    const hello = await firstHello;
    if (hello.kind !== 'hello') {
      throw new Error('The initial HELLO was not observed.');
    }
    const firstCommit = nextControlMessage(hostPort, 'commit');
    hostPort.postMessage({
      hostId: 'host-old',
      kind: 'prepared',
      namespace: 'shared-test',
      nonce: hello.nonce,
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    await firstCommit;
    hostPort.postMessage({
      hostId: 'host-old',
      kind: 'ready',
      nonce: hello.nonce,
      topology: 'shared-worker',
    });
    await expect(connection).resolves.toBe('host-old');

    const replacementHello = nextControlMessage(hostPort, 'hello');
    hostPort.postMessage({
      hostId: 'host-new',
      kind: 'challenge',
      namespace: 'shared-test',
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    const reconnect = await replacementHello;
    if (reconnect.kind !== 'hello') {
      throw new Error('The replacement HELLO was not observed.');
    }
    const replacementCommit = nextControlMessage(hostPort, 'commit');
    hostPort.postMessage({
      hostId: 'host-new',
      kind: 'prepared',
      namespace: 'shared-test',
      nonce: reconnect.nonce,
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    await replacementCommit;
    client.send(presenceEnvelope('queued-old'));
    client.send(presenceEnvelope('queued-latest'));
    const flushed = nextControlMessage(hostPort, 'protocol');
    hostPort.postMessage({
      hostId: 'host-new',
      kind: 'ready',
      nonce: reconnect.nonce,
      topology: 'shared-worker',
    });

    await expect(flushed).resolves.toMatchObject({
      envelope: { sourceId: 'queued-latest' },
      kind: 'protocol',
    });
    client.close();
  });

  it.each([
    {
      code: 'PROTOCOL_MISMATCH',
      override: { protocolVersion: 1 },
    },
    {
      code: 'RUNTIME_MISMATCH',
      override: { runtimeFingerprint: `sha256:${'1'.repeat(64)}` },
    },
    {
      code: 'TOPOLOGY_UNAVAILABLE',
      override: { namespace: 'other-namespace' },
    },
  ])(
    'fails closed for incompatible replacement host: $code',
    async ({ code, override }) => {
      const { client, hostPort } = await connectedManualClient();
      const failure = new Promise<unknown>((resolve) => {
        client.subscribeFailures(resolve);
      });

      hostPort.postMessage({
        hostId: 'host-incompatible',
        kind: 'challenge',
        namespace: 'shared-test',
        protocolVersion: TABLOOM_PROTOCOL_VERSION,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        ...override,
      });
      await expect(failure).resolves.toMatchObject({ code });
    },
  );

  it('fails closed when multiple replacement hosts overlap', async () => {
    const { client, hostPort } = await connectedManualClient();
    const replacementHello = nextControlMessage(hostPort, 'hello');
    hostPort.postMessage({
      hostId: 'host-new',
      kind: 'challenge',
      namespace: 'shared-test',
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    await replacementHello;
    const failure = new Promise<unknown>((resolve) => {
      client.subscribeFailures(resolve);
    });
    hostPort.postMessage({
      hostId: 'host-other',
      kind: 'challenge',
      namespace: 'shared-test',
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });

    await expect(failure).resolves.toMatchObject({
      code: 'TRANSPORT_FAILED',
      message: 'Multiple SharedWorkers attempted to reconnect the same client.',
    });
  });

  it('rejects a prepared response from the wrong replacement host', async () => {
    const { client, hostPort } = await connectedManualClient();
    const replacementHello = nextControlMessage(hostPort, 'hello');
    hostPort.postMessage({
      hostId: 'host-new',
      kind: 'challenge',
      namespace: 'shared-test',
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });
    const hello = await replacementHello;
    if (hello.kind !== 'hello') {
      throw new Error('The replacement HELLO was not observed.');
    }
    const failure = new Promise<unknown>((resolve) => {
      client.subscribeFailures(resolve);
    });
    hostPort.postMessage({
      hostId: 'host-other',
      kind: 'prepared',
      namespace: 'shared-test',
      nonce: hello.nonce,
      protocolVersion: TABLOOM_PROTOCOL_VERSION,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    });

    await expect(failure).resolves.toMatchObject({
      code: 'TRANSPORT_FAILED',
      message: 'A different SharedWorker prepared the reconnect handshake.',
    });
  });

  it('validates bounded control frames', () => {
    expect(
      parseSharedWorkerControlMessage({
        kind: 'commit',
        nonce: 'connection-a',
      }),
    ).toEqual({ kind: 'commit', nonce: 'connection-a' });
    expect(parseSharedWorkerControlMessage({ kind: 'commit' })).toBeUndefined();
    expect(
      parseSharedWorkerControlMessage({
        envelope: { invalid: true },
        kind: 'protocol',
      }),
    ).toBeUndefined();
    expect(
      parseSharedWorkerControlMessage({
        hostId: 'host-a',
        kind: 'challenge',
        namespace: 'shared-test',
        protocolVersion: TABLOOM_PROTOCOL_VERSION,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      }),
    ).toMatchObject({ kind: 'challenge' });
  });
});

function createHost(
  port: MemoryMessagePort,
  overrides: Partial<
    ConstructorParameters<typeof SharedWorkerHostTransport>[0]
  > = {},
): SharedWorkerHostTransport {
  const host = new SharedWorkerHostTransport({
    namespace: 'shared-test',
    prepareHost: () => Promise.resolve(),
    runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    ...overrides,
  });
  host.attach(port);
  return host;
}

function createClient(
  port: MemoryMessagePort,
  runtimeFingerprint = TEST_RUNTIME_FINGERPRINT,
  requiredCapabilities: readonly string[] = [],
  overrides: Partial<
    ConstructorParameters<typeof SharedWorkerClientTransport>[0]
  > = {},
): SharedWorkerClientTransport {
  return new SharedWorkerClientTransport({
    handshakeTimeoutMs: 1_000,
    namespace: 'shared-test',
    port,
    requiredCapabilities,
    runtimeFingerprint,
    ...overrides,
  });
}

function presenceEnvelope(sourceId: string): ProtocolEnvelope {
  return {
    kind: 'presence',
    messageId: `message-${sourceId}`,
    protocolVersion: TABLOOM_PROTOCOL_VERSION,
    runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
    sentAt: 1,
    sourceId,
    supportedVersions: [TABLOOM_PROTOCOL_VERSION],
  };
}

function nextControlMessage(
  port: MemoryMessagePort,
  kind?: SharedWorkerControlMessage['kind'],
): Promise<SharedWorkerControlMessage> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent<unknown>) => {
      const message = parseSharedWorkerControlMessage(event.data);
      if (
        message !== undefined &&
        (kind === undefined || message.kind === kind)
      ) {
        port.removeEventListener('message', listener);
        resolve(message);
      }
    };
    port.addEventListener('message', listener);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}

async function connectedManualClient(): Promise<{
  readonly client: SharedWorkerClientTransport;
  readonly hostPort: MemoryMessagePort;
}> {
  const [clientPort, hostPort] = MemoryMessagePort.pair();
  const client = createClient(clientPort);
  const firstHello = nextControlMessage(hostPort, 'hello');
  const connection = client.connect();
  const hello = await firstHello;
  if (hello.kind !== 'hello') {
    throw new Error('The initial HELLO was not observed.');
  }
  const firstCommit = nextControlMessage(hostPort, 'commit');
  hostPort.postMessage({
    hostId: 'host-old',
    kind: 'prepared',
    namespace: 'shared-test',
    nonce: hello.nonce,
    protocolVersion: TABLOOM_PROTOCOL_VERSION,
    runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
  });
  await firstCommit;
  hostPort.postMessage({
    hostId: 'host-old',
    kind: 'ready',
    nonce: hello.nonce,
    topology: 'shared-worker',
  });
  await connection;
  return { client, hostPort };
}
