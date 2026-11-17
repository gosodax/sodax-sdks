/** Pins useSwapsApiTokens's params and query result, with the response body spelled out so `data` cannot widen. */
import type { GetSwapTokensResponseV2, RequestOverrideConfig, SwapTokenV2 } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiTokens } from './useSwapsApiTokens.js';

describe('useSwapsApiTokens', () => {
  it('takes only an apiConfig override', () => {
    expectTypeOf<Parameters<typeof useSwapsApiTokens>>().toEqualTypeOf<
      [{ params?: { apiConfig?: RequestOverrideConfig }; queryOptions?: ReadQueryOptions<GetSwapTokensResponseV2> }?]
    >();
  });

  it('resolves to the tokens grouped by chain key', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiTokens>>().toEqualTypeOf<
      UseQueryResult<GetSwapTokensResponseV2, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiTokens>['data']>>().toEqualTypeOf<
      Record<string, readonly SwapTokenV2[]>
    >();
    expectTypeOf<SwapTokenV2>().toEqualTypeOf<{
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
