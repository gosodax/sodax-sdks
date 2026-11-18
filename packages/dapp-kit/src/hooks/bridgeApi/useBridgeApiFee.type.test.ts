/** Pins useBridgeApiFee's params and query result, with the response body spelled out so `data` cannot widen. */
import type { BridgeFeeRequestV2, BridgeFeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiFee } from './useBridgeApiFee.js';

describe('useBridgeApiFee', () => {
  it('takes the fee body', () => {
    expectTypeOf<Parameters<typeof useBridgeApiFee>>().toEqualTypeOf<
      [
        {
          params?: { body: BridgeFeeRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<BridgeFeeResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the fee, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiFee>>().toEqualTypeOf<
      UseQueryResult<BridgeFeeResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiFee>['data']>>().toEqualTypeOf<{ fee: string }>();
  });
});
