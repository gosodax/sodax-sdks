/** Pins useSwapsApiDeadline's params and query result, with the response body spelled out so `data` cannot widen. */
import type { DeadlineQueryV2, DeadlineResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiDeadline } from './useSwapsApiDeadline.js';

describe('useSwapsApiDeadline', () => {
  it('takes an optional offset query', () => {
    expectTypeOf<Parameters<typeof useSwapsApiDeadline>>().toEqualTypeOf<
      [
        {
          params?: { query?: DeadlineQueryV2; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<DeadlineResponseV2>;
        }?,
      ]
    >();
  });

  it('resolves to the deadline', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiDeadline>>().toEqualTypeOf<UseQueryResult<DeadlineResponseV2, Error>>();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiDeadline>['data']>>().toEqualTypeOf<{ deadline: string }>();
  });
});
