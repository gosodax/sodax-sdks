/** Pins useSwapsApiSolverFee's params and query result, with the response body spelled out so `data` cannot widen. */
import type { FeeResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiSolverFee } from './useSwapsApiSolverFee.js';

describe('useSwapsApiSolverFee', () => {
  it('takes an amount', () => {
    expectTypeOf<Parameters<typeof useSwapsApiSolverFee>>().toEqualTypeOf<
      [
        {
          params?: { amount: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<FeeResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the solver fee, undefined until the amount is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiSolverFee>>().toEqualTypeOf<
      UseQueryResult<FeeResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiSolverFee>['data']>>().toEqualTypeOf<{ fee: string }>();
  });
});
