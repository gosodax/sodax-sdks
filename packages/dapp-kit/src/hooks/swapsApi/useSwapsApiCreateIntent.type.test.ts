/** Pins useSwapsApiCreateIntent's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type {
  CreateIntentParamsV2,
  CreateIntentResponseV2,
  IntentResponseV2,
  RawTxReturnType,
  RelayExtraDataResponseV2,
  RequestOverrideConfig,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapsApiCreateIntent, UseSwapsApiCreateIntentVars } from './useSwapsApiCreateIntent.js';

describe('useSwapsApiCreateIntent', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiCreateIntent>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<CreateIntentResponseV2, UseSwapsApiCreateIntentVars> }?]
    >();
    expectTypeOf<UseSwapsApiCreateIntentVars>().toEqualTypeOf<{
      body: CreateIntentParamsV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the unsigned intent tx, intent and relay data', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiCreateIntent>>().toEqualTypeOf<
      SafeUseMutationResult<CreateIntentResponseV2, Error, UseSwapsApiCreateIntentVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiCreateIntent>['data']>>().toEqualTypeOf<{
      tx: RawTxReturnType;
      intent: IntentResponseV2;
      relayData: RelayExtraDataResponseV2;
    }>();
  });
});
