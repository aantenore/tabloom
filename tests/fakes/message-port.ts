import type { MessagePortLike } from '../../src/browser/shared-worker/message-port.js';

export class MemoryMessagePort implements MessagePortLike {
  failPost = false;
  #closed = false;
  #listeners = new Map<
    'message' | 'messageerror',
    Set<(event: MessageEvent<unknown>) => void>
  >();
  #peer: MemoryMessagePort | undefined;

  get closed(): boolean {
    return this.#closed;
  }

  static pair(): readonly [MemoryMessagePort, MemoryMessagePort] {
    const first = new MemoryMessagePort();
    const second = new MemoryMessagePort();
    first.#peer = second;
    second.#peer = first;
    return [first, second];
  }

  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.#listeners.get(type)?.delete(listener);
  }

  postMessage(message: unknown): void {
    if (this.failPost) {
      throw new DOMException('Message could not be cloned.', 'DataCloneError');
    }
    const peer = this.#peer;
    if (this.#closed || peer === undefined || peer.#closed) {
      return;
    }
    const cloned = structuredClone(message);
    queueMicrotask(() => peer.#emit('message', cloned));
  }

  close(): void {
    this.#closed = true;
    this.#listeners.clear();
  }

  start(): void {}

  emitMessageError(): void {
    this.#emit('messageerror', undefined);
  }

  #emit(type: 'message' | 'messageerror', data: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}
