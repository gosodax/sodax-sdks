/**
 * Compile-time contract for `useSwap`: data is always the unwrapped `SwapResponse`; the chain key `K`
 * (locked with a type argument, since the variables only arrive at `mutate()` time) narrows the
 * variables' wallet provider and source chain. Without a type argument they stay the full union.
 */
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
  IWalletProvider,
  SpokeChainKey,
  SwapActionParams,
  SwapResponse,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useSwap } from './useSwap.js';

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

type Vars<K extends SpokeChainKey> = Omit<SwapActionParams<K, false>, 'raw'>;
type Expected<K extends SpokeChainKey> = SafeUseMutationResult<SwapResponse, Error, Vars<K>>;
type Hook<K extends SpokeChainKey> = ReturnType<typeof useSwap<K>>;
type Wallet<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['walletProvider'];
type Src<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['params']['srcChainKey'];

declare const swap: ReturnType<typeof useSwap>;
declare const swapBsc: Hook<BSC>;
declare const bscParams: CreateIntentParams<BSC>;
declare const solanaParams: CreateIntentParams<SOLANA>;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;

describe('useSwap', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useSwap<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<SwapResponse, Vars<BSC>> | undefined
    >();
  });

  it('defaults K to every spoke chain', () => {
    expectTypeOf<ReturnType<typeof useSwap>>().toEqualTypeOf<Expected<SpokeChainKey>>();
    expectTypeOf<Awaited<ReturnType<ReturnType<typeof useSwap>['mutateAsync']>>>().toEqualTypeOf<SwapResponse>();
    expectTypeOf<Wallet<SpokeChainKey>>().toEqualTypeOf<IWalletProvider>();
    expectTypeOf<Src<SpokeChainKey>>().toEqualTypeOf<SpokeChainKey>();
  });

  it('locking K narrows the variables per chain family', () => {
    expectTypeOf<Hook<BSC>>().toEqualTypeOf<Expected<BSC>>();
    expectTypeOf<Hook<SONIC>>().toEqualTypeOf<Expected<SONIC>>();
    expectTypeOf<Hook<ICON>>().toEqualTypeOf<Expected<ICON>>();
    expectTypeOf<Hook<SUI>>().toEqualTypeOf<Expected<SUI>>();
    expectTypeOf<Hook<SOLANA>>().toEqualTypeOf<Expected<SOLANA>>();
    expectTypeOf<Hook<STELLAR>>().toEqualTypeOf<Expected<STELLAR>>();
    expectTypeOf<Hook<INJECTIVE>>().toEqualTypeOf<Expected<INJECTIVE>>();
    expectTypeOf<Hook<NEAR>>().toEqualTypeOf<Expected<NEAR>>();
    expectTypeOf<Hook<STACKS>>().toEqualTypeOf<Expected<STACKS>>();
    expectTypeOf<Hook<BITCOIN>>().toEqualTypeOf<Expected<BITCOIN>>();

    expectTypeOf<Wallet<BSC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Wallet<SONIC>>().toEqualTypeOf<IEvmWalletProvider>();
    expectTypeOf<Wallet<ICON>>().toEqualTypeOf<IIconWalletProvider>();
    expectTypeOf<Wallet<SUI>>().toEqualTypeOf<ISuiWalletProvider>();
    expectTypeOf<Wallet<SOLANA>>().toEqualTypeOf<ISolanaWalletProvider>();
    expectTypeOf<Wallet<STELLAR>>().toEqualTypeOf<IStellarWalletProvider>();
    expectTypeOf<Wallet<INJECTIVE>>().toEqualTypeOf<IInjectiveWalletProvider>();
    expectTypeOf<Wallet<NEAR>>().toEqualTypeOf<INearWalletProvider>();
    expectTypeOf<Wallet<STACKS>>().toEqualTypeOf<IStacksWalletProvider>();
    expectTypeOf<Wallet<BITCOIN>>().toEqualTypeOf<IBitcoinWalletProvider>();
    expectTypeOf<Src<BSC>>().toEqualTypeOf<BSC>();
  });

  it('rejects variables that do not fit the locked chain', () => {
    const calls = () => [
      swap.mutate({ params: solanaParams, walletProvider: evm }),
      swapBsc.mutate({ params: bscParams, walletProvider: evm }),
      // @ts-expect-error — a Solana wallet cannot sign a BSC swap
      swapBsc.mutate({ params: bscParams, walletProvider: solana }),
      // @ts-expect-error — params for another source chain
      swapBsc.mutate({ params: solanaParams, walletProvider: evm }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      swapBsc.mutate({ params: bscParams, walletProvider: evm, raw: true }),
      // @ts-expect-error — a signed swap needs a wallet provider
      swapBsc.mutate({ params: bscParams }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
