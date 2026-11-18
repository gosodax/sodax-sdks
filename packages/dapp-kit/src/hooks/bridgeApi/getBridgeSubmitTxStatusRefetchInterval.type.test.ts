/** Pins getBridgeSubmitTxStatusRefetchInterval: a poll interval in ms, or `false` to stop. */
import type { BridgeSubmitTxStatusDataV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { getBridgeSubmitTxStatusRefetchInterval } from './getBridgeSubmitTxStatusRefetchInterval.js';

describe('getBridgeSubmitTxStatusRefetchInterval', () => {
  it('takes the query error and the status record', () => {
    // `error` is React Query's caught error, legitimately unknown.
    expectTypeOf<Parameters<typeof getBridgeSubmitTxStatusRefetchInterval>>().toEqualTypeOf<
      [error: unknown, data: BridgeSubmitTxStatusDataV2 | undefined]
    >();
  });

  it('returns an interval or false', () => {
    expectTypeOf<ReturnType<typeof getBridgeSubmitTxStatusRefetchInterval>>().toEqualTypeOf<number | false>();
  });
});
