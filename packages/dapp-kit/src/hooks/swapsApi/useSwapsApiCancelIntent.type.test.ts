/** Pins useSwapsApiCancelIntent's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type { CancelIntentRequestV2, CancelIntentResponseV2, RawTxReturnType, RequestOverrideConfig } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapsApiCancelIntent, UseSwapsApiCancelIntentVars } from './useSwapsApiCancelIntent.js';

describe('useSwapsApiCancelIntent', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiCancelIntent>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<CancelIntentResponseV2, UseSwapsApiCancelIntentVars> }?]
    >();
    expectTypeOf<UseSwapsApiCancelIntentVars>().toEqualTypeOf<{
      body: CancelIntentRequestV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the unsigned cancel tx', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiCancelIntent>>().toEqualTypeOf<
      SafeUseMutationResult<CancelIntentResponseV2, Error, UseSwapsApiCancelIntentVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiCancelIntent>['data']>>().toEqualTypeOf<{
      tx: RawTxReturnType;
    }>();
  });
});
