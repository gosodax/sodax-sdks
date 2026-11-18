/**
 * Compile-time contract for `useGetIntentDetails`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the unwrapped `Intent`).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { Hex, Intent } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useGetIntentDetails } from './useGetIntentDetails.js';

type Data = Intent;

describe('useGetIntentDetails', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useGetIntentDetails>[0]>().toEqualTypeOf<
      ReadHookParams<Data, { intentHash: Hex | undefined }> | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useGetIntentDetails>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useGetIntentDetails>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
