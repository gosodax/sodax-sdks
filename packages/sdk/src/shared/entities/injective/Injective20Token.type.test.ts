/** Compile-time contract for `Injective20Token.ts`: CW20 queries resolve to their response shapes, executes to `InjectiveExecuteResponse`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { AllowanceResponse, InjectiveBalance, InjectiveExecuteResponse, InjTokenInfo } from '../../../index.js';
import type { Injective20Token } from './Injective20Token.js';

type R<M extends keyof Injective20Token> = ReturnType<Injective20Token[M]>;

describe('Injective20Token type contract', () => {
  it('queries', () => {
    expectTypeOf<R<'getTokenInfo'>>().toEqualTypeOf<Promise<InjTokenInfo>>();
    expectTypeOf<R<'getBalance'>>().toEqualTypeOf<Promise<InjectiveBalance>>();
    expectTypeOf<R<'getAllowance'>>().toEqualTypeOf<Promise<AllowanceResponse>>();
  });

  it('executes', () => {
    expectTypeOf<R<'transfer'>>().toEqualTypeOf<Promise<InjectiveExecuteResponse>>();
    expectTypeOf<R<'increaseAllowance'>>().toEqualTypeOf<Promise<InjectiveExecuteResponse>>();
    expectTypeOf<R<'decreaseAllowance'>>().toEqualTypeOf<Promise<InjectiveExecuteResponse>>();
    expectTypeOf<R<'transferFrom'>>().toEqualTypeOf<Promise<InjectiveExecuteResponse>>();
  });
});
