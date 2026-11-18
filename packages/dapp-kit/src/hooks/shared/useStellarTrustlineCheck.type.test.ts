/**
 * Compile-time contract: `useStellarTrustlineCheck` and its query-options builder read a boolean
 * trustline-sufficiency flag.
 */
import type { Sodax, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from './types.js';
import type {
  getStellarTrustlineCheckQueryOptions,
  UseStellarTrustlineCheckParams,
  useStellarTrustlineCheck,
} from './useStellarTrustlineCheck.js';

type Inputs = {
  token: string | undefined;
  amount: bigint | undefined;
  chainId: SpokeChainKey | undefined;
  walletAddress: string | undefined;
};

describe('getStellarTrustlineCheckQueryOptions', () => {
  it('takes a trustline reader and the inputs', () => {
    expectTypeOf<Parameters<typeof getStellarTrustlineCheckQueryOptions>>().toEqualTypeOf<
      [
        {
          sodax: { spoke: { stellar: Pick<Sodax['spoke']['stellar'], 'hasSufficientTrustline'> } };
          token: string | undefined;
          amount: bigint | undefined;
          chainId: SpokeChainKey | undefined;
          walletAddress: string | undefined;
        },
      ]
    >();
  });

  it('accepts a full Sodax instance as the reader', () => {
    expectTypeOf<{ sodax: Sodax } & Inputs>().toExtend<Parameters<typeof getStellarTrustlineCheckQueryOptions>[0]>();
  });

  it('returns the exact query options', () => {
    expectTypeOf<ReturnType<typeof getStellarTrustlineCheckQueryOptions>>().toEqualTypeOf<{
      queryKey: readonly [
        'shared',
        'stellarTrustlineCheck',
        SpokeChainKey | undefined,
        string | undefined,
        string | undefined,
        string | undefined,
      ];
      queryFn: () => Promise<boolean>;
      enabled: boolean;
    }>();
  });
});

describe('useStellarTrustlineCheck', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseStellarTrustlineCheckParams>().toEqualTypeOf<ReadHookParams<boolean, Inputs>>();
    expectTypeOf<Parameters<typeof useStellarTrustlineCheck>>().toEqualTypeOf<
      [params?: ReadHookParams<boolean, Inputs>]
    >();
  });

  it('returns a boolean query', () => {
    expectTypeOf<ReturnType<typeof useStellarTrustlineCheck>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
  });
});
