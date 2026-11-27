import { describe, expect, it } from 'vitest';
import { isTerminalSwapIntentStatus } from './isTerminalSwapIntentStatus.js';

// Tested as a pure predicate: dapp-kit's vitest runs in `node`, with no hook rendering.
describe('isTerminalSwapIntentStatus', () => {
  it('is terminal for SOLVED (3) and FAILED (4)', () => {
    expect(isTerminalSwapIntentStatus(3)).toBe(true);
    expect(isTerminalSwapIntentStatus(4)).toBe(true);
  });

  it('is non-terminal for NOT_FOUND (-1), NOT_STARTED_YET (1), and STARTED_NOT_FINISHED (2)', () => {
    expect(isTerminalSwapIntentStatus(-1)).toBe(false);
    expect(isTerminalSwapIntentStatus(1)).toBe(false);
    expect(isTerminalSwapIntentStatus(2)).toBe(false);
  });

  it('is non-terminal when no status has arrived yet (undefined) — keeps polling', () => {
    expect(isTerminalSwapIntentStatus(undefined)).toBe(false);
  });
});
