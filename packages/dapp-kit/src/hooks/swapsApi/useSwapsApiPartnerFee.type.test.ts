/** Pins useSwapsApiPartnerFee's params and query result, with the response body spelled out so `data` cannot widen. */
import type { FeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiPartnerFee } from './useSwapsApiPartnerFee.js';

describe('useSwapsApiPartnerFee', () => {
  it('takes an amount', () => {
    expectTypeOf<Parameters<typeof useSwapsApiPartnerFee>>().toEqualTypeOf<
      [
        {
          params?: { amount: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<FeeResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the partner fee, undefined until the amount is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiPartnerFee>>().toEqualTypeOf<
      UseQueryResult<FeeResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiPartnerFee>['data']>>().toEqualTypeOf<{ fee: string }>();
  });
});
