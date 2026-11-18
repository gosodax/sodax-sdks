/** Pins useBridgeApiApprove's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type {
  BridgeApproveResponseV2,
  CreateBridgeIntentParamsV2,
  RawTxReturnType,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useBridgeApiApprove, UseBridgeApiApproveVars } from './useBridgeApiApprove.js';

describe('useBridgeApiApprove', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useBridgeApiApprove>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<BridgeApproveResponseV2, UseBridgeApiApproveVars> }?]
    >();
    expectTypeOf<UseBridgeApiApproveVars>().toEqualTypeOf<{
      body: CreateBridgeIntentParamsV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the unsigned approval txs', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiApprove>>().toEqualTypeOf<
      SafeUseMutationResult<BridgeApproveResponseV2, Error, UseBridgeApiApproveVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiApprove>['data']>>().toEqualTypeOf<{
      tx: RawTxReturnType;
      resetTx?: RawTxReturnType;
    }>();
  });
});
