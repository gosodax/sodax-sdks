/** Pins the Horizon reserve helpers. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  isHorizonNotFound,
  parseBaseReserveStroops,
  readReserveInfo,
  StellarReserveInfo,
  xlmDecimalToStroops,
} from './horizon.js';

describe('sponsoring/internal/horizon', () => {
  it('pins each result', () => {
    expectTypeOf<ReturnType<typeof isHorizonNotFound>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof xlmDecimalToStroops>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof parseBaseReserveStroops>>().toEqualTypeOf<bigint | undefined>();
    expectTypeOf<ReturnType<typeof readReserveInfo>>().toEqualTypeOf<StellarReserveInfo>();
    expectTypeOf<StellarReserveInfo>().toEqualTypeOf<{
      nativeBalanceStroops: bigint;
      availableBalanceStroops: bigint;
    }>();
  });
});
