/** Pins useBridgeApiSubmitTxStatus's params and query result, with the response body spelled out so `data` cannot widen. */
import type { BridgeSubmitTxStatusDataV2, BridgeSubmitTxStatusResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiSubmitTxStatus } from './useBridgeApiSubmitTxStatus.js';

describe('useBridgeApiSubmitTxStatus', () => {
  it('takes a tx hash and source chain key', () => {
    expectTypeOf<Parameters<typeof useBridgeApiSubmitTxStatus>>().toEqualTypeOf<
      [
        {
          params?: { txHash: string | undefined; srcChainKey?: string; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<BridgeSubmitTxStatusResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the submit status, undefined until both keys are set', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiSubmitTxStatus>>().toEqualTypeOf<
      UseQueryResult<BridgeSubmitTxStatusResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiSubmitTxStatus>['data']>>().toEqualTypeOf<{
      success: boolean;
      data: BridgeSubmitTxStatusDataV2;
    }>();
  });
});
