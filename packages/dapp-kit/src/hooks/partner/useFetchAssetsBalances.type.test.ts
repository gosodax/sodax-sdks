/**
 * Compile-time contract for `useFetchAssetsBalances`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped balance map).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { PartnerFeeClaimAssetBalance } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useFetchAssetsBalances } from './useFetchAssetsBalances.js';

type Data = Map<string, PartnerFeeClaimAssetBalance>;

describe('useFetchAssetsBalances', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useFetchAssetsBalances>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { queryAddress: string | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useFetchAssetsBalances>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useFetchAssetsBalances>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
