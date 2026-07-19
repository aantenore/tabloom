import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbEpochStore } from '../../src/browser/indexeddb-epoch-store.js';
import { TabLoomError } from '../../src/core/errors.js';
import { TEST_RUNTIME_FINGERPRINT } from '../runtime-fixture.js';

const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'indexedDB',
);

afterEach(() => {
  if (originalIndexedDbDescriptor !== undefined) {
    Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor);
  }
});

describe('IndexedDB epoch store', () => {
  it('serializes concurrent increments across store instances', async () => {
    const databaseName = uniqueDatabaseName();
    const first = new IndexedDbEpochStore(
      'shared-runtime',
      TEST_RUNTIME_FINGERPRINT,
      { databaseName },
    );
    const second = new IndexedDbEpochStore(
      'shared-runtime',
      TEST_RUNTIME_FINGERPRINT,
      { databaseName },
    );

    const epochs = await Promise.all([first.advance(), second.advance()]);
    expect(epochs.toSorted()).toEqual([1, 2]);
    await expect(first.advance()).resolves.toBe(3);
  });

  it.each([
    ['', TEST_RUNTIME_FINGERPRINT, 'valid-database'],
    ['bad namespace', TEST_RUNTIME_FINGERPRINT, 'valid-database'],
    ['valid', 'invalid', 'valid-database'],
    ['valid', TEST_RUNTIME_FINGERPRINT, ' padded '],
  ])(
    'rejects invalid journal configuration %#',
    (namespace, fingerprint, databaseName) => {
      expect(
        () => new IndexedDbEpochStore(namespace, fingerprint, { databaseName }),
      ).toThrowError(TabLoomError);
    },
  );

  it('rejects a corrupted stored record', async () => {
    const databaseName = uniqueDatabaseName();
    const database = await openEpochDatabase(databaseName);
    await database.put('epochs', { epoch: 'corrupt' }, 'corrupt-runtime');
    database.close();

    const store = new IndexedDbEpochStore(
      'corrupt-runtime',
      TEST_RUNTIME_FINGERPRINT,
      { databaseName },
    );
    await expect(store.advance()).rejects.toMatchObject({
      code: 'EPOCH_JOURNAL_FAILED',
      message: 'The stored epoch record is invalid.',
    });
  });

  it('fails closed when the counter is exhausted', async () => {
    const databaseName = uniqueDatabaseName();
    const database = await openEpochDatabase(databaseName);
    await database.put(
      'epochs',
      {
        epoch: Number.MAX_SAFE_INTEGER,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        schemaVersion: 1,
        updatedAt: 1,
      },
      'exhausted-runtime',
    );
    database.close();

    const store = new IndexedDbEpochStore(
      'exhausted-runtime',
      TEST_RUNTIME_FINGERPRINT,
      { databaseName },
    );
    await expect(store.advance()).rejects.toMatchObject({
      code: 'EPOCH_JOURNAL_FAILED',
      message: 'The epoch counter is exhausted.',
    });
  });

  it('normalizes IndexedDB capability failures', async () => {
    Reflect.deleteProperty(globalThis, 'indexedDB');
    const store = new IndexedDbEpochStore(
      'missing-indexeddb',
      TEST_RUNTIME_FINGERPRINT,
      { databaseName: uniqueDatabaseName() },
    );
    await expect(store.advance()).rejects.toMatchObject({
      code: 'EPOCH_JOURNAL_FAILED',
      message: 'The IndexedDB epoch journal could not be advanced.',
    });
  });
});

function uniqueDatabaseName(): string {
  return `tabloom-test-${crypto.randomUUID()}`;
}

async function openEpochDatabase(databaseName: string) {
  return openDB(databaseName, 1, {
    upgrade(database) {
      database.createObjectStore('epochs');
    },
  });
}
