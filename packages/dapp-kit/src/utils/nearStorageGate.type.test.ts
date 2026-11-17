/**
 * Compile-time contract: `resolveNearStorageGate` takes a destination and the check slice it reads,
 * and returns the three gate flags.
 */
import type { SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { NearStorageCheckResult, NearStorageGateState, resolveNearStorageGate } from './nearStorageGate.js';

type Gate = { isNear: boolean; needsRegistration: boolean; blocksAction: boolean };

describe('resolveNearStorageGate', () => {
  it('reads isLoading and data from a boolean check', () => {
    expectTypeOf<NearStorageCheckResult>().toEqualTypeOf<Pick<UseQueryResult<boolean>, 'isLoading' | 'data'>>();
    expectTypeOf<UseQueryResult<boolean, Error>>().toExtend<NearStorageCheckResult>();
    expectTypeOf<Parameters<typeof resolveNearStorageGate>>().toEqualTypeOf<
      [chainKey: SpokeChainKey | undefined, check: Pick<UseQueryResult<boolean>, 'isLoading' | 'data'>]
    >();
  });

  it('returns the gate flags', () => {
    expectTypeOf<NearStorageGateState>().toEqualTypeOf<Gate>();
    expectTypeOf<ReturnType<typeof resolveNearStorageGate>>().toEqualTypeOf<Gate>();
  });

  it('rejects a non-boolean check', () => {
    // @ts-expect-error — the check must resolve to a registration flag
    expectTypeOf<UseQueryResult<string, Error>>().toExtend<NearStorageCheckResult>();
  });
});
