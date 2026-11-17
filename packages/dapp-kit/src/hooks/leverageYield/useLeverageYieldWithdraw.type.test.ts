/** Pins `useLeverageYieldWithdraw`: its mutation options and `SafeUseMutationResult<LeverageYieldSwapPayload, Error, LeverageYieldSwapWithdrawParams>` over `leverageYield.withdraw`. */
import type { LeverageYieldSwapPayload, LeverageYieldSwapWithdrawParams, Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldWithdraw } from './useLeverageYieldWithdraw.js';

// Success value of the SDK call the hook unwraps, so the hook's data is checked against the service.
type SdkOk<M extends keyof Sodax['leverageYield']> = Sodax['leverageYield'][M] extends (
  ...args: never[]
) => Promise<infer R>
  ? R extends { ok: true; value: infer V }
    ? V
    : never
  : never;
// True when `any` appears anywhere in T, so the data cannot silently lose its shape.
type HasAny<T, Depth extends unknown[] = []> = 0 extends 1 & T
  ? true
  : Depth['length'] extends 6
    ? false
    : T extends object
      ? true extends { [P in keyof T]-?: HasAny<T[P], [...Depth, unknown]> }[keyof T]
        ? true
        : false
      : false;

describe('useLeverageYieldWithdraw', () => {
  it('accepts mutation options typed by its data and variables', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldWithdraw>[0]>().toEqualTypeOf<
      MutationHookParams<LeverageYieldSwapPayload, LeverageYieldSwapWithdrawParams> | undefined
    >();
  });

  it('returns the unwrapped service value as mutation data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldWithdraw>>().toEqualTypeOf<
      SafeUseMutationResult<LeverageYieldSwapPayload, Error, LeverageYieldSwapWithdrawParams>
    >();
    expectTypeOf<SdkOk<'withdraw'>>().toEqualTypeOf<LeverageYieldSwapPayload>();
    expectTypeOf<HasAny<LeverageYieldSwapPayload>>().toEqualTypeOf<false>();
  });
});
