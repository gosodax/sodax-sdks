/**
 * Compile-time contract for `useIsTokenApproved`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped approval flag).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { FeeTokenApproveParams } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useIsTokenApproved } from './useIsTokenApproved.js';

type Data = boolean;

describe('useIsTokenApproved', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useIsTokenApproved>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { payload: FeeTokenApproveParams | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useIsTokenApproved>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useIsTokenApproved>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
