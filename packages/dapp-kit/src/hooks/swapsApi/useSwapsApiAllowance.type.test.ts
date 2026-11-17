/** Pins useSwapsApiAllowance's params and query result, with the response body spelled out so `data` cannot widen. */
import type { AllowanceCheckResponseV2, CreateIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiAllowance } from './useSwapsApiAllowance.js';

describe('useSwapsApiAllowance', () => {
  it('takes the create-intent body', () => {
    expectTypeOf<Parameters<typeof useSwapsApiAllowance>>().toEqualTypeOf<
      [
        {
          params?: { body: CreateIntentParamsV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<AllowanceCheckResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the allowance check, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiAllowance>>().toEqualTypeOf<
      UseQueryResult<AllowanceCheckResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiAllowance>['data']>>().toEqualTypeOf<{ valid: boolean }>();
  });
});
