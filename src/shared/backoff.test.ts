import { describe, expect, it } from 'vitest';
import { nextDelayMs, shouldRetry, MAX_ATTEMPTS } from './backoff';

describe('backoff', () => {
  it('attempt 1 → 1 minute', () => {
    expect(nextDelayMs(1)).toBe(60_000);
  });
  it('attempt 2 → 5 minutes', () => {
    expect(nextDelayMs(2)).toBe(300_000);
  });
  it('attempt 3 → 15 minutes', () => {
    expect(nextDelayMs(3)).toBe(900_000);
  });
  it('attempts ≥ MAX_ATTEMPTS → null', () => {
    expect(nextDelayMs(MAX_ATTEMPTS + 1)).toBeNull();
  });
  it('shouldRetry honors MAX_ATTEMPTS', () => {
    expect(shouldRetry(MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS)).toBe(false);
  });
});
