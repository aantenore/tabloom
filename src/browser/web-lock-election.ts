import { TabLoomError } from '../core/errors.js';
import type { ElectionPort, LeadershipLease } from '../core/types.js';

export interface EpochStore {
  advance(): number;
}

export class BrowserStorageEpochStore implements EpochStore {
  #key: string;
  #storage: Storage;

  constructor(namespace: string, storage: Storage = globalThis.localStorage) {
    this.#key = `tabloom:${namespace}:epoch`;
    this.#storage = storage;
  }

  advance(): number {
    try {
      const raw = this.#storage.getItem(this.#key);
      const current = raw === null ? 0 : Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new TabLoomError(
          'CAPABILITY_UNAVAILABLE',
          'The stored epoch is invalid.',
        );
      }
      const next = current + 1;
      if (!Number.isSafeInteger(next)) {
        throw new TabLoomError(
          'CAPABILITY_UNAVAILABLE',
          'The epoch counter is exhausted.',
        );
      }
      this.#storage.setItem(this.#key, String(next));
      if (this.#storage.getItem(this.#key) !== String(next)) {
        throw new TabLoomError(
          'CAPABILITY_UNAVAILABLE',
          'The epoch could not be persisted.',
        );
      }
      return next;
    } catch (error) {
      if (error instanceof TabLoomError) {
        throw error;
      }
      throw new TabLoomError(
        'CAPABILITY_UNAVAILABLE',
        'Same-origin storage is required for fenced leadership.',
        {},
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }
}

export class BrowserWebLockElection implements ElectionPort {
  #campaignAbort: AbortController | undefined;
  #campaignTask: Promise<void> | undefined;
  #epochStore: EpochStore;
  #leaderAbort: AbortController | undefined;
  #lockName: string;
  #started = false;

  constructor(
    namespace: string,
    epochStore: EpochStore = new BrowserStorageEpochStore(namespace),
  ) {
    this.#lockName = `tabloom:${namespace}:owner`;
    this.#epochStore = epochStore;
  }

  start(listener: (lease: LeadershipLease) => Promise<void>): Promise<void> {
    if (this.#started) {
      return Promise.resolve();
    }
    const lockManager = Reflect.get(navigator, 'locks') as
      LockManager | undefined;
    if (lockManager === undefined) {
      throw new TabLoomError(
        'CAPABILITY_UNAVAILABLE',
        'Web Locks is required for exclusive browser ownership.',
      );
    }
    this.#started = true;
    const campaignAbort = new AbortController();
    this.#campaignAbort = campaignAbort;
    this.#campaignTask = lockManager
      .request(
        this.#lockName,
        { mode: 'exclusive', signal: campaignAbort.signal },
        async () => {
          if (!this.#started || campaignAbort.signal.aborted) {
            return;
          }
          const leaderAbort = new AbortController();
          this.#leaderAbort = leaderAbort;
          const epoch = this.#epochStore.advance();
          try {
            await listener({ epoch, signal: leaderAbort.signal });
          } finally {
            this.#leaderAbort = undefined;
          }
        },
      )
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          throw error;
        }
      });
    void this.#campaignTask.catch(() => undefined);
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#leaderAbort?.abort();
    this.#campaignAbort?.abort();
    await this.#campaignTask;
    this.#campaignAbort = undefined;
    this.#campaignTask = undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
