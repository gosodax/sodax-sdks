/** Pins useSwapsApiSubmitTx's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type { RequestOverrideConfig, SubmitTxRequestV2, SubmitTxResponseDataV2, SubmitTxResponseV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapsApiSubmitTx, UseSwapsApiSubmitTxVars } from './useSwapsApiSubmitTx.js';

describe('useSwapsApiSubmitTx', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiSubmitTx>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<SubmitTxResponseV2, UseSwapsApiSubmitTxVars> }?]
    >();
    expectTypeOf<UseSwapsApiSubmitTxVars>().toEqualTypeOf<{
      request: SubmitTxRequestV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the submit acknowledgement', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiSubmitTx>>().toEqualTypeOf<
      SafeUseMutationResult<SubmitTxResponseV2, Error, UseSwapsApiSubmitTxVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiSubmitTx>['data']>>().toEqualTypeOf<{
      success: boolean;
      data: SubmitTxResponseDataV2;
    }>();
  });
});
