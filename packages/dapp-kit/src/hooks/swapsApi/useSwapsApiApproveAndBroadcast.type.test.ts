/**
 * Pins useSwapsApiApproveAndBroadcast: the result is always the approval hashes, and locking the chain
 * key `K` narrows the `walletProvider` in the variables to that chain family's provider.
 */
import type {
  ChainKeys,
  CreateIntentParamsV2,
  IBitcoinWalletProvider,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  RequestOverrideConfig,
  SpokeChainKey,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ApprovalProgressListener } from '../../utils/approvalPlan.js';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type {
  SwapsApiApprovalHashes,
  UseSwapsApiApproveAndBroadcastVars,
  useSwapsApiApproveAndBroadcast,
} from './useSwapsApiApproveAndBroadcast.js';

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

// `K` cannot be inferred: the variables arrive at mutate() time, so each row locks it with a type argument.
type Vars<K extends SpokeChainKey> = Parameters<ReturnType<typeof useSwapsApiApproveAndBroadcast<K>>['mutate']>[0];
type Provider<K extends SpokeChainKey> = Vars<K>['walletProvider'];
type VarsShape<W> = {
  body: CreateIntentParamsV2;
  walletProvider: W;
  apiConfig?: RequestOverrideConfig;
  onProgress?: ApprovalProgressListener;
};

describe('useSwapsApiApproveAndBroadcast', () => {
  it('takes only mutation options typed by the locked chain', () => {
    expectTypeOf<Parameters<typeof useSwapsApiApproveAndBroadcast<BSC>>>().toEqualTypeOf<
      [{ mutationOptions?: MutationHookOptions<SwapsApiApprovalHashes, UseSwapsApiApproveAndBroadcastVars<BSC>> }?]
    >();
    expectTypeOf<UseSwapsApiApproveAndBroadcastVars<BSC>>().toEqualTypeOf<VarsShape<IEvmWalletProvider>>();
  });

  it('resolves to the approval hashes whatever the chain', () => {
    expectTypeOf<SwapsApiApprovalHashes>().toEqualTypeOf<{
      readonly resetTxHash?: string;
      readonly approveTxHash: string;
    }>();
    expectTypeOf<ReturnType<typeof useSwapsApiApproveAndBroadcast>>().toEqualTypeOf<
      SafeUseMutationResult<SwapsApiApprovalHashes, Error, UseSwapsApiApproveAndBroadcastVars<SpokeChainKey>>
    >();
    expectTypeOf<ReturnType<typeof useSwapsApiApproveAndBroadcast<SUI>>>().toEqualTypeOf<
      SafeUseMutationResult<SwapsApiApprovalHashes, Error, UseSwapsApiApproveAndBroadcastVars<SUI>>
    >();
  });

  it('defaults to every spoke chain, so any family provider is accepted', () => {
    expectTypeOf<Provider<SpokeChainKey>>().toEqualTypeOf<
      | IEvmWalletProvider
      | IInjectiveWalletProvider
      | IStellarWalletProvider
      | ISuiWalletProvider
      | IIconWalletProvider
      | IBitcoinWalletProvider
      | ISolanaWalletProvider
      | IStacksWalletProvider
      | INearWalletProvider
    >();
  });

  it('narrows the wallet provider to the locked chain family', () => {
    expectTypeOf<Provider<BSC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Provider<SONIC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Provider<ICON>>().toEqualTypeOf<IIconWalletProvider>();
    expectTypeOf<Provider<SUI>>().toEqualTypeOf<ISuiWalletProvider>();
    expectTypeOf<Provider<SOLANA>>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<Provider<STELLAR>>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<Provider<INJECTIVE>>().toEqualTypeOf<IInjectiveWalletProvider>();
    expectTypeOf<Provider<NEAR>>().toEqualTypeOf<INearWalletProvider>();
    expectTypeOf<Provider<STACKS>>().toEqualTypeOf<IStacksWalletProvider>();
    expectTypeOf<Provider<BITCOIN>>().toEqualTypeOf<IBitcoinWalletProvider>();
  });

  it('rejects another family provider once the chain is locked', () => {
    const evmGetsSui = (
      approve: ReturnType<typeof useSwapsApiApproveAndBroadcast<BSC>>,
      body: CreateIntentParamsV2,
      walletProvider: ISuiWalletProvider,
    ) =>
      // @ts-expect-error — a Sui provider cannot sign for an EVM spoke
      approve.mutate({ body, walletProvider });
    const stellarGetsEvm = (
      approve: ReturnType<typeof useSwapsApiApproveAndBroadcast<STELLAR>>,
      body: CreateIntentParamsV2,
      walletProvider: IEvmWalletProvider,
    ) =>
      // @ts-expect-error — an EVM provider cannot sign for Stellar
      approve.mutate({ body, walletProvider });
    expectTypeOf(evmGetsSui).returns.toBeVoid();
    expectTypeOf(stellarGetsEvm).returns.toBeVoid();
  });
});
