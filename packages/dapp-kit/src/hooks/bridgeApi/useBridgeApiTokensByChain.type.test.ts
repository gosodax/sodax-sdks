/** Pins useBridgeApiTokensByChain's params and query result, with the response body spelled out so `data` cannot widen. */
import type { GetBridgeTokensByChainResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiTokensByChain } from './useBridgeApiTokensByChain.js';

describe('useBridgeApiTokensByChain', () => {
  it('takes a chain key', () => {
    expectTypeOf<Parameters<typeof useBridgeApiTokensByChain>>().toEqualTypeOf<
      [
        {
          params?: { chainKey: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<GetBridgeTokensByChainResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the tokens of one chain, undefined until the chain key is set', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiTokensByChain>>().toEqualTypeOf<
      UseQueryResult<GetBridgeTokensByChainResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiTokensByChain>['data']>[number]>().toEqualTypeOf<{
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
