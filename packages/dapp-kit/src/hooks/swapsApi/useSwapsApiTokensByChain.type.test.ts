/** Pins useSwapsApiTokensByChain's params and query result, with the response body spelled out so `data` cannot widen. */
import type { GetSwapTokensByChainResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiTokensByChain } from './useSwapsApiTokensByChain.js';

describe('useSwapsApiTokensByChain', () => {
  it('takes a chain key', () => {
    expectTypeOf<Parameters<typeof useSwapsApiTokensByChain>>().toEqualTypeOf<
      [
        {
          params?: { chainKey: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<GetSwapTokensByChainResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the tokens of one chain, undefined until the chain key is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiTokensByChain>>().toEqualTypeOf<
      UseQueryResult<GetSwapTokensByChainResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiTokensByChain>['data']>[number]>().toEqualTypeOf<{
      symbol: string;
      name: string;
      decimals: number;
      address: string;
      chainKey: string;
      hubAsset: string;
      vault: string;
    }>();
  });
});
