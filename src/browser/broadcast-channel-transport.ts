import { TabLoomError } from '../core/errors.js';
import type { ProtocolEnvelope } from '../core/protocol.js';
import type { TransportPort } from '../core/types.js';

export class BrowserBroadcastTransport implements TransportPort {
  #channel: BroadcastChannel;
  #closed = false;
  #listeners = new Set<(envelope: unknown) => void>();

  constructor(namespace: string) {
    if (typeof BroadcastChannel === 'undefined') {
      throw new TabLoomError(
        'CAPABILITY_UNAVAILABLE',
        'BroadcastChannel is required for browser coordination.',
      );
    }
    this.#channel = new BroadcastChannel(`tabloom:${namespace}`);
    this.#channel.addEventListener(
      'message',
      (event: MessageEvent<unknown>) => {
        for (const listener of this.#listeners) {
          listener(event.data);
        }
      },
    );
    this.#channel.addEventListener('messageerror', () => {
      // Invalid structured-clone traffic is ignored at this transport boundary.
    });
  }

  send(envelope: ProtocolEnvelope): void {
    if (this.#closed) {
      return;
    }
    this.#channel.postMessage(envelope);
  }

  subscribe(listener: (envelope: unknown) => void): () => void {
    if (this.#closed) {
      throw new TabLoomError(
        'BROKER_STOPPED',
        'The browser transport is closed.',
      );
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#listeners.clear();
    this.#channel.close();
  }
}
