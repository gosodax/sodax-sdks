/**
 * Compile-time contract for `useStatus`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the solver `Result`, `undefined` while disabled).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { Hex, Result, SolverErrorResponse, SolverIntentStatusResponse } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useStatus } from './useStatus.js';

type Data = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;

describe('useStatus', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useStatus>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { intentTxHash: Hex | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useStatus>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useStatus>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
