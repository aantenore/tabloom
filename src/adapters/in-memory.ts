import type { ProtocolEnvelope } from '../core/protocol.js';
import type {
  ElectionPort,
  LeadershipLease,
  TransportPort,
} from '../core/types.js';

interface ElectionCandidate {
  readonly id: string;
  readonly listener: (lease: LeadershipLease) => Promise<void>;
  readonly port: InMemoryElectionPort;
}

export class InMemoryElectionCoordinator {
  #candidates: ElectionCandidate[] = [];
  #epoch = 0;
  #leader: ElectionCandidate | undefined;

  createPort(id: string): InMemoryElectionPort {
    return new InMemoryElectionPort(id, this);
  }

  register(candidate: ElectionCandidate): void {
    this.#candidates.push(candidate);
    this.#grantNext();
  }

  unregister(port: InMemoryElectionPort): void {
    this.#candidates = this.#candidates.filter(
      (candidate) => candidate.port !== port,
    );
    if (this.#leader?.port === port) {
      this.#leader = undefined;
    }
    this.#grantNext();
  }

  #grantNext(): void {
    if (this.#leader !== undefined) {
      return;
    }
    const candidate = this.#candidates[0];
    if (candidate === undefined) {
      return;
    }
    this.#leader = candidate;
    this.#epoch += 1;
    candidate.port.grant(this.#epoch, candidate.listener, () => {
      if (this.#leader?.port === candidate.port) {
        this.#leader = undefined;
        this.#candidates = this.#candidates.filter(
          (item) => item.port !== candidate.port,
        );
        this.#grantNext();
      }
    });
  }
}

export class InMemoryElectionPort implements ElectionPort {
  #controller: AbortController | undefined;
  #coordinator: InMemoryElectionCoordinator;
  #id: string;
  #started = false;
  #task: Promise<void> | undefined;

  constructor(id: string, coordinator: InMemoryElectionCoordinator) {
    this.#id = id;
    this.#coordinator = coordinator;
  }

  start(listener: (lease: LeadershipLease) => Promise<void>): Promise<void> {
    if (this.#started) {
      return Promise.resolve();
    }
    this.#started = true;
    this.#coordinator.register({ id: this.#id, listener, port: this });
    return Promise.resolve();
  }

  grant(
    epoch: number,
    listener: (lease: LeadershipLease) => Promise<void>,
    released: () => void,
  ): void {
    if (!this.#started) {
      released();
      return;
    }
    const controller = new AbortController();
    this.#controller = controller;
    this.#task = listener({ epoch, signal: controller.signal }).finally(() => {
      this.#controller = undefined;
      released();
    });
  }

  async stop(): Promise<void> {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#controller?.abort();
    this.#coordinator.unregister(this);
    await this.#task;
    this.#task = undefined;
  }
}

export class InMemoryTransportHub {
  #ports = new Map<string, InMemoryTransportPort>();

  createPort(id: string): InMemoryTransportPort {
    const port = new InMemoryTransportPort(id, this);
    this.#ports.set(id, port);
    return port;
  }

  close(id: string): void {
    this.#ports.delete(id);
  }

  publish(sourceId: string, envelope: ProtocolEnvelope): void {
    for (const [id, port] of this.#ports) {
      if (id !== sourceId) {
        queueMicrotask(() => port.deliver(envelope));
      }
    }
  }
}

export class InMemoryTransportPort implements TransportPort {
  #closed = false;
  #hub: InMemoryTransportHub;
  #id: string;
  #listeners = new Set<(envelope: unknown) => void>();

  constructor(id: string, hub: InMemoryTransportHub) {
    this.#id = id;
    this.#hub = hub;
  }

  send(envelope: ProtocolEnvelope): void {
    if (!this.#closed) {
      this.#hub.publish(this.#id, envelope);
    }
  }

  subscribe(listener: (envelope: unknown) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  deliver(envelope: unknown): void {
    if (this.#closed) {
      return;
    }
    for (const listener of this.#listeners) {
      listener(envelope);
    }
  }

  close(): void {
    this.#closed = true;
    this.#listeners.clear();
    this.#hub.close(this.#id);
  }
}
