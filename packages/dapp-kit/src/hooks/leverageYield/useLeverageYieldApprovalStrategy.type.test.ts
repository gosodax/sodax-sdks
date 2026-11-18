/**
 * Pins `useLeverageYieldApprovalStrategy`: the result is `UseQueryResult<ApprovalStrategy, Error>` on every
 * chain; K only narrows the wallet provider the params accept.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ApprovalStrategy,
  ChainKeys,
  GetWalletProviderType,
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
  LeverageYieldSwapPayload,
  Sodax,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import type { useLeverageYieldApprovalStrategy } from './useLeverageYieldApprovalStrategy.js';

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

type ExpectedParams<K extends SpokeChainKey> = ReadHookParams<
  ApprovalStrategy,
  {
    payload: LeverageYieldSwapPayload | undefined;
    walletProvider: GetWalletProviderType<K> | undefined;
    allowAccountUpgrade?: boolean;
  }
>;
// K cannot be inferred back through the conditional `GetWalletProviderType<K>`, so it is passed explicitly.
type ParamsOf<K extends SpokeChainKey> = NonNullable<Parameters<typeof useLeverageYieldApprovalStrategy<K>>[0]>;
type WalletOf<K extends SpokeChainKey> = NonNullable<ParamsOf<K>['params']>['walletProvider'];

declare const payload: LeverageYieldSwapPayload;
declare const solanaWallet: ISolanaWalletProvider;

describe('useLeverageYieldApprovalStrategy', () => {
  it('defaults K to every spoke chain', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApprovalStrategy>[0]>().toEqualTypeOf<
      ExpectedParams<SpokeChainKey> | undefined
    >();
    expectTypeOf<WalletOf<SpokeChainKey>>().toEqualTypeOf<IWalletProvider | undefined>();
  });

  it('returns the approval strategy on every chain', () => {
    expectTypeOf<ReturnType<typeof useLeverageYieldApprovalStrategy>>().toEqualTypeOf<
      UseQueryResult<ApprovalStrategy, Error>
    >();
    expectTypeOf<ReturnType<typeof useLeverageYieldApprovalStrategy<SOLANA>>>().toEqualTypeOf<
      UseQueryResult<ApprovalStrategy, Error>
    >();
    expectTypeOf<
      Extract<Awaited<ReturnType<Sodax['leverageYield']['getApprovalStrategy']>>, { ok: true }>['value']
    >().toEqualTypeOf<ApprovalStrategy>();
  });

  it('narrows the wallet provider per chain family', () => {
    expectTypeOf<ParamsOf<BSC>>().toEqualTypeOf<ExpectedParams<BSC>>();
    expectTypeOf<WalletOf<BSC>>().toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf<WalletOf<SONIC>>().toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf<WalletOf<ICON>>().toEqualTypeOf<IIconWalletProvider | undefined>();
    expectTypeOf<WalletOf<SUI>>().toEqualTypeOf<ISuiWalletProvider | undefined>();
    expectTypeOf<WalletOf<SOLANA>>().toEqualTypeOf<ISolanaWalletProvider | undefined>();
    expectTypeOf<WalletOf<STELLAR>>().toEqualTypeOf<IStellarWalletProvider | undefined>();
    expectTypeOf<WalletOf<INJECTIVE>>().toEqualTypeOf<IInjectiveWalletProvider | undefined>();
    expectTypeOf<WalletOf<NEAR>>().toEqualTypeOf<INearWalletProvider | undefined>();
    expectTypeOf<WalletOf<STACKS>>().toEqualTypeOf<IStacksWalletProvider | undefined>();
    expectTypeOf<WalletOf<BITCOIN>>().toEqualTypeOf<IBitcoinWalletProvider | undefined>();
  });

  it('rejects a wallet from another chain family', () => {
    expectTypeOf(invalidParams).toBeFunction();
  });
});

// Never invoked: a compile-time check only.
function invalidParams(): ParamsOf<BSC> {
  // @ts-expect-error — a Solana wallet cannot sign for a BSC-locked hook
  return { params: { payload, walletProvider: solanaWallet } };
}
