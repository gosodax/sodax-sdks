/**
 * Compile-time contract: `useUnstakingInfo` reads the user's unstaking info, typed exactly, so `data` can never widen to `any`.
 */
import type { SpokeChainKey, UnstakingInfo } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useUnstakingInfo } from './useUnstakingInfo.js';

type Data = UnstakingInfo;

describe('useUnstakingInfo', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useUnstakingInfo>[0]>().toEqualTypeOf<
      | {
          params?: { srcAddress: `0x${string}` | undefined; srcChainKey: SpokeChainKey | undefined };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useUnstakingInfo>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useUnstakingInfo>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
