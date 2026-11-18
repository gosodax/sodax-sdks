/**
 * Compile-time contract for `useDetailedStatus`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the SDK `Result` of the detailed status, `undefined` while disabled).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { DetailedStatusError, DetailedSwapStatus, Result, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useDetailedStatus } from './useDetailedStatus.js';

type Data = Result<DetailedSwapStatus, DetailedStatusError> | undefined;

describe('useDetailedStatus', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useDetailedStatus>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { srcChainKey: SpokeChainKey | undefined; srcTxHash: string | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useDetailedStatus>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useDetailedStatus>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
