/**
 * Compile-time contract for `useSetSwapPreference`: `K` is constrained to the hub chain key, so its
 * default and its only valid type argument are the same; the data is the hub's broadcast `Hex`.
 */
import type {
  ChainKeys,
  Hex,
  HubChainKey,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  SetSwapPreferenceAction,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSetSwapPreference } from './useSetSwapPreference.js';

type SONIC = typeof ChainKeys.SONIC_MAINNET;
type Vars = Omit<SetSwapPreferenceAction<SONIC, false>, 'raw'>;
type Hook = ReturnType<typeof useSetSwapPreference>;

declare const hook: Hook;
declare const params: Vars['params'];
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;

describe('useSetSwapPreference', () => {
  it('the hub chain key is Sonic', () => {
    expectTypeOf<HubChainKey>().toEqualTypeOf<SONIC>();
  });

  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useSetSwapPreference>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, Vars> | undefined
    >();
  });

  it('returns the hub hash and EVM-wallet variables, with or without the type argument', () => {
    expectTypeOf<Hook>().toEqualTypeOf<SafeUseMutationResult<Hex, Error, Vars>>();
    expectTypeOf<ReturnType<typeof useSetSwapPreference<SONIC>>>().toEqualTypeOf<
      SafeUseMutationResult<Hex, Error, Vars>
    >();
    expectTypeOf<Parameters<Hook['mutate']>[0]['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
  });

  it('rejects a spoke chain, another wallet or raw mode', () => {
    // @ts-expect-error — K accepts only the hub chain key
    expectTypeOf<typeof useSetSwapPreference<typeof ChainKeys.BSC_MAINNET>>().toBeFunction();
    const calls = () => [
      hook.mutate({ params, walletProvider: evm }),
      // @ts-expect-error — a Solana wallet cannot sign on the hub
      hook.mutate({ params, walletProvider: solana }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      hook.mutate({ params, walletProvider: evm, raw: true }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
