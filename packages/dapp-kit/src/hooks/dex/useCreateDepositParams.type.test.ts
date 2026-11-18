/**
 * Compile-time contract: `useCreateDepositParams` takes the deposit form state and returns the
 * chain-agnostic deposit params core, or `undefined` while the amount is empty or non-positive.
 */
import type { CreateAssetDepositParams, PoolData, PoolSpokeAssets, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { useCreateDepositParams } from './useCreateDepositParams.js';

describe('useCreateDepositParams', () => {
  it('takes the deposit form state', () => {
    expectTypeOf<Parameters<typeof useCreateDepositParams>>().toEqualTypeOf<
      [{ tokenIndex: 0 | 1; amount: string | number; poolData: PoolData; poolSpokeAssets: PoolSpokeAssets }]
    >();
  });

  it('returns the deposit params without the source chain and address', () => {
    expectTypeOf<ReturnType<typeof useCreateDepositParams>>().toEqualTypeOf<
      Omit<CreateAssetDepositParams<SpokeChainKey>, 'srcChainKey' | 'srcAddress'> | undefined
    >();
  });
});
