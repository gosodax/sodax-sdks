/** Pins `useLeverageYieldApiAsset`: its params and `UseQueryResult<VaultAssetResponseV2 | undefined, Error>` over the `getAsset` wire body. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { RequestOverrideConfig, Sodax, VaultAssetResponseV2 } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldApiAsset } from './useLeverageYieldApiAsset.js';

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

describe('useLeverageYieldApiAsset', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiAsset>[0]>().toEqualTypeOf<
      | ReadHookParams<
          VaultAssetResponseV2 | undefined,
          { vault: string | undefined; apiConfig?: RequestOverrideConfig }
        >
      | undefined
    >();
  });

  it('returns the wire body as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiAsset>>().toEqualTypeOf<
      UseQueryResult<VaultAssetResponseV2 | undefined, Error>
    >();
    expectTypeOf<WireOk<'getAsset'>>().toEqualTypeOf<VaultAssetResponseV2>();
    expectTypeOf<HasAny<VaultAssetResponseV2>>().toEqualTypeOf<false>();
  });
});
