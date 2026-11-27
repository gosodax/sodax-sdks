import { describe, expect, it } from 'vitest';
import { isTerminalSwapIntentStatus } from './isTerminalSwapIntentStatus.js';

/**
 * Guards the polling-stop invariant for `useSwapsApiStatus.refetchInterval`: the hook keeps polling
 * (1s) until the solver reports a terminal status, then stops. Tested as a pure predicate because
 * dapp-kit's vitest runs in the `node` environment (no hook rendering) — see nearStorageGate.test.ts.
 */
describe('isTerminalSwapIntentStatus', () => {
  it('is terminal for SOLVED (3) and FAILED (4)', () => {
    expect(isTerminalSwapIntentStatus(3)).toBe(true);
    expect(isTerminalSwapIntentStatus(4)).toBe(true);
  });

  it('is non-terminal for NOT_FOUND (-1), NOT_STARTED_YET (1), STARTED_NOT_FINISHED (2) and no status yet', () => {
    expect(isTerminalSwapIntentStatus(-1)).toBe(false);
    expect(isTerminalSwapIntentStatus(1)).toBe(false);
    expect(isTerminalSwapIntentStatus(2)).toBe(false);
    expect(isTerminalSwapIntentStatus(undefined)).toBe(false);
  });
});
