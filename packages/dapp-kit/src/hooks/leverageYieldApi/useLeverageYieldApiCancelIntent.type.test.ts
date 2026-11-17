/** Pins `useLeverageYieldApiCancelIntent`: its mutation options and `SafeUseMutationResult<CancelIntentResponseV2, Error, Vars>` over the `cancelIntent` wire body. */
import type {
  CancelIntentRequestV2,
  CancelIntentResponseV2,
  RawTxReturnType,
  RequestOverrideConfig,
  Sodax,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldApiCancelIntent } from './useLeverageYieldApiCancelIntent.js';

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
type Vars = { body: CancelIntentRequestV2; apiConfig?: RequestOverrideConfig };

describe('useLeverageYieldApiCancelIntent', () => {
  it('accepts mutation options typed by the wire body', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiCancelIntent>[0]>().toEqualTypeOf<
      MutationHookParams<CancelIntentResponseV2, Vars> | undefined
    >();
  });

  it('returns the wire body as mutation data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiCancelIntent>>().toEqualTypeOf<
      SafeUseMutationResult<CancelIntentResponseV2, Error, Vars>
    >();
    expectTypeOf<WireOk<'cancelIntent'>>().toEqualTypeOf<CancelIntentResponseV2>();
    expectTypeOf<HasAny<CancelIntentResponseV2>>().toEqualTypeOf<false>();
  });

  it('types the unsigned tx as the all-chain union', () => {
    // Not narrowed: the wire `srcChainKey` is a plain string, so the chain is only known at runtime.
    expectTypeOf<CancelIntentResponseV2['tx']>().toEqualTypeOf<RawTxReturnType>();
  });
});
