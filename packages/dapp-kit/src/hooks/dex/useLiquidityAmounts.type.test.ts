/**
 * Compile-time contract: `useLiquidityAmounts` takes the price range and pool, and returns both token
 * amounts as strings with their setters and paired change handlers.
 */
import type { PoolData } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useLiquidityAmounts } from './useLiquidityAmounts.js';

describe('useLiquidityAmounts', () => {
  it('takes the price range and an optional pool', () => {
    expectTypeOf<Parameters<typeof useLiquidityAmounts>>().toEqualTypeOf<
      [minPrice: string, maxPrice: string, poolData: PoolData | null]
    >();
  });

  it('returns the amounts, the last edited side and the handlers', () => {
    expectTypeOf<ReturnType<typeof useLiquidityAmounts>>().toEqualTypeOf<{
      liquidityToken0Amount: string;
      liquidityToken1Amount: string;
      lastEditedToken: 'token0' | 'token1' | null;
      setLiquidityToken0Amount: (value: string) => void;
      setLiquidityToken1Amount: (value: string) => void;
      handleToken0AmountChange: (value: string) => void;
      handleToken1AmountChange: (value: string) => void;
    }>();
  });
});
