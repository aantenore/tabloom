export const tabLoomErrorCodes = [
  'ADAPTER_FAILED',
  'BACKPRESSURE',
  'BROKER_STOPPED',
  'CANCELLED',
  'CAPABILITY_UNAVAILABLE',
  'EPOCH_JOURNAL_FAILED',
  'INVALID_CONFIG',
  'NO_LEADER',
  'PROTOCOL_MISMATCH',
  'RUNTIME_MISMATCH',
  'START_FAILED',
  'TIMEOUT',
  'TOPOLOGY_UNAVAILABLE',
  'TRANSPORT_FAILED',
] as const;

export type TabLoomErrorCode = (typeof tabLoomErrorCodes)[number];

export class TabLoomError extends Error {
  readonly code: TabLoomErrorCode;
  readonly details: Readonly<Record<string, number | string | boolean>>;

  constructor(
    code: TabLoomErrorCode,
    message: string,
    details: Readonly<Record<string, number | string | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TabLoomError';
    this.code = code;
    this.details = details;
  }
}

export function asTabLoomError(error: unknown): TabLoomError {
  if (error instanceof TabLoomError) {
    return error;
  }

  return new TabLoomError(
    'ADAPTER_FAILED',
    error instanceof Error ? error.message : 'The inference adapter failed.',
    {},
    error instanceof Error ? { cause: error } : undefined,
  );
}
