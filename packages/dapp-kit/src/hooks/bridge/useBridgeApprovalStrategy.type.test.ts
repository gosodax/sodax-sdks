/**
 * Compile-time contract for `useBridgeApprovalStrategy`: K is inferred from the params, with no type argument, and ties the
 * wallet provider to the payload's source chain; the query data is the same for every chain.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ApprovalStrategy,
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
import { useBridgeApprovalStrategy } from './useBridgeApprovalStrategy.js';

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
  allowAccountUpgrade?: boolean;
};
type Expected = UseQueryResult<ApprovalStrategy, Error>;

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
  bsc: useBridgeApprovalStrategy({ params: { payload: bscPayload, walletProvider: evm } }),
  sonic: useBridgeApprovalStrategy({ params: { payload: sonicPayload, walletProvider: evm } }),
  icon: useBridgeApprovalStrategy({ params: { payload: iconPayload, walletProvider: icon } }),
  sui: useBridgeApprovalStrategy({ params: { payload: suiPayload, walletProvider: sui } }),
  solana: useBridgeApprovalStrategy({ params: { payload: solanaPayload, walletProvider: solana } }),
  stellar: useBridgeApprovalStrategy({ params: { payload: stellarPayload, walletProvider: stellar } }),
  injective: useBridgeApprovalStrategy({ params: { payload: injectivePayload, walletProvider: injective } }),
  near: useBridgeApprovalStrategy({ params: { payload: nearPayload, walletProvider: near } }),
  stacks: useBridgeApprovalStrategy({ params: { payload: stacksPayload, walletProvider: stacks } }),
  bitcoin: useBridgeApprovalStrategy({ params: { payload: bitcoinPayload, walletProvider: bitcoin } }),
  disabled: useBridgeApprovalStrategy(),
});
type Calls = ReturnType<typeof calls>;

describe('useBridgeApprovalStrategy', () => {
  it('accepts params whose wallet provider is narrowed by K', () => {
    expectTypeOf<Parameters<typeof useBridgeApprovalStrategy<BSC>>[0]>().toEqualTypeOf<
      ReadHookParams<ApprovalStrategy, Params<BSC, IEvmWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useBridgeApprovalStrategy<ICON>>[0]>().toEqualTypeOf<
      ReadHookParams<ApprovalStrategy, Params<ICON, IIconWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useBridgeApprovalStrategy<SOLANA>>[0]>().toEqualTypeOf<
      ReadHookParams<ApprovalStrategy, Params<SOLANA, ISolanaWalletProvider>> | undefined
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
    expectTypeOf<Calls['bsc']['data']>().toEqualTypeOf<ApprovalStrategy | undefined>();
  });

  it('rejects a wallet provider for another chain family', () => {
    const invalid = () => [
      // @ts-expect-error — a Solana wallet does not match a BSC payload
      useBridgeApprovalStrategy({ params: { payload: bscPayload, walletProvider: solana } }),
      // @ts-expect-error — an EVM wallet does not match an ICON payload
      useBridgeApprovalStrategy({ params: { payload: iconPayload, walletProvider: evm } }),
    ];
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
