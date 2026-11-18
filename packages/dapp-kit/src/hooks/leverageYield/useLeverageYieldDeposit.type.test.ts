/** Pins `useLeverageYieldDeposit`: its mutation options and `SafeUseMutationResult<LeverageYieldSwapPayload, Error, LeverageYieldSwapDepositParams>` over `leverageYield.deposit`. */
import type { LeverageYieldSwapDepositParams, LeverageYieldSwapPayload, Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldDeposit } from './useLeverageYieldDeposit.js';

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

describe('useLeverageYieldDeposit', () => {
  it('accepts mutation options typed by its data and variables', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldDeposit>[0]>().toEqualTypeOf<
      MutationHookParams<LeverageYieldSwapPayload, LeverageYieldSwapDepositParams> | undefined
    >();
  });

  it('returns the unwrapped service value as mutation data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldDeposit>>().toEqualTypeOf<
      SafeUseMutationResult<LeverageYieldSwapPayload, Error, LeverageYieldSwapDepositParams>
    >();
    expectTypeOf<SdkOk<'deposit'>>().toEqualTypeOf<LeverageYieldSwapPayload>();
    expectTypeOf<HasAny<LeverageYieldSwapPayload>>().toEqualTypeOf<false>();
  });
});
