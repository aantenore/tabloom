import { describe, expect, it } from 'vitest';
import { asTabLoomError, TabLoomError } from '../../src/core/errors.js';

describe('error normalization', () => {
  it('keeps an existing typed error', () => {
    const error = new TabLoomError('TIMEOUT', 'Timed out.', { attempts: 1 });
    expect(asTabLoomError(error)).toBe(error);
  });

  it('wraps errors and unknown values safely', () => {
    expect(asTabLoomError(new Error('adapter detail'))).toMatchObject({
      code: 'ADAPTER_FAILED',
      message: 'adapter detail',
    });
    expect(asTabLoomError(42)).toMatchObject({
      code: 'ADAPTER_FAILED',
      message: 'The inference adapter failed.',
    });
  });
});
