/**
 * Compile-time contract for `useSwapLifecycle`: K is inferred from `intentParams` with no type argument
 * and narrows the source wallet and the composed swap mutation's variables; the rest of the lifecycle is
 * the same for every chain. Without intent params K falls back to every spoke chain.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ChainKeys,
  CreateIntentParams,
  DetailedStatusError,
  DetailedSwapStatus,
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
  Result,
  SpokeChainKey,
  SwapApprovalStrategy,
  SwapExtras,
  SwapWithApprovalParams,
  SwapWithApprovalResponse,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { NearStorageGate } from '../shared/useNearStorageGate.js';
import type { StellarGate } from '../shared/useStellarGate.js';
import type { MutationHookOptions } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { SwapLifecycleState } from '../../utils/swapLifecycle.js';
import { useSwapLifecycle } from './useSwapLifecycle.js';

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

type SwapVars<K extends SpokeChainKey> = Omit<SwapWithApprovalParams<K>, 'raw'>;
type Lifecycle<K extends SpokeChainKey> = {
  state: SwapLifecycleState;
  error: Error | undefined;
  // `unknown`: the result of whichever action `next()` ran (swap, Stellar or NEAR setup).
  next: () => Promise<Result<unknown> | undefined>;
  reset: () => void;
  approvalStrategy: UseQueryResult<SwapApprovalStrategy, Error>;
  swap: SafeUseMutationResult<SwapWithApprovalResponse, Error, SwapVars<K>>;
  status: UseQueryResult<Result<DetailedSwapStatus, DetailedStatusError> | undefined, Error>;
  stellar: StellarGate;
  nearStorage: NearStorageGate;
};
type Params<K extends SpokeChainKey> = Parameters<typeof useSwapLifecycle<K>>[0];

declare const evm: IEvmWalletProvider;
declare const icon: IIconWalletProvider;
declare const sui: ISuiWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const stellar: IStellarWalletProvider;
declare const injective: IInjectiveWalletProvider;
declare const near: INearWalletProvider;
declare const stacks: IStacksWalletProvider;
declare const bitcoin: IBitcoinWalletProvider;
declare const bscIntent: CreateIntentParams<BSC>;
declare const sonicIntent: CreateIntentParams<SONIC>;
declare const iconIntent: CreateIntentParams<ICON>;
declare const suiIntent: CreateIntentParams<SUI>;
declare const solanaIntent: CreateIntentParams<SOLANA>;
declare const stellarIntent: CreateIntentParams<STELLAR>;
declare const injectiveIntent: CreateIntentParams<INJECTIVE>;
declare const nearIntent: CreateIntentParams<NEAR>;
declare const stacksIntent: CreateIntentParams<STACKS>;
declare const bitcoinIntent: CreateIntentParams<BITCOIN>;

// Never invoked: each call exists only for the K it infers from `intentParams`.
const calls = () => ({
  bsc: useSwapLifecycle({ intentParams: bscIntent, srcWalletProvider: evm, dstWalletProvider: evm }),
  sonic: useSwapLifecycle({ intentParams: sonicIntent, srcWalletProvider: evm, dstWalletProvider: evm }),
  icon: useSwapLifecycle({ intentParams: iconIntent, srcWalletProvider: icon, dstWalletProvider: evm }),
  sui: useSwapLifecycle({ intentParams: suiIntent, srcWalletProvider: sui, dstWalletProvider: evm }),
  solana: useSwapLifecycle({ intentParams: solanaIntent, srcWalletProvider: solana, dstWalletProvider: evm }),
  stellar: useSwapLifecycle({ intentParams: stellarIntent, srcWalletProvider: stellar, dstWalletProvider: evm }),
  injective: useSwapLifecycle({ intentParams: injectiveIntent, srcWalletProvider: injective, dstWalletProvider: evm }),
  near: useSwapLifecycle({ intentParams: nearIntent, srcWalletProvider: near, dstWalletProvider: evm }),
  stacks: useSwapLifecycle({ intentParams: stacksIntent, srcWalletProvider: stacks, dstWalletProvider: evm }),
  bitcoin: useSwapLifecycle({ intentParams: bitcoinIntent, srcWalletProvider: bitcoin, dstWalletProvider: evm }),
  idle: useSwapLifecycle({ intentParams: undefined, srcWalletProvider: undefined, dstWalletProvider: undefined }),
});
type Calls = ReturnType<typeof calls>;

describe('useSwapLifecycle', () => {
  it('params: the source wallet and swap options follow K, the destination wallet is any chain', () => {
    expectTypeOf<Params<BSC>['intentParams']>().toEqualTypeOf<CreateIntentParams<BSC> | undefined>();
    expectTypeOf<Params<BSC>['srcWalletProvider']>().toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf<Params<SOLANA>['srcWalletProvider']>().toEqualTypeOf<ISolanaWalletProvider | undefined>();
    expectTypeOf<Params<BSC>['dstWalletProvider']>().toEqualTypeOf<IWalletProvider | undefined>();
    expectTypeOf<Params<BSC>['extras']>().toEqualTypeOf<SwapExtras<BSC> | undefined>();
    expectTypeOf<Params<BSC>['mutationOptions']>().toEqualTypeOf<
      MutationHookOptions<SwapWithApprovalResponse, SwapVars<BSC>> | undefined
    >();
  });

  it('infers K from intentParams for every chain family', () => {
    expectTypeOf<Calls['bsc']>().toEqualTypeOf<Lifecycle<BSC>>();
    expectTypeOf<Calls['sonic']>().toEqualTypeOf<Lifecycle<SONIC>>();
    expectTypeOf<Calls['icon']>().toEqualTypeOf<Lifecycle<ICON>>();
    expectTypeOf<Calls['sui']>().toEqualTypeOf<Lifecycle<SUI>>();
    expectTypeOf<Calls['solana']>().toEqualTypeOf<Lifecycle<SOLANA>>();
    expectTypeOf<Calls['stellar']>().toEqualTypeOf<Lifecycle<STELLAR>>();
    expectTypeOf<Calls['injective']>().toEqualTypeOf<Lifecycle<INJECTIVE>>();
    expectTypeOf<Calls['near']>().toEqualTypeOf<Lifecycle<NEAR>>();
    expectTypeOf<Calls['stacks']>().toEqualTypeOf<Lifecycle<STACKS>>();
    expectTypeOf<Calls['bitcoin']>().toEqualTypeOf<Lifecycle<BITCOIN>>();
    expectTypeOf<Calls['idle']>().toEqualTypeOf<Lifecycle<SpokeChainKey>>();
  });

  it('rejects a source wallet for another chain family', () => {
    const invalid = () => [
      // @ts-expect-error — a Solana wallet cannot sign a BSC swap
      useSwapLifecycle({ intentParams: bscIntent, srcWalletProvider: solana, dstWalletProvider: evm }),
      // @ts-expect-error — an EVM wallet cannot sign an ICON swap
      useSwapLifecycle({ intentParams: iconIntent, srcWalletProvider: evm, dstWalletProvider: evm }),
    ];
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
