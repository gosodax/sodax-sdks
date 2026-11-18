/** Pins `useLeverageYieldApiDepositQuote`: its params and `UseQueryResult<QuoteResponseV2 | undefined, Error>` over the `getDepositQuote` wire body. */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  LeverageYieldDepositQuoteRequestV2,
  QuoteQueryV2,
  QuoteResponseV2,
  RequestOverrideConfig,
  Sodax,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldApiDepositQuote } from './useLeverageYieldApiDepositQuote.js';

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

describe('useLeverageYieldApiDepositQuote', () => {
  it('accepts its read params', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiDepositQuote>[0]>().toEqualTypeOf<
      | ReadHookParams<
          QuoteResponseV2 | undefined,
          {
            body: LeverageYieldDepositQuoteRequestV2 | undefined;
            query?: QuoteQueryV2;
            apiConfig?: RequestOverrideConfig;
          }
        >
      | undefined
    >();
  });

  it('returns the wire body as query data', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApiDepositQuote>>().toEqualTypeOf<
      UseQueryResult<QuoteResponseV2 | undefined, Error>
    >();
    expectTypeOf<WireOk<'getDepositQuote'>>().toEqualTypeOf<QuoteResponseV2>();
    expectTypeOf<HasAny<QuoteResponseV2>>().toEqualTypeOf<false>();
  });
});
