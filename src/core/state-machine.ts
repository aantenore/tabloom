import { TabLoomError } from './errors.js';
import type { BrokerReadiness, BrokerRole } from './types.js';

export interface BrokerMachineState {
  readonly epoch: number;
  readonly leaderId?: string;
  readonly readiness: BrokerReadiness;
  readonly role: BrokerRole;
}

export type BrokerMachineAction =
  | { readonly type: 'adapter-ready' }
  | { readonly epoch: number; readonly type: 'leadership-granted' }
  | { readonly type: 'leadership-lost' }
  | {
      readonly epoch: number;
      readonly leaderId: string;
      readonly readiness: 'initializing' | 'ready';
      readonly type: 'leader-observed';
    }
  | { readonly type: 'start' }
  | { readonly type: 'stop' };

export const initialBrokerMachineState: BrokerMachineState = {
  epoch: 0,
  readiness: 'idle',
  role: 'stopped',
};

export function transitionBrokerState(
  state: BrokerMachineState,
  action: BrokerMachineAction,
): BrokerMachineState {
  switch (action.type) {
    case 'start':
      return state.role === 'stopped'
        ? { epoch: state.epoch, readiness: 'idle', role: 'candidate' }
        : state;
    case 'leadership-granted': {
      if (action.epoch <= state.epoch) {
        throw new TabLoomError(
          'ADAPTER_FAILED',
          'Leadership epoch must advance monotonically.',
          { currentEpoch: state.epoch, proposedEpoch: action.epoch },
        );
      }
      return {
        epoch: action.epoch,
        readiness: 'initializing',
        role: 'leader',
      };
    }
    case 'adapter-ready':
      return state.role === 'leader' ? { ...state, readiness: 'ready' } : state;
    case 'leader-observed':
      if (state.role === 'leader' || action.epoch < state.epoch) {
        return state;
      }
      if (
        action.epoch === state.epoch &&
        state.leaderId !== undefined &&
        state.leaderId !== action.leaderId
      ) {
        return state;
      }
      return {
        epoch: action.epoch,
        leaderId: action.leaderId,
        readiness: action.readiness,
        role: 'peer',
      };
    case 'leadership-lost':
      return state.role === 'leader'
        ? { epoch: state.epoch, readiness: 'idle', role: 'candidate' }
        : state;
    case 'stop':
      return { epoch: state.epoch, readiness: 'stopped', role: 'stopped' };
  }
}
