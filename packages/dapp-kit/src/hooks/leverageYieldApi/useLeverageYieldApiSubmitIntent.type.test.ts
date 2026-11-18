/** Pins `useLeverageYieldApiSubmitIntent`: its mutation options and `SafeUseMutationResult<SubmitIntentResponseV2, Error, Vars>` over the `submitIntent` wire body. */
import type { RequestOverrideConfig, Sodax, SubmitIntentRequestV2, SubmitIntentResponseV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldApiSubmitIntent } from './useLeverageYieldApiSubmitIntent.js';

// Success value of a wire-client call, so the hook's data is checked against what the backend client returns.
type WireOk<M extends keyof Sodax['api']['leverageYield']> = Sodax['api']['leverageYield'][M] extends (
  ...args: never[]
) => Promise<infer R>
  ? R extends { ok: true; value: infer V }
    ? V
    : never
  : never;
// True when `any` appears anywhere in T, so a wire body cannot silently lose its shape.
type HasAny<T, Depth extends unknown[] = []> = 0 extends 1 & T
  ? true
  : Depth['length'] extends 6
    ? false
    : T extends object
      ? true extends { [P in keyof T]-?: HasAny<T[P], [...Depth, unknown]> }[keyof T]
        ? true
        : false
      : false;
type Vars = { body: SubmitIntentRequestV2; apiConfig?: RequestOverrideConfig };

describe('useLeverageYieldApiSubmitIntent', () => {
  it('accepts mutation options typed by the wire body', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiSubmitIntent>[0]>().toEqualTypeOf<
      MutationHookParams<SubmitIntentResponseV2, Vars> | undefined
    >();
  });

  it('returns the wire body as mutation data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiSubmitIntent>>().toEqualTypeOf<
      SafeUseMutationResult<SubmitIntentResponseV2, Error, Vars>
    >();
    expectTypeOf<WireOk<'submitIntent'>>().toEqualTypeOf<SubmitIntentResponseV2>();
    expectTypeOf<HasAny<SubmitIntentResponseV2>>().toEqualTypeOf<false>();
  });

  it('keeps the raw relay result opaque', () => {
    // Legitimately unknown: the intent relay's raw response varies by chain and is passed through untouched.
    expectTypeOf<SubmitIntentResponseV2['result']>().toBeUnknown();
  });
});
