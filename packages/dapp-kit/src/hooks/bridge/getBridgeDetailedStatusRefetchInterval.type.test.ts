/**
 * Compile-time contract for the bridge detailed-status polling policy: both functions take the
 * `useBridgeDetailedStatus` data and return a plain flag or a React Query interval, independent of input.
 */
import type { BridgeDetailedStatusError, DetailedBridgeStatus, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  getBridgeDetailedStatusRefetchInterval,
  isBridgeNotDelivered,
} from './getBridgeDetailedStatusRefetchInterval.js';

type Read = Result<DetailedBridgeStatus, BridgeDetailedStatusError> | undefined;

describe('getBridgeDetailedStatusRefetchInterval', () => {
  it('isBridgeNotDelivered: reads the status data and answers a boolean, not a type guard', () => {
    expectTypeOf<Parameters<typeof isBridgeNotDelivered>>().toEqualTypeOf<[data: Read]>();
    expectTypeOf<ReturnType<typeof isBridgeNotDelivered>>().toEqualTypeOf<boolean>();
  });

  it('getBridgeDetailedStatusRefetchInterval: an interval in ms, or false to stop', () => {
    expectTypeOf<Parameters<typeof getBridgeDetailedStatusRefetchInterval>>().toEqualTypeOf<
      [data: Read, consecutiveNotFound: number]
    >();
    expectTypeOf<ReturnType<typeof getBridgeDetailedStatusRefetchInterval>>().toEqualTypeOf<number | false>();
  });
});
