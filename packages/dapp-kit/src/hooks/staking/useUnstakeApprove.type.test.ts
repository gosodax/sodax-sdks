/**
 * Compile-time contract: `useUnstakeApprove` resolves to the chain's broadcast hash (`Hex` on EVM and Icon, `string` elsewhere); locking `K` narrows the mutation
 * variables' `walletProvider` and `params` to that chain, and with no type argument they span every chain.
 */
import type {
  ChainKeys,
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
  UnstakeParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { UseUnstakeApproveVars, useUnstakeApprove } from './useUnstakeApprove.js';

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
type Hook<K extends SpokeChainKey> = ReturnType<typeof useUnstakeApprove<K>>;
type Vars<K extends SpokeChainKey> = Parameters<Hook<K>['mutateAsync']>[0];
type Data<K extends SpokeChainKey> = Awaited<ReturnType<Hook<K>['mutateAsync']>>;
type Wallet<K extends SpokeChainKey> = Vars<K>['walletProvider'];
type Params<K extends SpokeChainKey> = Vars<K>['params'];

describe('useUnstakeApprove', () => {
  it('takes mutation options typed by its data and variables', () => {
    expectTypeOf<Parameters<typeof useUnstakeApprove<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, UseUnstakeApproveVars<BSC>> | undefined
    >();
  });

  it('defaults to every chain', () => {
    expectTypeOf<ReturnType<typeof useUnstakeApprove>>().toEqualTypeOf<
      SafeUseMutationResult<string, Error, UseUnstakeApproveVars<SpokeChainKey>>
    >();
    expectTypeOf<Data<SpokeChainKey>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<SpokeChainKey>>().toEqualTypeOf<IWalletProvider>();
    expectTypeOf<Params<SpokeChainKey>>().toEqualTypeOf<Omit<UnstakeParams<SpokeChainKey>, 'action'>>();
  });

  it('narrows the variables and data to the locked chain', () => {
    expectTypeOf<Hook<BSC>>().toEqualTypeOf<SafeUseMutationResult<Hex, Error, UseUnstakeApproveVars<BSC>>>();
    expectTypeOf<Data<BSC>>().toEqualTypeOf<Hex>();
    expectTypeOf<Wallet<BSC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Params<BSC>>().toEqualTypeOf<Omit<UnstakeParams<BSC>, 'action'>>();
    expectTypeOf<Data<SONIC>>().toEqualTypeOf<Hex>();
    expectTypeOf<Wallet<SONIC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Params<SONIC>>().toEqualTypeOf<Omit<UnstakeParams<SONIC>, 'action'>>();
    expectTypeOf<Data<ICON>>().toEqualTypeOf<Hex>();
    expectTypeOf<Wallet<ICON>>().toEqualTypeOf<IIconWalletProvider>();
    expectTypeOf<Params<ICON>>().toEqualTypeOf<Omit<UnstakeParams<ICON>, 'action'>>();
    expectTypeOf<Data<SUI>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<SUI>>().toEqualTypeOf<ISuiWalletProvider>();
    expectTypeOf<Params<SUI>>().toEqualTypeOf<Omit<UnstakeParams<SUI>, 'action'>>();
    expectTypeOf<Data<SOLANA>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<SOLANA>>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<Params<SOLANA>>().toEqualTypeOf<Omit<UnstakeParams<SOLANA>, 'action'>>();
    expectTypeOf<Data<STELLAR>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<STELLAR>>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<Params<STELLAR>>().toEqualTypeOf<Omit<UnstakeParams<STELLAR>, 'action'>>();
    expectTypeOf<Data<INJECTIVE>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<INJECTIVE>>().toEqualTypeOf<IInjectiveWalletProvider>();
    expectTypeOf<Params<INJECTIVE>>().toEqualTypeOf<Omit<UnstakeParams<INJECTIVE>, 'action'>>();
    expectTypeOf<Data<NEAR>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<NEAR>>().toEqualTypeOf<INearWalletProvider>();
    expectTypeOf<Params<NEAR>>().toEqualTypeOf<Omit<UnstakeParams<NEAR>, 'action'>>();
    expectTypeOf<Data<STACKS>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<STACKS>>().toEqualTypeOf<IStacksWalletProvider>();
    expectTypeOf<Params<STACKS>>().toEqualTypeOf<Omit<UnstakeParams<STACKS>, 'action'>>();
    expectTypeOf<Data<BITCOIN>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<BITCOIN>>().toEqualTypeOf<IBitcoinWalletProvider>();
    expectTypeOf<Params<BITCOIN>>().toEqualTypeOf<Omit<UnstakeParams<BITCOIN>, 'action'>>();
  });

  it('rejects variables for another chain or the raw mode', () => {
    const wrongWallet = (m: Hook<BSC>, params: Omit<UnstakeParams<BSC>, 'action'>, wallet: IIconWalletProvider) =>
      // @ts-expect-error — an Icon wallet provider cannot sign a BSC unstake approval
      m.mutate({ params, walletProvider: wallet });
    const wrongChain = (m: Hook<BSC>, params: Omit<UnstakeParams<ICON>, 'action'>, wallet: IEvmWalletProvider) =>
      // @ts-expect-error — params from another chain do not fit the locked chain
      m.mutate({ params, walletProvider: wallet });
    const raw = (m: Hook<BSC>, params: Omit<UnstakeParams<BSC>, 'action'>, wallet: IEvmWalletProvider) =>
      // @ts-expect-error — the hook always signs, so `raw` is not a variable
      m.mutate({ params, walletProvider: wallet, raw: true });
    expectTypeOf(wrongWallet).toBeFunction();
    expectTypeOf(wrongChain).toBeFunction();
    expectTypeOf(raw).toBeFunction();
  });

  it("spells the variables as the SDK params without `action`, plus the chain's wallet provider", () => {
    expectTypeOf<UseUnstakeApproveVars>().toEqualTypeOf<{
      params: Omit<UnstakeParams<SpokeChainKey>, 'action'>;
      walletProvider: IWalletProvider;
    }>();
    expectTypeOf<UseUnstakeApproveVars<BSC>>().toEqualTypeOf<{
      params: Omit<UnstakeParams<BSC>, 'action'>;
      walletProvider: IEvmWalletProvider;
    }>();
    expectTypeOf<UseUnstakeApproveVars<ICON>>().toEqualTypeOf<{
      params: Omit<UnstakeParams<ICON>, 'action'>;
      walletProvider: IIconWalletProvider;
    }>();
  });
});
