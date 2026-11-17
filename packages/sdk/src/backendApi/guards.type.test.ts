/**
 * Compile-time contract for `backendApi/guards.ts`: each guard narrows to its exact public type.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { FillEvent, OracleCandleInterval } from '../index.js';
import { isFillEvent, isOracleCandleInterval } from './guards.js';

describe('backendApi guards', () => {
  it('isFillEvent narrows an unknown journal entry to FillEvent', () => {
    expectTypeOf(isFillEvent).guards.toEqualTypeOf<FillEvent>();
    expectTypeOf(isFillEvent).parameter(0).toBeUnknown();
    expectTypeOf<FillEvent>().toEqualTypeOf<{
      eventType: 'intent-filled';
      txHash: string;
      intentState: { remainingInput: string };
    }>();
  });

  it('isOracleCandleInterval narrows a discovery key to the candle interval union', () => {
    expectTypeOf(isOracleCandleInterval).guards.toEqualTypeOf<OracleCandleInterval>();
    expectTypeOf<OracleCandleInterval>().toEqualTypeOf<'1m' | '5m' | '1h' | '1d'>();
  });
});
