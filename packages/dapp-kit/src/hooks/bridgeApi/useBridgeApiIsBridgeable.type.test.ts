/** Pins useBridgeApiIsBridgeable's params and query result, with the response body spelled out so `data` cannot widen. */
import type { BridgeableCheckResponseV2, BridgeQuoteRequestV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiIsBridgeable } from './useBridgeApiIsBridgeable.js';

describe('useBridgeApiIsBridgeable', () => {
  it('takes the bridge quote body', () => {
    expectTypeOf<Parameters<typeof useBridgeApiIsBridgeable>>().toEqualTypeOf<
      [
        {
          params?: { body: BridgeQuoteRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<BridgeableCheckResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the bridgeable flag, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiIsBridgeable>>().toEqualTypeOf<
      UseQueryResult<BridgeableCheckResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiIsBridgeable>['data']>>().toEqualTypeOf<{
      bridgeable: boolean;
    }>();
  });
});
