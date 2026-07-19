import type { ElectionPort } from '../core/types.js';

export class PassiveElection implements ElectionPort {
  #started = false;

  start(): Promise<void> {
    this.#started = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.#started = false;
    return Promise.resolve();
  }

  get started(): boolean {
    return this.#started;
  }
}
