/** Pins `useLeverageYieldApiIntent`: its params and `UseQueryResult<GetIntentResponseV2 | undefined, Error>` over the `getIntent` wire body. */
import type { UseQueryResult } from '@tanstack/react-query';
import type { GetIntentResponseV2, RequestOverrideConfig, Sodax } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldApiIntent } from './useLeverageYieldApiIntent.js';

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

describe('useLeverageYieldApiIntent', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiIntent>[0]>().toEqualTypeOf<
      | ReadHookParams<
          GetIntentResponseV2 | undefined,
          { txHash: string | undefined; apiConfig?: RequestOverrideConfig }
        >
      | undefined
    >();
  });

  it('returns the wire body as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiIntent>>().toEqualTypeOf<
      UseQueryResult<GetIntentResponseV2 | undefined, Error>
    >();
    expectTypeOf<WireOk<'getIntent'>>().toEqualTypeOf<GetIntentResponseV2>();
    expectTypeOf<HasAny<GetIntentResponseV2>>().toEqualTypeOf<false>();
  });
});
