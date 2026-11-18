/**
 * Compile-time contract for `useBridgeDetailedStatus`: a read hook whose result does not depend on its inputs, so it pins
 * the accepted params and the exact query data (the SDK `Result` of the detailed status, `undefined` while disabled).
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  BridgeDetailedStatusError,
  DetailedBridgeStatus,
  RequestOverrideConfig,
  Result,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useBridgeDetailedStatus } from './useBridgeDetailedStatus.js';

type Data = Result<DetailedBridgeStatus, BridgeDetailedStatusError> | undefined;

describe('useBridgeDetailedStatus', () => {
  it('accepts optional params and query options typed to its data', () => {
    expectTypeOf<Parameters<typeof useBridgeDetailedStatus>[0]>().toEqualTypeOf<
      | ReadHookParams<
          Data,
          {
            srcChainKey: SpokeChainKey | undefined;
            srcTxHash: string | undefined;
            apiConfig?: RequestOverrideConfig;
          }
        >
      | undefined
    >();
  });

  it('returns a query whose data is spelled out', () => {
    expectTypeOf<ReturnType<typeof useBridgeDetailedStatus>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useBridgeDetailedStatus>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
