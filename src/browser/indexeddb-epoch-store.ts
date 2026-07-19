import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { TabLoomError } from '../core/errors.js';
import {
  parseRuntimeFingerprint,
  runtimeFingerprintSchema,
} from '../core/runtime-fingerprint.js';
import type { EpochStore } from './web-lock-election.js';

const STORE_NAME = 'epochs';
const SCHEMA_VERSION = 1 as const;

const epochRecordSchema = z.object({
  epoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  runtimeFingerprint: runtimeFingerprintSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: z.number().int().nonnegative(),
});

type EpochRecord = z.infer<typeof epochRecordSchema>;

interface EpochDatabase extends DBSchema {
  readonly epochs: {
    readonly key: string;
    readonly value: EpochRecord;
  };
}

export interface IndexedDbEpochStoreOptions {
  readonly databaseName?: string;
}

export class IndexedDbEpochStore implements EpochStore {
  #databaseName: string;
  #databaseTask: Promise<IDBPDatabase<EpochDatabase>> | undefined;
  #namespace: string;
  #runtimeFingerprint: string;

  constructor(
    namespace: string,
    runtimeFingerprint: string,
    options: IndexedDbEpochStoreOptions = {},
  ) {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(namespace)) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'The epoch namespace is invalid.',
      );
    }
    this.#namespace = namespace;
    this.#runtimeFingerprint = parseRuntimeFingerprint(runtimeFingerprint);
    this.#databaseName = options.databaseName ?? 'tabloom-coordination';
    if (
      this.#databaseName.length === 0 ||
      this.#databaseName.length > 120 ||
      this.#databaseName !== this.#databaseName.trim()
    ) {
      throw new TabLoomError(
        'INVALID_CONFIG',
        'The epoch database name is invalid.',
      );
    }
  }

  async advance(): Promise<number> {
    try {
      const database = await this.#database();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const currentValue = await transaction.store.get(this.#namespace);
      const current =
        currentValue === undefined
          ? undefined
          : epochRecordSchema.safeParse(currentValue);
      if (current !== undefined && !current.success) {
        throw journalFailure('The stored epoch record is invalid.');
      }
      const currentEpoch = current?.data.epoch ?? 0;
      const nextEpoch = currentEpoch + 1;
      if (!Number.isSafeInteger(nextEpoch)) {
        throw journalFailure('The epoch counter is exhausted.');
      }
      await transaction.store.put(
        {
          epoch: nextEpoch,
          runtimeFingerprint: this.#runtimeFingerprint,
          schemaVersion: SCHEMA_VERSION,
          updatedAt: Date.now(),
        },
        this.#namespace,
      );
      await transaction.done;
      return nextEpoch;
    } catch (error) {
      if (
        error instanceof TabLoomError &&
        error.code === 'EPOCH_JOURNAL_FAILED'
      ) {
        throw error;
      }
      throw journalFailure(
        'The IndexedDB epoch journal could not be advanced.',
        error,
      );
    }
  }

  #database(): Promise<IDBPDatabase<EpochDatabase>> {
    this.#databaseTask ??= openDB<EpochDatabase>(this.#databaseName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      },
    });
    return this.#databaseTask;
  }
}

function journalFailure(message: string, cause?: unknown): TabLoomError {
  return new TabLoomError(
    'EPOCH_JOURNAL_FAILED',
    message,
    {},
    cause instanceof Error ? { cause } : undefined,
  );
}
