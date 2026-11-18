/** Pins useBridgeApiSubmitTx's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type {
  BridgeSubmitTxRequestV2,
  BridgeSubmitTxResponseDataV2,
  BridgeSubmitTxResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useBridgeApiSubmitTx, UseBridgeApiSubmitTxVars } from './useBridgeApiSubmitTx.js';

describe('useBridgeApiSubmitTx', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useBridgeApiSubmitTx>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<BridgeSubmitTxResponseV2, UseBridgeApiSubmitTxVars> }?]
    >();
    expectTypeOf<UseBridgeApiSubmitTxVars>().toEqualTypeOf<{
      request: BridgeSubmitTxRequestV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the submit acknowledgement', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiSubmitTx>>().toEqualTypeOf<
      SafeUseMutationResult<BridgeSubmitTxResponseV2, Error, UseBridgeApiSubmitTxVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiSubmitTx>['data']>>().toEqualTypeOf<{
      success: boolean;
      data: BridgeSubmitTxResponseDataV2;
    }>();
  });
});
