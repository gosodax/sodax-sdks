/** Pins useSwapsApiCreateLimitOrder's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type {
  CreateLimitOrderParamsV2,
  CreateLimitOrderResponseV2,
  IntentResponseV2,
  RawTxReturnType,
  RelayExtraDataResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapsApiCreateLimitOrder, UseSwapsApiCreateLimitOrderVars } from './useSwapsApiCreateLimitOrder.js';

describe('useSwapsApiCreateLimitOrder', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiCreateLimitOrder>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<CreateLimitOrderResponseV2, UseSwapsApiCreateLimitOrderVars> }?]
    >();
    expectTypeOf<UseSwapsApiCreateLimitOrderVars>().toEqualTypeOf<{
      body: CreateLimitOrderParamsV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the unsigned limit-order tx, intent and relay data', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiCreateLimitOrder>>().toEqualTypeOf<
      SafeUseMutationResult<CreateLimitOrderResponseV2, Error, UseSwapsApiCreateLimitOrderVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiCreateLimitOrder>['data']>>().toEqualTypeOf<{
      tx: RawTxReturnType;
      intent: IntentResponseV2;
      relayData: RelayExtraDataResponseV2;
    }>();
  });
});
