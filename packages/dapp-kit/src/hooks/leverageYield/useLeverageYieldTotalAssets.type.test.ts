/** Pins `useLeverageYieldTotalAssets`: its params and `UseQueryResult<bigint, Error>` over `leverageYield.getTotalAssets`. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { Address, Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldTotalAssets } from './useLeverageYieldTotalAssets.js';

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

describe('useLeverageYieldTotalAssets', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldTotalAssets>[0]>().toEqualTypeOf<
      ReadHookParams<bigint, { vault: Address | undefined }> | undefined
    >();
  });

  it('returns the unwrapped service value as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldTotalAssets>>().toEqualTypeOf<UseQueryResult<bigint, Error>>();
    expectTypeOf<SdkOk<'getTotalAssets'>>().toEqualTypeOf<bigint>();
    expectTypeOf<HasAny<bigint>>().toEqualTypeOf<false>();
  });
});
