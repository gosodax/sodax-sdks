import type { DestinationParamsType, PoolData, PoolSpokeAssets } from '@sodax/sdk';
import { useMemo } from 'react';
import { createWithdrawParamsProps, type WithdrawParamsCore } from '@/utils/dex-utils.js';

export type UseCreateWithdrawParamsProps = {
  tokenIndex: 0 | 1;
  amount: string | number;
  poolData: PoolData;
  poolSpokeAssets: PoolSpokeAssets;
  dst?: DestinationParamsType;
};

/** Memoizes the withdraw fields; callers add `srcChainKey` + `srcAddress` at mutation time. */
export function useCreateWithdrawParams({
  tokenIndex,
  amount,
  poolData,
  poolSpokeAssets,
  dst,
}: UseCreateWithdrawParamsProps): WithdrawParamsCore | undefined {
  return useMemo<WithdrawParamsCore | undefined>(() => {
    if (!amount || Number.parseFloat(String(amount)) <= 0) {
      return undefined;
    }
    return createWithdrawParamsProps({ tokenIndex, amount, poolData, poolSpokeAssets, dst });
  }, [tokenIndex, amount, poolData, poolSpokeAssets, dst]);
}
