/** Pins useBridgeApiBridgeableAmount's params and query result, with the response body spelled out so `data` cannot widen. */
import type {
  BridgeableAmountResponseV2,
  BridgeLimitV2,
  BridgeQuoteRequestV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiBridgeableAmount } from './useBridgeApiBridgeableAmount.js';

describe('useBridgeApiBridgeableAmount', () => {
  it('takes the bridge quote body', () => {
    expectTypeOf<Parameters<typeof useBridgeApiBridgeableAmount>>().toEqualTypeOf<
      [
        {
          params?: { body: BridgeQuoteRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<BridgeableAmountResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the bridgeable limit, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiBridgeableAmount>>().toEqualTypeOf<
      UseQueryResult<BridgeableAmountResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiBridgeableAmount>['data']>>().toEqualTypeOf<{
      limit: BridgeLimitV2;
    }>();
  });
});
