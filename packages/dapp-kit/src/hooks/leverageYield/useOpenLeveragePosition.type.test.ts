/**
 * Pins `useOpenLeveragePosition`: generic over the source chain with the full union as default, because the
 * variables only arrive at `mutate()`. Locking K narrows the wallet provider per chain family.
 */
import type {
  ChainKeys,
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
  LeveragePositionIntentResult,
  OpenPositionFromDebtTokenParams,
  OpenPositionParams,
  SpokeChainKey,
  SpokeExecActionParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useOpenLeveragePosition } from './useOpenLeveragePosition.js';

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

type ExpectedVars<K extends SpokeChainKey> =
  | ({ side?: 'collateral' } & Omit<SpokeExecActionParams<K, false, OpenPositionParams<K>>, 'raw'>)
  | ({ side: 'debt' } & Omit<SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>, 'raw'>);
// K cannot be inferred from the hook's arguments (variables arrive at `mutate()`), so it is passed explicitly.
type HookOf<K extends SpokeChainKey> = ReturnType<typeof useOpenLeveragePosition<K>>;
type VarsOf<K extends SpokeChainKey> = Parameters<HookOf<K>['mutate']>[0];
type DataOf<K extends SpokeChainKey> = NonNullable<HookOf<K>['data']>;

declare const bscHook: HookOf<BSC>;
declare const bscVars: VarsOf<BSC>;
declare const solanaWallet: ISolanaWalletProvider;
declare const collateralParams: OpenPositionParams<BSC>;
declare const evmWallet: IEvmWalletProvider;

describe('useOpenLeveragePosition', () => {
  it('defaults K to every spoke chain', () => {
    expectTypeOf<Parameters<typeof useOpenLeveragePosition>[0]>().toEqualTypeOf<
      MutationHookParams<LeveragePositionIntentResult, ExpectedVars<SpokeChainKey>> | undefined
    >();
    expectTypeOf<ReturnType<typeof useOpenLeveragePosition>>().toEqualTypeOf<
      SafeUseMutationResult<LeveragePositionIntentResult, Error, ExpectedVars<SpokeChainKey>>
    >();
    expectTypeOf<VarsOf<SpokeChainKey>['walletProvider']>().toEqualTypeOf<IWalletProvider>();
  });

  it('pins the full result once K is locked', () => {
    expectTypeOf<Parameters<typeof useOpenLeveragePosition<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<LeveragePositionIntentResult, ExpectedVars<BSC>> | undefined
    >();
    expectTypeOf<HookOf<BSC>>().toEqualTypeOf<
      SafeUseMutationResult<LeveragePositionIntentResult, Error, ExpectedVars<BSC>>
    >();
  });

  it('narrows the wallet provider per chain family', () => {
    expectTypeOf<VarsOf<BSC>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<VarsOf<SONIC>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<VarsOf<ICON>['walletProvider']>().toEqualTypeOf<IIconWalletProvider>();
    expectTypeOf<VarsOf<SUI>['walletProvider']>().toEqualTypeOf<ISuiWalletProvider>();
    expectTypeOf<VarsOf<SOLANA>['walletProvider']>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<VarsOf<STELLAR>['walletProvider']>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<VarsOf<INJECTIVE>['walletProvider']>().toEqualTypeOf<IInjectiveWalletProvider>();
    expectTypeOf<VarsOf<NEAR>['walletProvider']>().toEqualTypeOf<INearWalletProvider>();
    expectTypeOf<VarsOf<STACKS>['walletProvider']>().toEqualTypeOf<IStacksWalletProvider>();
    expectTypeOf<VarsOf<BITCOIN>['walletProvider']>().toEqualTypeOf<IBitcoinWalletProvider>();
  });

  it('keeps one data type on every chain', () => {
    expectTypeOf<DataOf<BSC>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<SONIC>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<ICON>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<SUI>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<SOLANA>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<STELLAR>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<INJECTIVE>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<NEAR>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<STACKS>>().toEqualTypeOf<LeveragePositionIntentResult>();
    expectTypeOf<DataOf<BITCOIN>>().toEqualTypeOf<LeveragePositionIntentResult>();
  });

  it('selects the params shape by `side`', () => {
    expectTypeOf<Extract<VarsOf<BSC>, { side: 'debt' }>['params']>().toEqualTypeOf<
      OpenPositionFromDebtTokenParams<BSC>
    >();
    expectTypeOf<Exclude<VarsOf<BSC>, { side: 'debt' }>['params']>().toEqualTypeOf<OpenPositionParams<BSC>>();
  });

  it('rejects variables that do not match the locked chain', () => {
    expectTypeOf(invalidCalls).toBeFunction();
  });
});

// Never invoked: each call is a compile-time check only.
function invalidCalls(): void {
  // @ts-expect-error — a Solana wallet cannot sign for a BSC-locked hook
  bscHook.mutate({ ...bscVars, walletProvider: solanaWallet });
  // @ts-expect-error — `side: 'debt'` needs the debt-token params (`collateral`, `totalInput`)
  bscHook.mutate({ side: 'debt', params: collateralParams, walletProvider: evmWallet });
}
