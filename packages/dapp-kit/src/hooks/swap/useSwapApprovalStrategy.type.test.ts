/**
 * Compile-time contract for `useSwapApprovalStrategy`: K is inferred from the params, with no type argument, and ties the
 * wallet provider to the payload's source chain; the query data is the same for every chain.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ChainKeys,
  CreateIntentParams,
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
  SwapApprovalStrategy,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import { useSwapApprovalStrategy } from './useSwapApprovalStrategy.js';

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
  payload: CreateIntentParams<K> | undefined;
  walletProvider: W | undefined;
  allowAccountUpgrade?: boolean;
};
type Expected = UseQueryResult<SwapApprovalStrategy, Error>;

declare const evm: IEvmWalletProvider;
declare const icon: IIconWalletProvider;
declare const sui: ISuiWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const stellar: IStellarWalletProvider;
declare const injective: IInjectiveWalletProvider;
declare const near: INearWalletProvider;
declare const stacks: IStacksWalletProvider;
declare const bitcoin: IBitcoinWalletProvider;
declare const bscPayload: CreateIntentParams<BSC>;
declare const sonicPayload: CreateIntentParams<SONIC>;
declare const iconPayload: CreateIntentParams<ICON>;
declare const suiPayload: CreateIntentParams<SUI>;
declare const solanaPayload: CreateIntentParams<SOLANA>;
declare const stellarPayload: CreateIntentParams<STELLAR>;
declare const injectivePayload: CreateIntentParams<INJECTIVE>;
declare const nearPayload: CreateIntentParams<NEAR>;
declare const stacksPayload: CreateIntentParams<STACKS>;
declare const bitcoinPayload: CreateIntentParams<BITCOIN>;

// Never invoked: each call exists only for the K it infers from its params.
const calls = () => ({
  bsc: useSwapApprovalStrategy({ params: { payload: bscPayload, walletProvider: evm } }),
  sonic: useSwapApprovalStrategy({ params: { payload: sonicPayload, walletProvider: evm } }),
  icon: useSwapApprovalStrategy({ params: { payload: iconPayload, walletProvider: icon } }),
  sui: useSwapApprovalStrategy({ params: { payload: suiPayload, walletProvider: sui } }),
  solana: useSwapApprovalStrategy({ params: { payload: solanaPayload, walletProvider: solana } }),
  stellar: useSwapApprovalStrategy({ params: { payload: stellarPayload, walletProvider: stellar } }),
  injective: useSwapApprovalStrategy({ params: { payload: injectivePayload, walletProvider: injective } }),
  near: useSwapApprovalStrategy({ params: { payload: nearPayload, walletProvider: near } }),
  stacks: useSwapApprovalStrategy({ params: { payload: stacksPayload, walletProvider: stacks } }),
  bitcoin: useSwapApprovalStrategy({ params: { payload: bitcoinPayload, walletProvider: bitcoin } }),
  disabled: useSwapApprovalStrategy(),
});
type Calls = ReturnType<typeof calls>;

describe('useSwapApprovalStrategy', () => {
  it('accepts params whose wallet provider is narrowed by K', () => {
    expectTypeOf<Parameters<typeof useSwapApprovalStrategy<BSC>>[0]>().toEqualTypeOf<
      ReadHookParams<SwapApprovalStrategy, Params<BSC, IEvmWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useSwapApprovalStrategy<ICON>>[0]>().toEqualTypeOf<
      ReadHookParams<SwapApprovalStrategy, Params<ICON, IIconWalletProvider>> | undefined
    >();
    expectTypeOf<Parameters<typeof useSwapApprovalStrategy<SOLANA>>[0]>().toEqualTypeOf<
      ReadHookParams<SwapApprovalStrategy, Params<SOLANA, ISolanaWalletProvider>> | undefined
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
    expectTypeOf<Calls['bsc']['data']>().toEqualTypeOf<SwapApprovalStrategy | undefined>();
  });

  it('rejects a wallet provider for another chain family', () => {
    const invalid = () => [
      // @ts-expect-error — a Solana wallet does not match a BSC payload
      useSwapApprovalStrategy({ params: { payload: bscPayload, walletProvider: solana } }),
      // @ts-expect-error — an EVM wallet does not match an ICON payload
      useSwapApprovalStrategy({ params: { payload: iconPayload, walletProvider: evm } }),
    ];
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
