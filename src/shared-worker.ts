import {
  CryptoIdProvider,
  NoopTelemetry,
  SystemClock,
} from './adapters/runtime.js';
import { createBrowserBroker } from './browser.js';
import { PassiveElection } from './browser/passive-election.js';
import { SharedWorkerClientTransport } from './browser/shared-worker/client-transport.js';
import type { MessagePortLike } from './browser/shared-worker/message-port.js';
import {
  createSharedWorkerBrokerHost,
  probeSharedWorkerCapabilities,
  type SharedWorkerBrokerHost,
  type SharedWorkerBrokerHostOptions,
  type SharedWorkerConnectEventLike,
  type SharedWorkerScopeLike,
} from './browser/shared-worker/host.js';
import { TabLoomBroker } from './core/broker.js';
import { parseBrokerConfig, type BrokerConfigInput } from './core/config.js';
import { TabLoomError } from './core/errors.js';
import type { InferenceAdapter, TelemetryPort } from './core/types.js';

export type BrowserBrokerTopology = 'page-owner' | 'shared-worker';
export type BrowserBrokerTopologyMode = 'auto' | BrowserBrokerTopology;

export interface SharedWorkerLike {
  readonly port: MessagePortLike;
}

export type SharedWorkerFactory = (
  options: Readonly<{ name: string; type: 'module' }>,
) => SharedWorkerLike;

interface SharedWorkerTopologyBaseOptions {
  readonly handshakeTimeoutMs?: number;
  readonly lifecyclePolicy?: 'best-effort' | 'portable';
  readonly mode: 'auto' | 'shared-worker';
  readonly name?: string;
  readonly requiredCapabilities?: readonly string[];
}

export type SharedWorkerTopologyOptions =
  | { readonly mode: 'page-owner' }
  | (SharedWorkerTopologyBaseOptions &
      (
        | {
            readonly url: string | URL;
            readonly workerFactory?: never;
          }
        | {
            readonly url?: never;
            readonly workerFactory: SharedWorkerFactory;
          }
      ));

export interface AdaptiveBrowserBrokerOptions<TRequest, TChunk, TResult> {
  readonly adapter: InferenceAdapter<TRequest, TChunk, TResult>;
  readonly config: BrokerConfigInput;
  readonly telemetry?: TelemetryPort;
  readonly topology: SharedWorkerTopologyOptions;
}

export interface BrowserBrokerSelection<TRequest, TChunk, TResult> {
  readonly broker: TabLoomBroker<TRequest, TChunk, TResult>;
  readonly fallbackReason?: 'TOPOLOGY_UNAVAILABLE' | 'TRANSPORT_FAILED';
  readonly topology: BrowserBrokerTopology;
}

export async function createSharedWorkerBroker<TRequest, TChunk, TResult>(
  options: AdaptiveBrowserBrokerOptions<TRequest, TChunk, TResult>,
): Promise<BrowserBrokerSelection<TRequest, TChunk, TResult>> {
  if (options.topology.mode !== 'shared-worker') {
    throw new TabLoomError(
      'INVALID_CONFIG',
      'createSharedWorkerBroker requires shared-worker mode.',
    );
  }
  return connectSharedWorkerBroker(options);
}

async function connectSharedWorkerBroker<TRequest, TChunk, TResult>(
  options: AdaptiveBrowserBrokerOptions<TRequest, TChunk, TResult>,
): Promise<BrowserBrokerSelection<TRequest, TChunk, TResult>> {
  if (options.topology.mode === 'page-owner') {
    throw new TabLoomError(
      'INVALID_CONFIG',
      'createSharedWorkerBroker requires shared-worker mode.',
    );
  }
  const config = parseBrokerConfig(options.config);
  const factoryOptions = {
    name: options.topology.name ?? `tabloom:${config.namespace}`,
    type: 'module' as const,
  };
  let worker: SharedWorkerLike;
  try {
    worker =
      options.topology.workerFactory === undefined
        ? createNativeSharedWorker(options.topology.url, factoryOptions)
        : options.topology.workerFactory(factoryOptions);
  } catch (error) {
    throw new TabLoomError(
      'TOPOLOGY_UNAVAILABLE',
      'SharedWorker could not be constructed.',
      {},
      error instanceof Error ? { cause: error } : undefined,
    );
  }

  let transport: SharedWorkerClientTransport;
  try {
    transport = new SharedWorkerClientTransport({
      ...(options.topology.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.topology.handshakeTimeoutMs }),
      namespace: config.namespace,
      port: worker.port,
      ...(options.topology.requiredCapabilities === undefined
        ? {}
        : { requiredCapabilities: options.topology.requiredCapabilities }),
      runtimeFingerprint: config.runtimeFingerprint,
    });
  } catch (error) {
    worker.port.close();
    throw error;
  }
  try {
    await transport.connect();
  } catch (error) {
    transport.close();
    throw error;
  }
  const broker = new TabLoomBroker(config, {
    adapter: options.adapter,
    clock: new SystemClock(),
    election: new PassiveElection(),
    ids: new CryptoIdProvider(),
    telemetry: options.telemetry ?? new NoopTelemetry(),
    transport,
  });
  return { broker, topology: 'shared-worker' };
}

export async function createAdaptiveBrowserBroker<TRequest, TChunk, TResult>(
  options: AdaptiveBrowserBrokerOptions<TRequest, TChunk, TResult>,
): Promise<BrowserBrokerSelection<TRequest, TChunk, TResult>> {
  if (options.topology.mode === 'page-owner') {
    return {
      broker: createBrowserBroker(options),
      topology: 'page-owner',
    };
  }
  if (
    options.topology.mode === 'auto' &&
    options.topology.lifecyclePolicy !== 'best-effort' &&
    !probeSharedWorkerLifecycleCompatibility()
  ) {
    return {
      broker: createBrowserBroker(options),
      fallbackReason: 'TOPOLOGY_UNAVAILABLE',
      topology: 'page-owner',
    };
  }
  try {
    return await connectSharedWorkerBroker(options);
  } catch (error) {
    if (
      options.topology.mode !== 'auto' ||
      !(error instanceof TabLoomError) ||
      (error.code !== 'TOPOLOGY_UNAVAILABLE' &&
        error.code !== 'TRANSPORT_FAILED')
    ) {
      throw error;
    }
    return {
      broker: createBrowserBroker(options),
      fallbackReason: error.code,
      topology: 'page-owner',
    };
  }
}

export function probeSharedWorkerLifecycleCompatibility(
  userAgent?: string,
): boolean {
  const resolvedUserAgent =
    userAgent ??
    ((Reflect.get(globalThis, 'navigator') as Navigator | undefined)
      ?.userAgent ||
      '');
  if (!/AppleWebKit\//u.test(resolvedUserAgent)) {
    return true;
  }
  if (/(?:iPad|iPhone|iPod)/u.test(resolvedUserAgent)) {
    return false;
  }
  return /(?:Chrome|Chromium|Edg|OPR)\//u.test(resolvedUserAgent);
}

function createNativeSharedWorker(
  url: string | URL,
  options: Readonly<{ name: string; type: 'module' }>,
): SharedWorkerLike {
  const Constructor = Reflect.get(globalThis, 'SharedWorker') as
    typeof SharedWorker | undefined;
  if (Constructor === undefined) {
    throw new TabLoomError(
      'TOPOLOGY_UNAVAILABLE',
      'SharedWorker is unavailable in this browser.',
    );
  }
  return new Constructor(url, options);
}

export {
  createSharedWorkerBrokerHost,
  probeSharedWorkerCapabilities,
  type SharedWorkerBrokerHost,
  type SharedWorkerBrokerHostOptions,
  type SharedWorkerConnectEventLike,
  type SharedWorkerScopeLike,
};
export type { MessagePortLike };
