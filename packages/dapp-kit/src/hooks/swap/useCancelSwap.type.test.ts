/**
 * Compile-time contract for `useCancelSwap` (cancels an in-flight swap intent). The hook is not generic, so its variables
 * take any spoke chain with any chain's wallet provider; the data is the unwrapped `TxHashPair`.
 */
import type {
  ChainKeys,
  IEvmWalletProvider,
  Intent,
  ISolanaWalletProvider,
  IWalletProvider,
  SpokeChainKey,
  TxHashPair,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useCancelSwap } from './useCancelSwap.js';

type Vars = {
  srcChainKey: SpokeChainKey;
  walletProvider: IWalletProvider;
  intent: Intent;
};
type Hook = ReturnType<typeof useCancelSwap>;

declare const hook: Hook;
declare const intent: Intent;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const bsc: typeof ChainKeys.BSC_MAINNET;

describe('useCancelSwap', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useCancelSwap>[0]>().toEqualTypeOf<
      MutationHookParams<TxHashPair, Vars> | undefined
    >();
  });

  it('returns the mutation result with its data and variables spelled out', () => {
    expectTypeOf<Hook>().toEqualTypeOf<SafeUseMutationResult<TxHashPair, Error, Vars>>();
    expectTypeOf<Awaited<ReturnType<Hook['mutateAsync']>>>().toEqualTypeOf<TxHashPair>();
  });

  it('does not tie the wallet provider to the source chain', () => {
    const calls = () => [
      hook.mutate({ srcChainKey: bsc, walletProvider: evm, intent }),
      // Not narrowed: a Solana wallet type-checks against a BSC source chain.
      hook.mutate({ srcChainKey: bsc, walletProvider: solana, intent }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      hook.mutate({ srcChainKey: bsc, walletProvider: evm, intent, raw: true }),
      // @ts-expect-error — a signed cancel needs a wallet provider
      hook.mutate({ srcChainKey: bsc, intent }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
