import type { TabLoomError } from './errors.js';
import type { InferenceSession } from './types.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

interface IteratorWaiter<T> {
  reject(reason: unknown): void;
  resolve(result: IteratorResult<T>): void;
}

export class ManagedInferenceSession<
  TChunk,
  TResult,
> implements InferenceSession<TChunk, TResult> {
  readonly id: string;
  readonly result: Promise<TResult>;
  #attempt = 0;
  #cancelled = false;
  #cancelRequest: () => void;
  #chunks: TChunk[] = [];
  #epoch = 0;
  #failure: Error | undefined;
  #resultDeferred = createDeferred<TResult>();
  #seenSequences = new Set<number>();
  #terminal = false;
  #waiters: IteratorWaiter<TChunk>[] = [];

  constructor(id: string, cancelRequest: () => void) {
    this.id = id;
    this.#cancelRequest = cancelRequest;
    this.result = this.#resultDeferred.promise;
  }

  get attempt(): number {
    return this.#attempt;
  }

  get epoch(): number {
    return this.#epoch;
  }

  get isTerminal(): boolean {
    return this.#terminal;
  }

  beginAttempt(epoch: number): number {
    if (this.#terminal || epoch <= this.#epoch) {
      return this.#attempt;
    }
    this.#epoch = epoch;
    this.#attempt += 1;
    this.#seenSequences.clear();
    return this.#attempt;
  }

  acceptChunk(
    epoch: number,
    attempt: number,
    sequence: number,
    chunk: TChunk,
  ): boolean {
    if (
      this.#terminal ||
      epoch !== this.#epoch ||
      attempt !== this.#attempt ||
      this.#seenSequences.has(sequence)
    ) {
      return false;
    }
    this.#seenSequences.add(sequence);
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      this.#chunks.push(chunk);
    } else {
      waiter.resolve({ done: false, value: chunk });
    }
    return true;
  }

  complete(epoch: number, attempt: number, result: TResult): boolean {
    if (!this.#canTerminalize(epoch, attempt)) {
      return false;
    }
    this.#terminal = true;
    this.#resultDeferred.resolve(result);
    this.#finishIterators();
    return true;
  }

  fail(epoch: number, attempt: number, error: TabLoomError): boolean {
    if (!this.#canTerminalize(epoch, attempt)) {
      return false;
    }
    this.#terminal = true;
    this.#failure = error;
    this.#resultDeferred.reject(error);
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
    return true;
  }

  stop(error: TabLoomError): void {
    if (this.#terminal) {
      return;
    }
    this.#terminal = true;
    this.#failure = error;
    this.#resultDeferred.reject(error);
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  cancel(): void {
    if (this.#terminal || this.#cancelled) {
      return;
    }
    this.#cancelled = true;
    this.#cancelRequest();
  }

  [Symbol.asyncIterator](): AsyncIterator<TChunk> {
    return {
      next: () => this.#next(),
    };
  }

  #canTerminalize(epoch: number, attempt: number): boolean {
    return (
      !this.#terminal && epoch === this.#epoch && attempt === this.#attempt
    );
  }

  #finishIterators(): void {
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  #next(): Promise<IteratorResult<TChunk>> {
    const chunk = this.#chunks.shift();
    if (chunk !== undefined) {
      return Promise.resolve({ done: false, value: chunk });
    }
    if (this.#terminal) {
      return this.#failure === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.#failure);
    }
    const deferred = createDeferred<IteratorResult<TChunk>>();
    this.#waiters.push(deferred);
    return deferred.promise;
  }
}
