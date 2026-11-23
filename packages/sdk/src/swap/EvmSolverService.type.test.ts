/**
 * Compile-time contract for `EvmSolverService`: the exact result type of every static encoder, decoder
 * and reader. None of them narrow; each is pinned once.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { EvmContractCall, Hex, Intent, IntentState } from '../index.js';
import type { EvmSolverService } from './EvmSolverService.js';

type S = typeof EvmSolverService;

describe('EvmSolverService', () => {
  it('intent construction and fee encoding', () => {
    expectTypeOf<ReturnType<S['constructCreateIntentData']>>().toEqualTypeOf<[Hex, Intent, bigint]>();
    expectTypeOf<ReturnType<S['createIntentFeeData']>>().toEqualTypeOf<[Hex, bigint]>();
    expectTypeOf<ReturnType<S['decodeIntentFeeAmount']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<S['reconstructCreateIntentData']>>().toEqualTypeOf<Hex>();
  });

  it('on-chain readers', () => {
    expectTypeOf<ReturnType<S['getIntent']>>().toEqualTypeOf<Promise<Intent>>();
    expectTypeOf<ReturnType<S['getFilledIntent']>>().toEqualTypeOf<Promise<IntentState>>();
  });

  it('hashing and contract-call encoding', () => {
    expectTypeOf<ReturnType<S['getIntentHash']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<S['encodeCreateIntent']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<S['encodeCancelIntent']>>().toEqualTypeOf<EvmContractCall>();
  });
});
