/**
 * Pins `useLeverageYieldApiApproveAndBroadcast`: generic over the source chain with the full union as default, because the
 * variables only arrive at `mutate()`. Locking K narrows the wallet provider per chain family.
 */
import type {
  ChainKeys,
  CreateDepositIntentParamsV2,
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
  RequestOverrideConfig,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ApprovalHashes, ApprovalProgressListener } from '../../utils/approvalPlan.js';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldApiApproveAndBroadcast } from './useLeverageYieldApiApproveAndBroadcast.js';

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

type ExpectedVars<K extends SpokeChainKey> = {
  body: CreateDepositIntentParamsV2;
  walletProvider: GetWalletProviderType<K>;
  apiConfig?: RequestOverrideConfig;
  onProgress?: ApprovalProgressListener;
};
// K cannot be inferred from the hook's arguments (variables arrive at `mutate()`), so it is passed explicitly.
type HookOf<K extends SpokeChainKey> = ReturnType<typeof useLeverageYieldApiApproveAndBroadcast<K>>;
type VarsOf<K extends SpokeChainKey> = Parameters<HookOf<K>['mutate']>[0];
type DataOf<K extends SpokeChainKey> = NonNullable<HookOf<K>['data']>;

declare const bscHook: HookOf<BSC>;
declare const bscVars: VarsOf<BSC>;
declare const solanaWallet: ISolanaWalletProvider;

describe('useLeverageYieldApiApproveAndBroadcast', () => {
  it('defaults K to every spoke chain', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiApproveAndBroadcast>[0]>().toEqualTypeOf<
      MutationHookParams<ApprovalHashes, ExpectedVars<SpokeChainKey>> | undefined
    >();
    expectTypeOf<ReturnType<typeof useLeverageYieldApiApproveAndBroadcast>>().toEqualTypeOf<
      SafeUseMutationResult<ApprovalHashes, Error, ExpectedVars<SpokeChainKey>>
    >();
    expectTypeOf<VarsOf<SpokeChainKey>['walletProvider']>().toEqualTypeOf<IWalletProvider>();
  });

  it('pins the full result once K is locked', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldApiApproveAndBroadcast<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<ApprovalHashes, ExpectedVars<BSC>> | undefined
    >();
    expectTypeOf<HookOf<BSC>>().toEqualTypeOf<SafeUseMutationResult<ApprovalHashes, Error, ExpectedVars<BSC>>>();
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
    expectTypeOf<DataOf<BSC>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<SONIC>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<ICON>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<SUI>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<SOLANA>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<STELLAR>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<INJECTIVE>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<NEAR>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<STACKS>>().toEqualTypeOf<ApprovalHashes>();
    expectTypeOf<DataOf<BITCOIN>>().toEqualTypeOf<ApprovalHashes>();
  });

  it('takes the source chain from the wire body as a plain string', () => {
    // Not tied to K: the backend body carries `srcChainKey: string`, so K only types the wallet.
    expectTypeOf<VarsOf<BSC>['body']['srcChainKey']>().toEqualTypeOf<string>();
  });

  it('rejects variables that do not match the locked chain', () => {
    expectTypeOf(invalidCalls).toBeFunction();
  });
});

// Never invoked: each call is a compile-time check only.
function invalidCalls(): void {
  // @ts-expect-error — a Solana wallet cannot sign for a BSC-locked hook
  bscHook.mutate({ ...bscVars, walletProvider: solanaWallet });
}
