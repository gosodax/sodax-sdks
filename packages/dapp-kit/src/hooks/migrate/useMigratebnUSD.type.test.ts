/**
 * Compile-time contract for `useMigratebnUSD`: data is always the unwrapped `TxHashPair`; the chain key `K` (locked with a type argument,
 * since the variables only arrive at `mutate()` time) narrows the variables' wallet provider and source
 * chain. Without a type argument they stay the full union.
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
  SpokeChainKey,
  TxHashPair,
  UnifiedBnUSDMigrateAction,
  UnifiedBnUSDMigrateParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useMigratebnUSD } from './useMigratebnUSD.js';

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

type Vars<K extends SpokeChainKey> = Omit<UnifiedBnUSDMigrateAction<K, false>, 'raw'>;
type Expected<K extends SpokeChainKey> = SafeUseMutationResult<TxHashPair, Error, Vars<K>>;
type Hook<K extends SpokeChainKey> = ReturnType<typeof useMigratebnUSD<K>>;
type Wallet<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['walletProvider'];
type Src<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['params']['srcChainKey'];
type Data<K extends SpokeChainKey> = Awaited<ReturnType<Hook<K>['mutateAsync']>>;

declare const hook: ReturnType<typeof useMigratebnUSD>;
declare const hookBsc: Hook<BSC>;
declare const bscParams: UnifiedBnUSDMigrateParams<BSC>;
declare const solanaParams: UnifiedBnUSDMigrateParams<SOLANA>;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;

describe('useMigratebnUSD', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useMigratebnUSD<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<TxHashPair, Vars<BSC>> | undefined
    >();
  });

  it('defaults K to every spoke chain', () => {
    expectTypeOf<ReturnType<typeof useMigratebnUSD>>().toEqualTypeOf<Expected<SpokeChainKey>>();
    expectTypeOf<Data<SpokeChainKey>>().toEqualTypeOf<TxHashPair>();
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
      hook.mutate({ params: solanaParams, walletProvider: evm }),
      hookBsc.mutate({ params: bscParams, walletProvider: evm }),
      // @ts-expect-error — a Solana wallet cannot sign a BSC migration
      hookBsc.mutate({ params: bscParams, walletProvider: solana }),
      // @ts-expect-error — params for another source chain
      hookBsc.mutate({ params: solanaParams, walletProvider: evm }),
      // @ts-expect-error — the hook always signs; raw is not a variable
      hookBsc.mutate({ params: bscParams, walletProvider: evm, raw: true }),
      // @ts-expect-error — a signed migration needs a wallet provider
      hookBsc.mutate({ params: bscParams }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
