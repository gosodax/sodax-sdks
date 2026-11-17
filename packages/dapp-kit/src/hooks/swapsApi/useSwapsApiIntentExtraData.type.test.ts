/** Pins useSwapsApiIntentExtraData's params and query result, with the response body spelled out so `data` cannot widen. */
import type { IntentExtraDataRequestV2, IntentExtraDataResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiIntentExtraData } from './useSwapsApiIntentExtraData.js';

describe('useSwapsApiIntentExtraData', () => {
  it('takes a tx hash or intent body', () => {
    expectTypeOf<Parameters<typeof useSwapsApiIntentExtraData>>().toEqualTypeOf<
      [
        {
          params?: { body: IntentExtraDataRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<IntentExtraDataResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the relay extra data, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiIntentExtraData>>().toEqualTypeOf<
      UseQueryResult<IntentExtraDataResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiIntentExtraData>['data']>>().toEqualTypeOf<{
      address: string;
      payload: string;
    }>();
  });
});
