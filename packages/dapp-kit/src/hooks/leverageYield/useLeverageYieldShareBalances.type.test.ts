/** Pins `useLeverageYieldShareBalances`: one `UseQueryResult<LeverageYieldShareHolding, Error>` per holder. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { Address, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldShareBalances } from './useLeverageYieldShareBalances.js';

type Holding = { chainKey: SpokeChainKey; holder: Address; shares: bigint };
type Holder = { chainKey: SpokeChainKey; address: string };

describe('useLeverageYieldShareBalances', () => {
  it('accepts a vault and its holders', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldShareBalances>[0]>().toEqualTypeOf<
      ReadHookParams<Holding, { vault: Address | undefined; holders: readonly Holder[] | undefined }> | undefined
    >();
  });

  it('returns one query result per holder', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldShareBalances>>().toEqualTypeOf<UseQueryResult<Holding, Error>[]>();
  });
});
