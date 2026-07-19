import { describe, expect, it, vi } from 'vitest';
import { SharedWorkerBridgeTransport } from '../../src/browser/shared-worker/bridge-transport.js';
import type { SharedWorkerHostTransport } from '../../src/browser/shared-worker/host-transport.js';
import type { ProtocolEnvelope } from '../../src/core/protocol.js';
import type { TransportPort } from '../../src/core/types.js';
import { TABLOOM_PROTOCOL_VERSION } from '../../src/core/version.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

describe('SharedWorker bridge transport', () => {
  it('relays validated envelopes in both directions without echoing after close', () => {
    const hub = new MemoryTransport();
    const broadcast = new MemoryTransport();
    const bridge = new SharedWorkerBridgeTransport(
      hub as unknown as SharedWorkerHostTransport,
      broadcast,
    );
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const fromHub = presenceEnvelope('hub');
    const fromBroadcast = presenceEnvelope('broadcast');

    hub.emit(fromHub);
    expect(listener).toHaveBeenLastCalledWith(fromHub);
    expect(broadcast.sent).toEqual([fromHub]);

    broadcast.emit(fromBroadcast);
    expect(listener).toHaveBeenLastCalledWith(fromBroadcast);
    expect(hub.sent).toEqual([fromBroadcast]);

    hub.emit({ invalid: true });
    broadcast.emit({ invalid: true });
    expect(listener).toHaveBeenCalledTimes(2);

    const outbound = presenceEnvelope('broker');
    bridge.send(outbound);
    expect(hub.sent).toContain(outbound);
    expect(broadcast.sent).toContain(outbound);

    unsubscribe();
    hub.emit(presenceEnvelope('ignored'));
    expect(listener).toHaveBeenCalledTimes(2);

    bridge.close();
    bridge.close();
    expect(hub.closed).toBe(true);
    expect(broadcast.closed).toBe(true);
    const sentBeforeClose = hub.sent.length;
    bridge.send(presenceEnvelope('closed'));
    expect(hub.sent).toHaveLength(sentBeforeClose);
  });
});

class MemoryTransport implements TransportPort {
  closed = false;
  readonly sent: ProtocolEnvelope[] = [];
  #listeners = new Set<(input: unknown) => void>();

  close(): void {
    this.closed = true;
    this.#listeners.clear();
  }

  emit(input: unknown): void {
    for (const listener of this.#listeners) {
      listener(input);
    }
  }

  send(envelope: ProtocolEnvelope): void {
    this.sent.push(envelope);
  }

  subscribe(listener: (input: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
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
