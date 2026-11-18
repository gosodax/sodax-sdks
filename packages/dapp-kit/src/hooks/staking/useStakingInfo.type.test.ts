/**
 * Compile-time contract: `useStakingInfo` reads the user's staking info, typed exactly, so `data` can never widen to `any`.
 */
import type { SpokeChainKey, StakingInfo } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useStakingInfo } from './useStakingInfo.js';

type Data = StakingInfo;

describe('useStakingInfo', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useStakingInfo>[0]>().toEqualTypeOf<
      | {
          params?: { srcAddress: `0x${string}` | undefined; srcChainKey: SpokeChainKey | undefined };
          queryOptions?: ReadQueryOptions<Data, Error>;
        }
      | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useStakingInfo>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useStakingInfo>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
