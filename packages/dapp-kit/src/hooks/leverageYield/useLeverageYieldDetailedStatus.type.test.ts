/** Pins `useLeverageYieldDetailedStatus`: the query data is the service `Result`, not an unwrapped value. */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  DetailedLeverageYieldStatus,
  LeverageYieldDetailedStatusError,
  RequestOverrideConfig,
  Result,
  Sodax,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldDetailedStatus } from './useLeverageYieldDetailedStatus.js';

type Status = Result<DetailedLeverageYieldStatus, LeverageYieldDetailedStatusError> | undefined;

describe('useLeverageYieldDetailedStatus', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldDetailedStatus>[0]>().toEqualTypeOf<
      | ReadHookParams<
          Status,
          { srcChainKey: SpokeChainKey | undefined; srcTxHash: string | undefined; apiConfig?: RequestOverrideConfig }
        >
      | undefined
    >();
  });

  it('returns the service Result as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldDetailedStatus>>().toEqualTypeOf<UseQueryResult<Status, Error>>();
    expectTypeOf<Awaited<ReturnType<Sodax['leverageYield']['getDetailedStatus']>>>().toEqualTypeOf<
      Exclude<Status, undefined>
    >();
  });
});
