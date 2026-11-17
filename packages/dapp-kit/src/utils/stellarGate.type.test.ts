/**
 * Compile-time contract: `resolveStellarGate` takes a destination plus the account-status and
 * trustline checks, and returns the full gate state.
 */
import type { SpokeChainKey, StellarAccountStatus } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { resolveStellarGate, StellarCheckResult, StellarGateInputs, StellarGateState } from './stellarGate.js';

type Check<T> = Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'data'>;
type Inputs = {
  statusCheck: Check<StellarAccountStatus>;
  trustlineCheck: Check<boolean>;
  isNativeToken: boolean;
};
type Gate = {
  isStellar: boolean;
  needsActivation: boolean;
  needsFunding: boolean;
  needsTrustline: boolean;
  checkFailed: boolean;
  blocksAction: boolean;
};

describe('resolveStellarGate', () => {
  it('takes the destination and the two checks', () => {
    expectTypeOf<StellarCheckResult<boolean>>().toEqualTypeOf<Check<boolean>>();
    expectTypeOf<StellarGateInputs>().toEqualTypeOf<Inputs>();
    expectTypeOf<Parameters<typeof resolveStellarGate>>().toEqualTypeOf<
      [chainKey: SpokeChainKey | undefined, inputs: Inputs]
    >();
  });

  it('accepts full query results as checks', () => {
    expectTypeOf<{
      statusCheck: UseQueryResult<StellarAccountStatus, Error>;
      trustlineCheck: UseQueryResult<boolean, Error>;
      isNativeToken: boolean;
    }>().toExtend<StellarGateInputs>();
  });

  it('returns the gate state', () => {
    expectTypeOf<StellarGateState>().toEqualTypeOf<Gate>();
    expectTypeOf<ReturnType<typeof resolveStellarGate>>().toEqualTypeOf<Gate>();
  });

  it('rejects swapped checks', () => {
    type Swapped = { statusCheck: Check<boolean>; trustlineCheck: Check<boolean>; isNativeToken: boolean };
    // @ts-expect-error — the status check must carry a StellarAccountStatus, not a trustline flag
    expectTypeOf<Swapped>().toExtend<StellarGateInputs>();
  });
});
