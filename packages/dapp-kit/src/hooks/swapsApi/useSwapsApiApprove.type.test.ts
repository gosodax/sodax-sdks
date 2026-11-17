/** Pins useSwapsApiApprove's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type { ApproveResponseV2, CreateIntentParamsV2, RawTxReturnType, RequestOverrideConfig } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapsApiApprove, UseSwapsApiApproveVars } from './useSwapsApiApprove.js';

describe('useSwapsApiApprove', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiApprove>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<ApproveResponseV2, UseSwapsApiApproveVars> }?]
    >();
    expectTypeOf<UseSwapsApiApproveVars>().toEqualTypeOf<{
      body: CreateIntentParamsV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the unsigned approval txs', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiApprove>>().toEqualTypeOf<
      SafeUseMutationResult<ApproveResponseV2, Error, UseSwapsApiApproveVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiApprove>['data']>>().toEqualTypeOf<{
      tx: RawTxReturnType;
      resetTx?: RawTxReturnType;
    }>();
  });
});
