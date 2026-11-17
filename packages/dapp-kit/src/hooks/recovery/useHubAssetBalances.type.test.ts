/**
 * Compile-time contract for `useHubAssetBalances`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped `HubAssetBalance[]`).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { HubAssetBalance, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useHubAssetBalances } from './useHubAssetBalances.js';

type Data = HubAssetBalance[];

describe('useHubAssetBalances', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useHubAssetBalances>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { chainKey: SpokeChainKey | undefined; srcAddress: string | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useHubAssetBalances>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useHubAssetBalances>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
