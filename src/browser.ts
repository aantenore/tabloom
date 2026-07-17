import {
  CryptoIdProvider,
  NoopTelemetry,
  SystemClock,
} from './adapters/runtime.js';
import { TabLoomBroker } from './core/broker.js';
import { parseBrokerConfig, type BrokerConfigInput } from './core/config.js';
import type { InferenceAdapter, TelemetryPort } from './core/types.js';
import { BrowserBroadcastTransport } from './browser/broadcast-channel-transport.js';
import {
  BrowserStorageEpochStore,
  BrowserWebLockElection,
} from './browser/web-lock-election.js';

export interface BrowserBrokerOptions<TRequest, TChunk, TResult> {
  readonly adapter: InferenceAdapter<TRequest, TChunk, TResult>;
  readonly config: BrokerConfigInput;
  readonly telemetry?: TelemetryPort;
}

export function createBrowserBroker<TRequest, TChunk, TResult>(
  options: BrowserBrokerOptions<TRequest, TChunk, TResult>,
): TabLoomBroker<TRequest, TChunk, TResult> {
  const config = parseBrokerConfig(options.config);
  const namespace = config.namespace;
  return new TabLoomBroker(config, {
    adapter: options.adapter,
    clock: new SystemClock(),
    election: new BrowserWebLockElection(
      namespace,
      new BrowserStorageEpochStore(namespace),
    ),
    ids: new CryptoIdProvider(),
    telemetry: options.telemetry ?? new NoopTelemetry(),
    transport: new BrowserBroadcastTransport(namespace),
  });
}

export { BrowserBroadcastTransport } from './browser/broadcast-channel-transport.js';
export {
  BrowserStorageEpochStore,
  BrowserWebLockElection,
  type EpochStore,
} from './browser/web-lock-election.js';
