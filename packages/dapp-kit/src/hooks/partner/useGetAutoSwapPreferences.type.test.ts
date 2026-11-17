/**
 * Compile-time contract for `useGetAutoSwapPreferences`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped `AutoSwapPreferences`).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { AutoSwapPreferences } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useGetAutoSwapPreferences } from './useGetAutoSwapPreferences.js';

type Data = AutoSwapPreferences;

describe('useGetAutoSwapPreferences', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useGetAutoSwapPreferences>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { queryAddress: string | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useGetAutoSwapPreferences>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useGetAutoSwapPreferences>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
