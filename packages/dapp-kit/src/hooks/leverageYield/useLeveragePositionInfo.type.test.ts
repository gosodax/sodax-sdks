/** Pins `useLeveragePositionInfo`: its params and `UseQueryResult<LeveragePosition, Error>` over `leverageYield.getPositionInfo`. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { Address, LeveragePosition, Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeveragePositionInfo } from './useLeveragePositionInfo.js';

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

describe('useLeveragePositionInfo', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeveragePositionInfo>[0]>().toEqualTypeOf<
      ReadHookParams<LeveragePosition, { position: Address | undefined }> | undefined
    >();
  });

  it('returns the unwrapped service value as query data', () => {
    expectTypeOf<ReturnType<typeof useLeveragePositionInfo>>().toEqualTypeOf<UseQueryResult<LeveragePosition, Error>>();
    expectTypeOf<SdkOk<'getPositionInfo'>>().toEqualTypeOf<LeveragePosition>();
    expectTypeOf<HasAny<LeveragePosition>>().toEqualTypeOf<false>();
  });
});
