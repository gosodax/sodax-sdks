/** Pins useSwapsApiIntentHash's params and query result, with the response body spelled out so `data` cannot widen. */
import type { IntentHashResponseV2, IntentRequestV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiIntentHash } from './useSwapsApiIntentHash.js';

describe('useSwapsApiIntentHash', () => {
  it('takes an intent', () => {
    expectTypeOf<Parameters<typeof useSwapsApiIntentHash>>().toEqualTypeOf<
      [
        {
          params?: { intent: IntentRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<IntentHashResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the intent hash, undefined until the intent is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiIntentHash>>().toEqualTypeOf<
      UseQueryResult<IntentHashResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiIntentHash>['data']>>().toEqualTypeOf<{ hash: string }>();
  });
});
