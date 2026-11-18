/**
 * Compile-time contract for `useBridgeApprove`: the chain key `K` (locked with a type argument, since the variables
 * only arrive at `mutate()` time) narrows the variables' wallet provider and source chain, and the data to
 * that chain's broadcast hash. Without a type argument both stay the full union.
 */
import type {
  BridgeParams,
  ChainKeys,
  CreateBridgeIntentParams,
  Hex,
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
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useBridgeApprove } from './useBridgeApprove.js';

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

type Vars<K extends SpokeChainKey> = Omit<BridgeParams<K, false>, 'raw'>;
type Expected<K extends SpokeChainKey, D> = SafeUseMutationResult<D, Error, Vars<K>>;
type Hook<K extends SpokeChainKey> = ReturnType<typeof useBridgeApprove<K>>;
type Wallet<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['walletProvider'];
type Src<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['params']['srcChainKey'];
type Data<K extends SpokeChainKey> = Awaited<ReturnType<Hook<K>['mutateAsync']>>;

declare const hook: ReturnType<typeof useBridgeApprove>;
declare const hookBsc: Hook<BSC>;
declare const bscParams: CreateBridgeIntentParams<BSC>;
declare const solanaParams: CreateBridgeIntentParams<SOLANA>;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;

describe('useBridgeApprove', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useBridgeApprove<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, Vars<BSC>> | undefined
    >();
  });

  it('defaults K to every spoke chain', () => {
    expectTypeOf<ReturnType<typeof useBridgeApprove>>().toEqualTypeOf<Expected<SpokeChainKey, string>>();
    // Every chain's hash: EVM/ICON `Hex` folds into `string`.
    expectTypeOf<Data<SpokeChainKey>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<SpokeChainKey>>().toEqualTypeOf<IWalletProvider>();
    expectTypeOf<Src<SpokeChainKey>>().toEqualTypeOf<SpokeChainKey>();
  });

  it('locking K narrows the variables and the hash per chain family', () => {
    expectTypeOf<Hook<BSC>>().toEqualTypeOf<Expected<BSC, Hex>>();
    expectTypeOf<Hook<SONIC>>().toEqualTypeOf<Expected<SONIC, Hex>>();
    expectTypeOf<Hook<ICON>>().toEqualTypeOf<Expected<ICON, Hex>>();
    expectTypeOf<Hook<SUI>>().toEqualTypeOf<Expected<SUI, string>>();
    expectTypeOf<Hook<SOLANA>>().toEqualTypeOf<Expected<SOLANA, string>>();
    expectTypeOf<Hook<STELLAR>>().toEqualTypeOf<Expected<STELLAR, string>>();
    expectTypeOf<Hook<INJECTIVE>>().toEqualTypeOf<Expected<INJECTIVE, string>>();
    expectTypeOf<Hook<NEAR>>().toEqualTypeOf<Expected<NEAR, string>>();
    expectTypeOf<Hook<STACKS>>().toEqualTypeOf<Expected<STACKS, string>>();
    expectTypeOf<Hook<BITCOIN>>().toEqualTypeOf<Expected<BITCOIN, string>>();
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
    expectTypeOf<Data<BSC>>().toEqualTypeOf<Hex>();
    expectTypeOf<Data<SONIC>>().toEqualTypeOf<Hex>();
    expectTypeOf<Data<ICON>>().toEqualTypeOf<Hex>();
    expectTypeOf<Data<SUI>>().toEqualTypeOf<string>();
    expectTypeOf<Data<SOLANA>>().toEqualTypeOf<string>();
    expectTypeOf<Data<STELLAR>>().toEqualTypeOf<string>();
    expectTypeOf<Data<INJECTIVE>>().toEqualTypeOf<string>();
    expectTypeOf<Data<NEAR>>().toEqualTypeOf<string>();
    expectTypeOf<Data<STACKS>>().toEqualTypeOf<string>();
    expectTypeOf<Data<BITCOIN>>().toEqualTypeOf<string>();
    expectTypeOf<Src<BSC>>().toEqualTypeOf<BSC>();
  });

  it('rejects variables that do not fit the locked chain', () => {
    const calls = () => [
      hook.mutate({ params: solanaParams, walletProvider: evm }),
      hookBsc.mutate({ params: bscParams, walletProvider: evm }),
      // @ts-expect-error — a Solana wallet cannot sign a BSC bridge approval
      hookBsc.mutate({ params: bscParams, walletProvider: solana }),
      // @ts-expect-error — params for another source chain
      hookBsc.mutate({ params: solanaParams, walletProvider: evm }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      hookBsc.mutate({ params: bscParams, walletProvider: evm, raw: true }),
      // @ts-expect-error — a signed bridge approval needs a wallet provider
      hookBsc.mutate({ params: bscParams }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
