/** Pins useSwapsApiSubmitIntent's variables, options and mutation result, with the response body spelled out so `data` cannot widen. */
import type { RequestOverrideConfig, SubmitIntentRequestV2, SubmitIntentResponseV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapsApiSubmitIntent, UseSwapsApiSubmitIntentVars } from './useSwapsApiSubmitIntent.js';

type Data = SubmitIntentResponseV2;

describe('useSwapsApiSubmitIntent', () => {
  it('takes only mutation options; inputs arrive through mutate()', () => {
    expectTypeOf<Parameters<typeof useSwapsApiSubmitIntent>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<SubmitIntentResponseV2, UseSwapsApiSubmitIntentVars> }?]
    >();
    expectTypeOf<UseSwapsApiSubmitIntentVars>().toEqualTypeOf<{
      body: SubmitIntentRequestV2;
      apiConfig?: RequestOverrideConfig;
    }>();
  });

  it('resolves to the relay response', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiSubmitIntent>>().toEqualTypeOf<
      SafeUseMutationResult<SubmitIntentResponseV2, Error, UseSwapsApiSubmitIntentVars>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiSubmitIntent>['data']>>().toEqualTypeOf<{
      result: unknown;
    }>();
    // Legitimately unknown: the raw intent-relay response is opaque by contract.
    expectTypeOf<Data['result']>().toBeUnknown();
  });
});
