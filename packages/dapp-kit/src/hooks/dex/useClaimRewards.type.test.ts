/**
 * Compile-time contract: `useClaimRewards` resolves to `TxHashPair` on every chain; locking `K` narrows the mutation
 * variables' `walletProvider` and `params` to that chain, and with no type argument they span every chain.
 */
import type {
  ChainKeys,
  ClClaimRewardsParams,
  ClLiquidityClaimRewardsAction,
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
  TxHashPair,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { UseClaimRewardsVars, useClaimRewards } from './useClaimRewards.js';

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

// `K` arrives only with `mutate(vars)`, so it is locked with a type argument (instantiation expression).
type Hook<K extends SpokeChainKey> = ReturnType<typeof useClaimRewards<K>>;
type Vars<K extends SpokeChainKey> = Parameters<Hook<K>['mutateAsync']>[0];
type Data<K extends SpokeChainKey> = Awaited<ReturnType<Hook<K>['mutateAsync']>>;
type Wallet<K extends SpokeChainKey> = Vars<K>['walletProvider'];
type Params<K extends SpokeChainKey> = Vars<K>['params'];

describe('useClaimRewards', () => {
  it('takes mutation options typed by its data and variables', () => {
    expectTypeOf<Parameters<typeof useClaimRewards<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<TxHashPair, UseClaimRewardsVars<BSC>> | undefined
    >();
  });

  it('defaults to every chain', () => {
    expectTypeOf<ReturnType<typeof useClaimRewards>>().toEqualTypeOf<
      SafeUseMutationResult<TxHashPair, Error, UseClaimRewardsVars<SpokeChainKey>>
    >();
    expectTypeOf<Data<SpokeChainKey>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<SpokeChainKey>>().toEqualTypeOf<IWalletProvider>();
    expectTypeOf<Params<SpokeChainKey>>().toEqualTypeOf<ClClaimRewardsParams<SpokeChainKey>>();
  });

  it('narrows the variables and data to the locked chain', () => {
    expectTypeOf<Hook<BSC>>().toEqualTypeOf<SafeUseMutationResult<TxHashPair, Error, UseClaimRewardsVars<BSC>>>();
    expectTypeOf<Data<BSC>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<BSC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Params<BSC>>().toEqualTypeOf<ClClaimRewardsParams<BSC>>();
    expectTypeOf<Data<SONIC>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<SONIC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Params<SONIC>>().toEqualTypeOf<ClClaimRewardsParams<SONIC>>();
    expectTypeOf<Data<ICON>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<ICON>>().toEqualTypeOf<IIconWalletProvider>();
    expectTypeOf<Params<ICON>>().toEqualTypeOf<ClClaimRewardsParams<ICON>>();
    expectTypeOf<Data<SUI>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<SUI>>().toEqualTypeOf<ISuiWalletProvider>();
    expectTypeOf<Params<SUI>>().toEqualTypeOf<ClClaimRewardsParams<SUI>>();
    expectTypeOf<Data<SOLANA>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<SOLANA>>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<Params<SOLANA>>().toEqualTypeOf<ClClaimRewardsParams<SOLANA>>();
    expectTypeOf<Data<STELLAR>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<STELLAR>>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<Params<STELLAR>>().toEqualTypeOf<ClClaimRewardsParams<STELLAR>>();
    expectTypeOf<Data<INJECTIVE>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<INJECTIVE>>().toEqualTypeOf<IInjectiveWalletProvider>();
    expectTypeOf<Params<INJECTIVE>>().toEqualTypeOf<ClClaimRewardsParams<INJECTIVE>>();
    expectTypeOf<Data<NEAR>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<NEAR>>().toEqualTypeOf<INearWalletProvider>();
    expectTypeOf<Params<NEAR>>().toEqualTypeOf<ClClaimRewardsParams<NEAR>>();
    expectTypeOf<Data<STACKS>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<STACKS>>().toEqualTypeOf<IStacksWalletProvider>();
    expectTypeOf<Params<STACKS>>().toEqualTypeOf<ClClaimRewardsParams<STACKS>>();
    expectTypeOf<Data<BITCOIN>>().toEqualTypeOf<TxHashPair>();
    expectTypeOf<Wallet<BITCOIN>>().toEqualTypeOf<IBitcoinWalletProvider>();
    expectTypeOf<Params<BITCOIN>>().toEqualTypeOf<ClClaimRewardsParams<BITCOIN>>();
  });

  it('rejects variables for another chain or the raw mode', () => {
    const wrongWallet = (m: Hook<BSC>, params: ClClaimRewardsParams<BSC>, wallet: IIconWalletProvider) =>
      // @ts-expect-error — an Icon wallet provider cannot sign a BSC rewards claim
      m.mutate({ params, walletProvider: wallet });
    const wrongChain = (m: Hook<BSC>, params: ClClaimRewardsParams<ICON>, wallet: IEvmWalletProvider) =>
      // @ts-expect-error — params from another chain do not fit the locked chain
      m.mutate({ params, walletProvider: wallet });
    const raw = (m: Hook<BSC>, params: ClClaimRewardsParams<BSC>, wallet: IEvmWalletProvider) =>
      // @ts-expect-error — the hook always signs, so `raw` is not a variable
      m.mutate({ params, walletProvider: wallet, raw: true });
    expectTypeOf(wrongWallet).toBeFunction();
    expectTypeOf(wrongChain).toBeFunction();
    expectTypeOf(raw).toBeFunction();
  });

  it('spells the variables as the SDK action params without `raw`', () => {
    expectTypeOf<UseClaimRewardsVars>().toEqualTypeOf<
      Omit<ClLiquidityClaimRewardsAction<SpokeChainKey, false>, 'raw'>
    >();
    expectTypeOf<UseClaimRewardsVars<BSC>>().toEqualTypeOf<Omit<ClLiquidityClaimRewardsAction<BSC, false>, 'raw'>>();
    expectTypeOf<UseClaimRewardsVars<ICON>>().toEqualTypeOf<Omit<ClLiquidityClaimRewardsAction<ICON, false>, 'raw'>>();
  });
});
