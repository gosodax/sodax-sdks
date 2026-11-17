/** Pins isTerminalSwapIntentStatus: a plain boolean over the wire status code, not a type guard. */
import type { SwapIntentStatusCodeV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { isTerminalSwapIntentStatus } from './isTerminalSwapIntentStatus.js';

describe('isTerminalSwapIntentStatus', () => {
  it('takes a status code, possibly missing, and returns a boolean', () => {
    expectTypeOf<typeof isTerminalSwapIntentStatus>().toEqualTypeOf<
      (status: SwapIntentStatusCodeV2 | undefined) => boolean
    >();
  });

  it('rejects a free-form status string', () => {
    const stringStatus = (check: typeof isTerminalSwapIntentStatus) =>
      // @ts-expect-error — the status is the numeric wire code
      check('solved');
    expectTypeOf(stringStatus).returns.toBeBoolean();
  });
});
