/** Pins useSwapsApiSubmitTxStatus's params and query result, with the response body spelled out so `data` cannot widen. */
import type { RequestOverrideConfig, SubmitTxStatusDataV2, SubmitTxStatusResponseV2 } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiSubmitTxStatus } from './useSwapsApiSubmitTxStatus.js';

describe('useSwapsApiSubmitTxStatus', () => {
  it('takes a tx hash and source chain key', () => {
    expectTypeOf<Parameters<typeof useSwapsApiSubmitTxStatus>>().toEqualTypeOf<
      [
        {
          params?: { txHash: string | undefined; srcChainKey?: string; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<SubmitTxStatusResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the submit status, undefined until both keys are set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiSubmitTxStatus>>().toEqualTypeOf<
      UseQueryResult<SubmitTxStatusResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiSubmitTxStatus>['data']>>().toEqualTypeOf<{
      success: boolean;
      data: SubmitTxStatusDataV2;
    }>();
  });
});
