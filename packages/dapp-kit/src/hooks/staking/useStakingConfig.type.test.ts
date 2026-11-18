/**
 * Compile-time contract: `useStakingConfig` reads the staking config, typed exactly, so `data` can never widen to `any`.
 */
import type { StakingConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useStakingConfig } from './useStakingConfig.js';

type Data = StakingConfig;

describe('useStakingConfig', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useStakingConfig>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useStakingConfig>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useStakingConfig>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
