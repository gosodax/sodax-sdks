/** Pins useBridgeApiCreateBridgeIntent's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type {
  CreateBridgeIntentParamsV2,
  CreateBridgeIntentResponseV2,
  RawTxReturnType,
  RelayExtraDataResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type {
  useBridgeApiCreateBridgeIntent,
  UseBridgeApiCreateBridgeIntentVars,
} from './useBridgeApiCreateBridgeIntent.js';

describe('useBridgeApiCreateBridgeIntent', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useBridgeApiCreateBridgeIntent>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<CreateBridgeIntentResponseV2, UseBridgeApiCreateBridgeIntentVars> }?]
    >();
    expectTypeOf<UseBridgeApiCreateBridgeIntentVars>().toEqualTypeOf<{
      body: CreateBridgeIntentParamsV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the unsigned deposit tx and its relay data', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiCreateBridgeIntent>>().toEqualTypeOf<
      SafeUseMutationResult<CreateBridgeIntentResponseV2, Error, UseBridgeApiCreateBridgeIntentVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiCreateBridgeIntent>['data']>>().toEqualTypeOf<{
      tx: RawTxReturnType;
      relayData: RelayExtraDataResponseV2;
    }>();
  });
});
