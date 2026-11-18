/**
 * Compile-time contract for `useGetUserIntent`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped intent hash).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { Address, Hex } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useGetUserIntent } from './useGetUserIntent.js';

type Data = Hex;

describe('useGetUserIntent', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useGetUserIntent>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { user?: Address; fromToken?: Address; toToken?: Address }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useGetUserIntent>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useGetUserIntent>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
