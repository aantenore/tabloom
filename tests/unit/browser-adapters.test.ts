import { afterEach, describe, expect, it } from 'vitest';
import { DeterministicInferenceAdapter } from '../../src/adapters/deterministic.js';
import { createBrowserBroker } from '../../src/browser.js';
import { BrowserBroadcastTransport } from '../../src/browser/broadcast-channel-transport.js';
import {
  BrowserStorageEpochStore,
  BrowserWebLockElection,
} from '../../src/browser/web-lock-election.js';
import { TabLoomError } from '../../src/core/errors.js';

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

class ImmediateLockManager implements LockManager {
  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({ held: [], pending: [] });
  }

  request<T>(
    name: string,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  request<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    callback?: LockGrantedCallback<T>,
  ): Promise<Awaited<T>> {
    const granted =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    if (granted === undefined) {
      throw new Error('A lock callback is required.');
    }
    return Promise.resolve(granted({ mode: 'exclusive', name }));
  }
}

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator',
);
const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
  globalThis,
  'BroadcastChannel',
);
const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
);

afterEach(() => {
  if (originalNavigator === undefined) {
    Reflect.deleteProperty(globalThis, 'navigator');
  } else {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  }
  if (originalBroadcastChannel === undefined) {
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
  } else {
    Object.defineProperty(
      globalThis,
      'BroadcastChannel',
      originalBroadcastChannel,
    );
  }
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } else {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  }
});

describe('browser adapters', () => {
  it('advances a persistent epoch', () => {
    const storage = new MemoryStorage();
    const epochs = new BrowserStorageEpochStore('test', storage);
    expect(epochs.advance()).toBe(1);
    expect(epochs.advance()).toBe(2);
  });

  it('fails closed for corrupted epoch state', () => {
    const storage = new MemoryStorage();
    storage.setItem('tabloom:test:epoch', 'bad');
    const epochs = new BrowserStorageEpochStore('test', storage);
    expect(() => epochs.advance()).toThrowError(TabLoomError);
  });

  it('normalizes storage failures as capability errors', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('blocked');
    };
    const epochs = new BrowserStorageEpochStore('test', storage);
    expect(() => epochs.advance()).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('normalizes missing default storage as a capability error', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(() => new BrowserStorageEpochStore('test')).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('holds and releases a native lock lease', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { locks: new ImmediateLockManager() },
    });
    const election = new BrowserWebLockElection('test', { advance: () => 9 });
    let observedEpoch = 0;
    await election.start(async (lease) => {
      observedEpoch = lease.epoch;
      await new Promise<void>((resolve) =>
        lease.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    });
    await waitFor(() => observedEpoch === 9);
    await election.stop();
    expect(observedEpoch).toBe(9);
  });

  it('reports a missing lock capability', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
    const election = new BrowserWebLockElection('test', { advance: () => 1 });
    expect(() => election.start(() => Promise.resolve())).toThrowError(
      TabLoomError,
    );
  });

  it('reports a missing navigator as a lock capability error', () => {
    Reflect.deleteProperty(globalThis, 'navigator');
    const election = new BrowserWebLockElection('test', { advance: () => 1 });
    expect(() => election.start(() => Promise.resolve())).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('surfaces a campaign failure during shutdown', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { locks: new ImmediateLockManager() },
    });
    const election = new BrowserWebLockElection('test', {
      advance: () => {
        throw new Error('epoch failed');
      },
    });
    await election.start(() => Promise.resolve());
    await expect(election.stop()).rejects.toThrow('epoch failed');
  });

  it('moves validated messages between native channels', async () => {
    const namespace = `test-${crypto.randomUUID()}`;
    const first = new BrowserBroadcastTransport(namespace);
    const second = new BrowserBroadcastTransport(namespace);
    const received = new Promise<unknown>((resolve) =>
      second.subscribe(resolve),
    );
    first.send({
      kind: 'presence',
      messageId: 'message-1',
      protocolVersion: 1,
      sentAt: 1,
      sourceId: 'tab-a',
      supportedVersions: [1],
    });
    await expect(received).resolves.toMatchObject({ kind: 'presence' });
    first.close();
    first.close();
    first.send({
      kind: 'presence',
      messageId: 'ignored',
      protocolVersion: 1,
      sentAt: 2,
      sourceId: 'tab-a',
      supportedVersions: [1],
    });
    expect(() => first.subscribe(() => undefined)).toThrowError(TabLoomError);
    second.close();
  });

  it('reports a missing channel capability', () => {
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    expect(() => new BrowserBroadcastTransport('test')).toThrowError(
      TabLoomError,
    );
  });

  it('normalizes channel construction failures', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: class FailingBroadcastChannel {
        constructor() {
          throw new Error('blocked');
        }
      },
    });
    expect(() => new BrowserBroadcastTransport('test')).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('validates browser configuration before allocating capabilities', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: class FailingBroadcastChannel {
        constructor() {
          throw new Error('must not be constructed');
        }
      },
    });
    expect(() =>
      createBrowserBroker({
        adapter: new DeterministicInferenceAdapter(),
        config: { namespace: 'not valid' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached.');
}
