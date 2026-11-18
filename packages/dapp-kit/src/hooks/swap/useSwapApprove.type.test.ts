/**
 * Compile-time contract for `useSwapApprove`: the chain key `K` (locked with a type argument, since the
 * variables only arrive at `mutate()` time) narrows the variables' wallet provider and source chain, and
 * the data to that chain's broadcast hash. Without a type argument both stay the full union.
 */
import type {
  ChainKeys,
  CreateIntentParams,
  CreateLimitOrderParams,
  Hex,
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  IWalletProvider,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwapApprove } from './useSwapApprove.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

type Vars<K extends SpokeChainKey, W> = {
  params: CreateIntentParams<K> | CreateLimitOrderParams<K>;
  walletProvider: W;
};
type Expected<K extends SpokeChainKey, W, D> = SafeUseMutationResult<D, Error, Vars<K, W>>;
type Hook<K extends SpokeChainKey> = ReturnType<typeof useSwapApprove<K>>;

declare const approve: ReturnType<typeof useSwapApprove>;
declare const approveBsc: Hook<BSC>;
declare const bscParams: CreateIntentParams<BSC>;
declare const solanaParams: CreateIntentParams<SOLANA>;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;

describe('useSwapApprove', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useSwapApprove<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, Vars<BSC, IEvmWalletProvider>> | undefined
    >();
  });

  it('defaults K to every spoke chain: any wallet, the union of hashes', () => {
    expectTypeOf<ReturnType<typeof useSwapApprove>>().toEqualTypeOf<Expected<SpokeChainKey, IWalletProvider, string>>();
  });

  it('locking K narrows the wallet provider and the hash per chain family', () => {
    expectTypeOf<Hook<BSC>>().toEqualTypeOf<Expected<BSC, IEvmWalletProvider, Hex>>();
    expectTypeOf<Hook<SONIC>>().toEqualTypeOf<Expected<SONIC, IEvmWalletProvider, Hex>>();
    expectTypeOf<Hook<ICON>>().toEqualTypeOf<Expected<ICON, IIconWalletProvider, Hex>>();
    expectTypeOf<Hook<SUI>>().toEqualTypeOf<Expected<SUI, ISuiWalletProvider, string>>();
    expectTypeOf<Hook<SOLANA>>().toEqualTypeOf<Expected<SOLANA, ISolanaWalletProvider, string>>();
    expectTypeOf<Hook<STELLAR>>().toEqualTypeOf<Expected<STELLAR, IStellarWalletProvider, string>>();
    expectTypeOf<Hook<INJECTIVE>>().toEqualTypeOf<Expected<INJECTIVE, IInjectiveWalletProvider, string>>();
    expectTypeOf<Hook<NEAR>>().toEqualTypeOf<Expected<NEAR, INearWalletProvider, string>>();
    expectTypeOf<Hook<STACKS>>().toEqualTypeOf<Expected<STACKS, IStacksWalletProvider, string>>();
    expectTypeOf<Hook<BITCOIN>>().toEqualTypeOf<Expected<BITCOIN, IBitcoinWalletProvider, string>>();
  });

  it('rejects variables that do not fit the locked chain', () => {
    const calls = () => [
      approve.mutate({ params: solanaParams, walletProvider: evm }),
      approveBsc.mutate({ params: bscParams, walletProvider: evm }),
      // @ts-expect-error — a Solana wallet cannot approve on BSC
      approveBsc.mutate({ params: bscParams, walletProvider: solana }),
      // @ts-expect-error — params for another source chain
      approveBsc.mutate({ params: solanaParams, walletProvider: evm }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      approveBsc.mutate({ params: bscParams, walletProvider: evm, raw: true }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
