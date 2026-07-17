import { describe, expect, it } from 'vitest';
import { TabLoomError } from '../../src/core/errors.js';
import {
  initialBrokerMachineState,
  transitionBrokerState,
} from '../../src/core/state-machine.js';

describe('broker state machine', () => {
  it('moves through candidate, leader, ready, and stopped states', () => {
    const candidate = transitionBrokerState(initialBrokerMachineState, {
      type: 'start',
    });
    const leader = transitionBrokerState(candidate, {
      epoch: 1,
      type: 'leadership-granted',
    });
    const ready = transitionBrokerState(leader, { type: 'adapter-ready' });
    const stopped = transitionBrokerState(ready, { type: 'stop' });

    expect(candidate).toMatchObject({ readiness: 'idle', role: 'candidate' });
    expect(leader).toMatchObject({
      epoch: 1,
      readiness: 'initializing',
      role: 'leader',
    });
    expect(ready).toMatchObject({ readiness: 'ready', role: 'leader' });
    expect(stopped).toMatchObject({
      epoch: 1,
      readiness: 'stopped',
      role: 'stopped',
    });
  });

  it('ignores stale and conflicting owner observations', () => {
    const candidate = transitionBrokerState(initialBrokerMachineState, {
      type: 'start',
    });
    const observed = transitionBrokerState(candidate, {
      epoch: 4,
      leaderId: 'tab-a',
      readiness: 'ready',
      type: 'leader-observed',
    });
    const stale = transitionBrokerState(observed, {
      epoch: 3,
      leaderId: 'tab-b',
      readiness: 'ready',
      type: 'leader-observed',
    });
    const conflict = transitionBrokerState(observed, {
      epoch: 4,
      leaderId: 'tab-b',
      readiness: 'ready',
      type: 'leader-observed',
    });

    expect(stale).toBe(observed);
    expect(conflict).toBe(observed);
  });

  it('rejects an epoch that does not advance', () => {
    const peer = {
      epoch: 7,
      leaderId: 'tab-a',
      readiness: 'ready',
      role: 'peer',
    } as const;
    expect(() =>
      transitionBrokerState(peer, { epoch: 7, type: 'leadership-granted' }),
    ).toThrowError(TabLoomError);
  });

  it('returns a leader to candidate when its lease ends', () => {
    const next = transitionBrokerState(
      { epoch: 2, readiness: 'ready', role: 'leader' },
      { type: 'leadership-lost' },
    );
    expect(next).toEqual({ epoch: 2, readiness: 'idle', role: 'candidate' });
  });

  it('leaves irrelevant transitions unchanged', () => {
    const candidate = transitionBrokerState(initialBrokerMachineState, {
      type: 'start',
    });
    expect(transitionBrokerState(candidate, { type: 'start' })).toBe(candidate);
    expect(transitionBrokerState(candidate, { type: 'adapter-ready' })).toBe(
      candidate,
    );
    expect(transitionBrokerState(candidate, { type: 'leadership-lost' })).toBe(
      candidate,
    );
  });

  it('does not let an observed owner displace a local lease', () => {
    const leader = { epoch: 3, readiness: 'ready', role: 'leader' } as const;
    expect(
      transitionBrokerState(leader, {
        epoch: 4,
        leaderId: 'other',
        readiness: 'ready',
        type: 'leader-observed',
      }),
    ).toBe(leader);
  });
});
