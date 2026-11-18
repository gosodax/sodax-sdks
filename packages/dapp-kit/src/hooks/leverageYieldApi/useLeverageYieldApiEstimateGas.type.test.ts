/** Pins `useLeverageYieldApiEstimateGas`: its params and `UseQueryResult<GasEstimateResponseV2 | undefined, Error>` over the `estimateGas` wire body. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { GasEstimateRequestV2, GasEstimateResponseV2, RequestOverrideConfig, Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldApiEstimateGas } from './useLeverageYieldApiEstimateGas.js';

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

describe('useLeverageYieldApiEstimateGas', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiEstimateGas>[0]>().toEqualTypeOf<
      | ReadHookParams<
          GasEstimateResponseV2 | undefined,
          { body: GasEstimateRequestV2 | undefined; apiConfig?: RequestOverrideConfig }
        >
      | undefined
    >();
  });

  it('returns the wire body as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiEstimateGas>>().toEqualTypeOf<
      UseQueryResult<GasEstimateResponseV2 | undefined, Error>
    >();
    expectTypeOf<WireOk<'estimateGas'>>().toEqualTypeOf<GasEstimateResponseV2>();
    expectTypeOf<HasAny<GasEstimateResponseV2>>().toEqualTypeOf<false>();
  });

  it('keeps the chain-specific gas estimate opaque', () => {
    // Legitimately unknown: an EVM/Bitcoin/Near/Solana estimate is a decimal string, the rest are chain-specific objects.
    expectTypeOf<GasEstimateResponseV2['gas']>().toBeUnknown();
  });
});
