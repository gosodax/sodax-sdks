/**
 * Compile-time contract: `useCreateSupplyLiquidityParams` takes the supply form state and returns the
 * chain-agnostic supply / increase-liquidity params, with the optional position the increase targets.
 */
import type { ClIncreaseLiquidityParams, ClSupplyParams, PoolData, PoolKey, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useCreateSupplyLiquidityParams } from './useCreateSupplyLiquidityParams.js';

describe('useCreateSupplyLiquidityParams', () => {
  it('takes the supply form state', () => {
    expectTypeOf<Parameters<typeof useCreateSupplyLiquidityParams>>().toEqualTypeOf<
      [
        {
          poolData: PoolData;
          poolKey: PoolKey;
          minPrice: string;
          maxPrice: string;
          liquidityToken0Amount: string;
          liquidityToken1Amount: string;
          slippageTolerance: string | number;
          positionId?: string | null;
          isValidPosition?: boolean;
        },
      ]
    >();
  });

  it('returns the supply params without the source chain and address', () => {
    expectTypeOf<ReturnType<typeof useCreateSupplyLiquidityParams>>().toEqualTypeOf<
      Omit<ClSupplyParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress'> &
        Omit<ClIncreaseLiquidityParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress' | 'tokenId'> & {
          tokenId?: string | bigint;
          positionId?: string | null;
          isValidPosition?: boolean;
        }
    >();
  });
});
