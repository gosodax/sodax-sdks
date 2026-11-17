/** Pins `useLeverageYieldApiSubmitTx`: its mutation options and `SafeUseMutationResult<SubmitTxResponseV2, Error, Vars>` over the `submitTx` wire body. */
import type { LeverageYieldSubmitTxRequestV2, RequestOverrideConfig, Sodax, SubmitTxResponseV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldApiSubmitTx } from './useLeverageYieldApiSubmitTx.js';

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
type Vars = { request: LeverageYieldSubmitTxRequestV2; apiConfig?: RequestOverrideConfig };

describe('useLeverageYieldApiSubmitTx', () => {
  it('accepts mutation options typed by the wire body', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiSubmitTx>[0]>().toEqualTypeOf<
      MutationHookParams<SubmitTxResponseV2, Vars> | undefined
    >();
  });

  it('returns the wire body as mutation data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiSubmitTx>>().toEqualTypeOf<
      SafeUseMutationResult<SubmitTxResponseV2, Error, Vars>
    >();
    expectTypeOf<WireOk<'submitTx'>>().toEqualTypeOf<SubmitTxResponseV2>();
    expectTypeOf<HasAny<SubmitTxResponseV2>>().toEqualTypeOf<false>();
  });
});
