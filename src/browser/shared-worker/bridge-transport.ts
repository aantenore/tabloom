import {
  parseProtocolEnvelope,
  type ProtocolEnvelope,
} from '../../core/protocol.js';
import type { TransportPort } from '../../core/types.js';
import type { SharedWorkerHostTransport } from './host-transport.js';

export class SharedWorkerBridgeTransport implements TransportPort {
  #broadcast: TransportPort;
  #closed = false;
  #hub: SharedWorkerHostTransport;

  constructor(hub: SharedWorkerHostTransport, broadcast: TransportPort) {
    this.#hub = hub;
    this.#broadcast = broadcast;
  }

  send(envelope: ProtocolEnvelope): void {
    if (this.#closed) {
      return;
    }
    this.#hub.send(envelope);
    this.#broadcast.send(envelope);
  }

  subscribe(listener: (envelope: unknown) => void): () => void {
    const unsubscribeHub = this.#hub.subscribe((input) => {
      const envelope = parseProtocolEnvelope(input);
      if (envelope === undefined) {
        return;
      }
      listener(envelope);
      this.#broadcast.send(envelope);
    });
    const unsubscribeBroadcast = this.#broadcast.subscribe((input) => {
      const envelope = parseProtocolEnvelope(input);
      if (envelope === undefined) {
        return;
      }
      listener(envelope);
      this.#hub.send(envelope);
    });
    return () => {
      unsubscribeHub();
      unsubscribeBroadcast();
    };
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#hub.close();
    this.#broadcast.close();
  }
}
