import { createSupplyLiquidityParamsProps } from '@/utils/dex-utils.js';
import type { ClSupplyParams, ClIncreaseLiquidityParams, PoolData, PoolKey } from '@sodax/sdk';
import type { SpokeChainKey } from '@sodax/sdk';
import { useMemo } from 'react';

export type UseCreateSupplyLiquidityParamsProps = {
  poolData: PoolData;
  poolKey: PoolKey;
  minPrice: string;
  maxPrice: string;
  liquidityToken0Amount: string;
  liquidityToken1Amount: string;
  slippageTolerance: string | number;
  positionId?: string | null;
  isValidPosition?: boolean;
};

/** `tokenId` + `isValidPosition` select increase-existing over mint-new; callers add `srcChainKey` + `srcAddress`. */
export type UseCreateSupplyLiquidityParamsResult = Omit<ClSupplyParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress'> &
  Omit<ClIncreaseLiquidityParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress' | 'tokenId'> & {
    tokenId?: string | bigint;
    positionId?: string | null;
    isValidPosition?: boolean;
  };

export function useCreateSupplyLiquidityParams({
  poolData,
  poolKey,
  minPrice,
  maxPrice,
  liquidityToken0Amount,
  liquidityToken1Amount,
  slippageTolerance,
  positionId,
  isValidPosition,
}: UseCreateSupplyLiquidityParamsProps): UseCreateSupplyLiquidityParamsResult {
  return useMemo<UseCreateSupplyLiquidityParamsResult>(() => {
    return createSupplyLiquidityParamsProps({
      poolData,
      poolKey,
      minPrice,
      maxPrice,
      liquidityToken0Amount,
      liquidityToken1Amount,
      slippageTolerance,
      positionId,
      isValidPosition,
    });
  }, [
    minPrice,
    maxPrice,
    liquidityToken0Amount,
    liquidityToken1Amount,
    slippageTolerance,
    poolData,
    poolKey,
    positionId,
    isValidPosition,
  ]);
}
