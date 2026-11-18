/**
 * Compile-time contract: `useUnstakingInfoWithPenalty` reads the user's unstaking info with per-request penalties, typed exactly, so `data` can never widen to `any`.
 */
import type { SpokeChainKey, UnstakeRequestWithPenalty, UnstakingInfo } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useUnstakingInfoWithPenalty } from './useUnstakingInfoWithPenalty.js';

type Data = UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] };

describe('useUnstakingInfoWithPenalty', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useUnstakingInfoWithPenalty>[0]>().toEqualTypeOf<
      | {
          params?: { srcAddress: `0x${string}` | undefined; srcChainKey: SpokeChainKey | undefined };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useUnstakingInfoWithPenalty>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useUnstakingInfoWithPenalty>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
