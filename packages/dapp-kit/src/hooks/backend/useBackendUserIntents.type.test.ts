/** Pins useBackendUserIntents's params and query result, with the response body spelled out so `data` cannot widen. */
import type { Address, IntentResponse, UserIntentsResponse } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendUserIntents } from './useBackendUserIntents.js';

type Data = UserIntentsResponse;

describe('useBackendUserIntents', () => {
  it('takes a user address and an optional date range', () => {
    expectTypeOf<Parameters<typeof useBackendUserIntents>>().toEqualTypeOf<
      [
        {
          params?: { userAddress: Address | undefined; startDate?: number; endDate?: number };
          queryOptions?: ReadQueryOptions<UserIntentsResponse | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the user intents page, undefined until the address is set', () => {
    expectTypeOf<ReturnType<typeof useBackendUserIntents>>().toEqualTypeOf<
      UseQueryResult<UserIntentsResponse | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendUserIntents>['data']>>().toEqualTypeOf<{
      total: number;
      offset: number;
      limit: number;
      items: IntentResponse[];
    }>();
    // Legitimately unknown: event entries are untyped on the wire; `isFillEvent` narrows them.
    expectTypeOf<Data['items'][number]['events'][number]>().toBeUnknown();
  });
});
