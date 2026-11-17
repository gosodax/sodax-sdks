/**
 * Compile-time contract: `useUserFormattedSummary` reads the user's formatted portfolio summary, typed exactly, so `data` can never widen to `any`.
 */
import type { FormatReserveUSDResponse, FormatUserSummaryResponse, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useUserFormattedSummary } from './useUserFormattedSummary.js';

type Data = FormatUserSummaryResponse<FormatReserveUSDResponse>;

describe('useUserFormattedSummary', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useUserFormattedSummary>[0]>().toEqualTypeOf<
      | {
          params?: { spokeChainKey: SpokeChainKey | undefined; userAddress: string | undefined };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useUserFormattedSummary>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useUserFormattedSummary>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
