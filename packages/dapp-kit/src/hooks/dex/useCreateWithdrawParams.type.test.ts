/**
 * Compile-time contract: `useCreateWithdrawParams` takes the withdraw form state and returns the
 * chain-agnostic withdraw params core, or `undefined` while the amount is empty or non-positive.
 */
import type {
  CreateAssetWithdrawParams,
  DestinationParamsType,
  PoolData,
  PoolSpokeAssets,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useCreateWithdrawParams } from './useCreateWithdrawParams.js';

describe('useCreateWithdrawParams', () => {
  it('takes the withdraw form state', () => {
    expectTypeOf<Parameters<typeof useCreateWithdrawParams>>().toEqualTypeOf<
      [
        {
          tokenIndex: 0 | 1;
          amount: string | number;
          poolData: PoolData;
          poolSpokeAssets: PoolSpokeAssets;
          dst?: DestinationParamsType;
        },
      ]
    >();
  });

  it('returns the withdraw params without the source chain and address', () => {
    expectTypeOf<ReturnType<typeof useCreateWithdrawParams>>().toEqualTypeOf<
      Omit<CreateAssetWithdrawParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress'> | undefined
    >();
  });
});
