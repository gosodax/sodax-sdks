/**
 * Compile-time contract: `invalidateBalances` takes a QueryClient and any number of optional spoke
 * chain keys, and returns nothing.
 */
import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import type { QueryClient } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import { invalidateBalances } from './invalidateBalances.js';

declare const queryClient: QueryClient;
declare const maybeChain: SpokeChainKey | undefined;

// Never invoked: the calls exist only for their inferred types.
const none = () => invalidateBalances(queryClient);
const pair = () => invalidateBalances(queryClient, ChainKeys.BSC_MAINNET, maybeChain);
const many = () =>
  invalidateBalances(queryClient, ChainKeys.STELLAR_MAINNET, ChainKeys.NEAR_MAINNET, ChainKeys.BITCOIN_MAINNET);

describe('invalidateBalances', () => {
  it('returns void for every arity', () => {
    expectTypeOf(none).returns.toEqualTypeOf<void>();
    expectTypeOf(pair).returns.toEqualTypeOf<void>();
    expectTypeOf(many).returns.toEqualTypeOf<void>();
  });

  it('accepts a QueryClient and optional spoke chain keys', () => {
    expectTypeOf<Parameters<typeof invalidateBalances>>().toEqualTypeOf<
      [queryClient: QueryClient, ...chainKeys: readonly (SpokeChainKey | undefined)[]]
    >();
    // @ts-expect-error — not a spoke chain key
    const unknownChain = () => invalidateBalances(queryClient, 'not-a-chain');
    expectTypeOf(unknownChain).toBeFunction();
  });
});
