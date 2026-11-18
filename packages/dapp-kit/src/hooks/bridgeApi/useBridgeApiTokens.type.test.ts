/** Pins useBridgeApiTokens's params and query result, with the response body spelled out so `data` cannot widen. */
import type { BridgeTokenV2, GetBridgeTokensResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiTokens } from './useBridgeApiTokens.js';

describe('useBridgeApiTokens', () => {
  it('takes only an apiConfig override', () => {
    expectTypeOf<Parameters<typeof useBridgeApiTokens>>().toEqualTypeOf<
      [{ params?: { apiConfig?: RequestOverrideConfig }; queryOptions?: ReadQueryOptions<GetBridgeTokensResponseV2> }?]
    >();
  });

  it('resolves to the tokens grouped by chain key', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiTokens>>().toEqualTypeOf<
      UseQueryResult<GetBridgeTokensResponseV2, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiTokens>['data']>>().toEqualTypeOf<
      Record<string, readonly BridgeTokenV2[]>
    >();
    expectTypeOf<BridgeTokenV2>().toEqualTypeOf<{
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
