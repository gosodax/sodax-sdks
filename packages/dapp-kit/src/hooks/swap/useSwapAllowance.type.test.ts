/**
 * Compile-time contract for `useSwapAllowance`: K is inferred from the params, with no type argument, and ties the
 * wallet provider to `srcChainKey` (the payload itself is not keyed by K); the query data is the same for every chain.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ChainKeys,
  CreateIntentParams,
  CreateLimitOrderParams,
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import { useSwapAllowance } from './useSwapAllowance.js';

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

type Params<K extends SpokeChainKey, W> = {
  payload: CreateIntentParams | CreateLimitOrderParams | undefined;
  srcChainKey: K | undefined;
  walletProvider: W | undefined;
};
type Expected = UseQueryResult<boolean, Error>;

declare const evm: IEvmWalletProvider;
declare const icon: IIconWalletProvider;
declare const sui: ISuiWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const stellar: IStellarWalletProvider;
declare const injective: IInjectiveWalletProvider;
declare const near: INearWalletProvider;
declare const stacks: IStacksWalletProvider;
declare const bitcoin: IBitcoinWalletProvider;
declare const payload: CreateIntentParams;
declare const bscKey: BSC;
declare const sonicKey: SONIC;
declare const iconKey: ICON;
declare const suiKey: SUI;
declare const solanaKey: SOLANA;
declare const stellarKey: STELLAR;
declare const injectiveKey: INJECTIVE;
declare const nearKey: NEAR;
declare const stacksKey: STACKS;
declare const bitcoinKey: BITCOIN;

// Never invoked: each call exists only for the K it infers from its params.
const calls = () => ({
  bsc: useSwapAllowance({ params: { payload, srcChainKey: bscKey, walletProvider: evm } }),
  sonic: useSwapAllowance({ params: { payload, srcChainKey: sonicKey, walletProvider: evm } }),
  icon: useSwapAllowance({ params: { payload, srcChainKey: iconKey, walletProvider: icon } }),
  sui: useSwapAllowance({ params: { payload, srcChainKey: suiKey, walletProvider: sui } }),
  solana: useSwapAllowance({ params: { payload, srcChainKey: solanaKey, walletProvider: solana } }),
  stellar: useSwapAllowance({ params: { payload, srcChainKey: stellarKey, walletProvider: stellar } }),
  injective: useSwapAllowance({ params: { payload, srcChainKey: injectiveKey, walletProvider: injective } }),
  near: useSwapAllowance({ params: { payload, srcChainKey: nearKey, walletProvider: near } }),
  stacks: useSwapAllowance({ params: { payload, srcChainKey: stacksKey, walletProvider: stacks } }),
  bitcoin: useSwapAllowance({ params: { payload, srcChainKey: bitcoinKey, walletProvider: bitcoin } }),
  disabled: useSwapAllowance(),
});
type Calls = ReturnType<typeof calls>;

describe('useSwapAllowance', () => {
  it('accepts params whose wallet provider is narrowed by K', () => {
    expectTypeOf<Parameters<typeof useSwapAllowance<BSC>>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Params<BSC, IEvmWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useSwapAllowance<ICON>>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Params<ICON, IIconWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useSwapAllowance<SOLANA>>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Params<SOLANA, ISolanaWalletProvider>> | undefined
    >();
  });

  it('infers K from the params of every chain family; the query data stays exact', () => {
    expectTypeOf<Calls['bsc']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['sonic']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['icon']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['sui']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['solana']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['stellar']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['injective']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['near']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['stacks']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['bitcoin']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['disabled']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['bsc']['data']>().toEqualTypeOf<boolean | undefined>();
  });

  it('rejects a wallet provider for another chain family', () => {
    const invalid = () => [
      // @ts-expect-error — a Solana wallet does not match a BSC source chain
      useSwapAllowance({ params: { payload, srcChainKey: bscKey, walletProvider: solana } }),
      // @ts-expect-error — an EVM wallet does not match an ICON source chain
      useSwapAllowance({ params: { payload, srcChainKey: iconKey, walletProvider: evm } }),
    ];
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
