/** Pins useSwapsApiIntentPacket's params and query result, with the response body spelled out so `data` cannot widen. */
import type { IntentPacketRequestV2, IntentPacketResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiIntentPacket } from './useSwapsApiIntentPacket.js';

describe('useSwapsApiIntentPacket', () => {
  it('takes the packet body', () => {
    expectTypeOf<Parameters<typeof useSwapsApiIntentPacket>>().toEqualTypeOf<
      [
        {
          params?: { body: IntentPacketRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<IntentPacketResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the solved packet, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiIntentPacket>>().toEqualTypeOf<
      UseQueryResult<IntentPacketResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiIntentPacket>['data']>>().toEqualTypeOf<{
      srcChainId: number;
      srcTxHash: string;
      srcAddress: string;
      status: string;
      dstChainId: number;
      connSn: number;
      dstAddress: string;
      dstTxHash: string;
      signatures: string[];
      payload: string;
    }>();
  });
});
