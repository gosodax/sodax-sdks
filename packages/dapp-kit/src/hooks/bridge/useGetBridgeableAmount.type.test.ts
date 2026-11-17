/**
 * Compile-time contract for `useGetBridgeableAmount`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped `BridgeLimit`).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { BridgeLimit, XToken } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useGetBridgeableAmount } from './useGetBridgeableAmount.js';

type Data = BridgeLimit;

describe('useGetBridgeableAmount', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useGetBridgeableAmount>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { from: XToken | undefined; to: XToken | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useGetBridgeableAmount>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useGetBridgeableAmount>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
