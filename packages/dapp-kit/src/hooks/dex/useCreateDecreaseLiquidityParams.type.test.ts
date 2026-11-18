/**
 * Compile-time contract: `useCreateDecreaseLiquidityParams` takes the position and the percentage to
 * remove and always returns the chain-agnostic decrease-liquidity params core.
 */
import type { ClDecreaseLiquidityParams, ClPositionInfo, PoolKey, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useCreateDecreaseLiquidityParams } from './useCreateDecreaseLiquidityParams.js';

describe('useCreateDecreaseLiquidityParams', () => {
  it('takes the position and the share to remove', () => {
    expectTypeOf<Parameters<typeof useCreateDecreaseLiquidityParams>>().toEqualTypeOf<
      [
        {
          poolKey: PoolKey;
          tokenId: string | bigint;
          percentage: string | number;
          positionInfo: ClPositionInfo;
          slippageTolerance: string | number;
        },
      ]
    >();
  });

  it('returns the decrease params without the source chain and address', () => {
    expectTypeOf<ReturnType<typeof useCreateDecreaseLiquidityParams>>().toEqualTypeOf<
      Omit<ClDecreaseLiquidityParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress'>
    >();
  });
});
