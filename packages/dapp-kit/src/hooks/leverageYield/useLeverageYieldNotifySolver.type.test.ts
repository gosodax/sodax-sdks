/** Pins `useLeverageYieldNotifySolver`: its mutation options and `SafeUseMutationResult<SolverExecutionResponse, Error, SolverExecutionRequest>` over `leverageYield.notifySolver`. */
import type { Sodax, SolverExecutionRequest, SolverExecutionResponse } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldNotifySolver } from './useLeverageYieldNotifySolver.js';

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

describe('useLeverageYieldNotifySolver', () => {
  it('accepts mutation options typed by its data and variables', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldNotifySolver>[0]>().toEqualTypeOf<
      MutationHookParams<SolverExecutionResponse, SolverExecutionRequest> | undefined
    >();
  });

  it('returns the unwrapped service value as mutation data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldNotifySolver>>().toEqualTypeOf<
      SafeUseMutationResult<SolverExecutionResponse, Error, SolverExecutionRequest>
    >();
    expectTypeOf<SdkOk<'notifySolver'>>().toEqualTypeOf<SolverExecutionResponse>();
    expectTypeOf<HasAny<SolverExecutionResponse>>().toEqualTypeOf<false>();
  });
});
