/**
 * Compile-time contract for `useGetBridgeableTokens`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped `XToken[]`).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { SpokeChainKey, XToken } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useGetBridgeableTokens } from './useGetBridgeableTokens.js';

type Data = XToken[];

describe('useGetBridgeableTokens', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useGetBridgeableTokens>[0]>().toEqualTypeOf<
      | ReadHookParams<
          Data,
          { from: SpokeChainKey | undefined; to: SpokeChainKey | undefined; token: string | undefined }
        >
      | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useGetBridgeableTokens>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useGetBridgeableTokens>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
