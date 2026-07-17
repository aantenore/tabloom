import { TabLoomError } from '../core/errors.js';
import type {
  ClockPort,
  IdPort,
  SafeTelemetryEvent,
  TelemetryPort,
} from '../core/types.js';

export class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }

  setInterval(callback: () => void, delayMs: number): unknown {
    return globalThis.setInterval(callback, delayMs);
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    return globalThis.setTimeout(callback, delayMs);
  }

  clearInterval(handle: unknown): void {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
  }

  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

export class CryptoIdProvider implements IdPort {
  next(): string {
    const cryptoProvider = Reflect.get(globalThis, 'crypto') as
      Partial<Crypto> | undefined;
    if (typeof cryptoProvider?.randomUUID !== 'function') {
      throw new TabLoomError(
        'CAPABILITY_UNAVAILABLE',
        'A cryptographic UUID provider is required.',
      );
    }
    return cryptoProvider.randomUUID();
  }
}

export class SequenceIdProvider implements IdPort {
  #nextValue = 0;
  #prefix: string;

  constructor(prefix = 'id') {
    this.#prefix = prefix;
  }

  next(): string {
    this.#nextValue += 1;
    return `${this.#prefix}-${this.#nextValue}`;
  }
}

export class NoopTelemetry implements TelemetryPort {
  record(): void {}
}

export class CollectingTelemetry implements TelemetryPort {
  readonly events: SafeTelemetryEvent[] = [];

  record(event: SafeTelemetryEvent): void {
    this.events.push(event);
  }
}
