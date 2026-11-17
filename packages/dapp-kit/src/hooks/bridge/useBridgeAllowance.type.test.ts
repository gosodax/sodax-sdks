/**
 * Compile-time contract for `useBridgeAllowance`: K is inferred from the params, with no type argument, and ties the
 * wallet provider to the payload's source chain; the query data is the same for every chain.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ChainKeys,
  CreateBridgeIntentParams,
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
import { useBridgeAllowance } from './useBridgeAllowance.js';

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
  payload: CreateBridgeIntentParams<K> | undefined;
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
declare const bscPayload: CreateBridgeIntentParams<BSC>;
declare const sonicPayload: CreateBridgeIntentParams<SONIC>;
declare const iconPayload: CreateBridgeIntentParams<ICON>;
declare const suiPayload: CreateBridgeIntentParams<SUI>;
declare const solanaPayload: CreateBridgeIntentParams<SOLANA>;
declare const stellarPayload: CreateBridgeIntentParams<STELLAR>;
declare const injectivePayload: CreateBridgeIntentParams<INJECTIVE>;
declare const nearPayload: CreateBridgeIntentParams<NEAR>;
declare const stacksPayload: CreateBridgeIntentParams<STACKS>;
declare const bitcoinPayload: CreateBridgeIntentParams<BITCOIN>;

// Never invoked: each call exists only for the K it infers from its params.
const calls = () => ({
  bsc: useBridgeAllowance({ params: { payload: bscPayload, walletProvider: evm } }),
  sonic: useBridgeAllowance({ params: { payload: sonicPayload, walletProvider: evm } }),
  icon: useBridgeAllowance({ params: { payload: iconPayload, walletProvider: icon } }),
  sui: useBridgeAllowance({ params: { payload: suiPayload, walletProvider: sui } }),
  solana: useBridgeAllowance({ params: { payload: solanaPayload, walletProvider: solana } }),
  stellar: useBridgeAllowance({ params: { payload: stellarPayload, walletProvider: stellar } }),
  injective: useBridgeAllowance({ params: { payload: injectivePayload, walletProvider: injective } }),
  near: useBridgeAllowance({ params: { payload: nearPayload, walletProvider: near } }),
  stacks: useBridgeAllowance({ params: { payload: stacksPayload, walletProvider: stacks } }),
  bitcoin: useBridgeAllowance({ params: { payload: bitcoinPayload, walletProvider: bitcoin } }),
  disabled: useBridgeAllowance(),
});
type Calls = ReturnType<typeof calls>;

describe('useBridgeAllowance', () => {
  it('accepts params whose wallet provider is narrowed by K', () => {
    expectTypeOf<Parameters<typeof useBridgeAllowance<BSC>>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Params<BSC, IEvmWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useBridgeAllowance<ICON>>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Params<ICON, IIconWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useBridgeAllowance<SOLANA>>[0]>().toEqualTypeOf<
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
      // @ts-expect-error — a Solana wallet does not match a BSC payload
      useBridgeAllowance({ params: { payload: bscPayload, walletProvider: solana } }),
      // @ts-expect-error — an EVM wallet does not match an ICON payload
      useBridgeAllowance({ params: { payload: iconPayload, walletProvider: evm } }),
    ];
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
