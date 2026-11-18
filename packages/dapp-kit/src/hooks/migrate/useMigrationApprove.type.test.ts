/**
 * Compile-time contract for `useMigrationApprove`: the variables are either an ICX revert (always the
 * Sonic hub, EVM wallet) or a bnUSD migration from chain `K`, plus the `action`. Locking `K` (a type
 * argument, since the variables only arrive at `mutate()` time) narrows the bnUSD variant's wallet and
 * the data to `K`'s broadcast hash; the revert variant keeps its EVM wallet whatever `K` is.
 */
import type {
  ChainKeys,
  Hex,
  IBitcoinWalletProvider,
  IcxCreateRevertMigrationParams,
  IcxRevertMigrationAction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  IWalletProvider,
  MigrationAction,
  SpokeChainKey,
  UnifiedBnUSDMigrateAction,
  UnifiedBnUSDMigrateParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useMigrationApprove } from './useMigrationApprove.js';

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

type Vars<K extends SpokeChainKey> = (
  | Omit<IcxRevertMigrationAction<false>, 'raw'>
  | Omit<UnifiedBnUSDMigrateAction<K, false>, 'raw'>
) & { action: MigrationAction };
type Expected<K extends SpokeChainKey, D> = SafeUseMutationResult<D, Error, Vars<K>>;
type Hook<K extends SpokeChainKey> = ReturnType<typeof useMigrationApprove<K>>;
type Wallet<K extends SpokeChainKey> = Parameters<Hook<K>['mutate']>[0]['walletProvider'];
type Data<K extends SpokeChainKey> = Awaited<ReturnType<Hook<K>['mutateAsync']>>;

declare const hookSolana: Hook<SOLANA>;
declare const revertParams: IcxCreateRevertMigrationParams;
declare const solanaParams: UnifiedBnUSDMigrateParams<SOLANA>;
declare const bscParams: UnifiedBnUSDMigrateParams<BSC>;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const sui: ISuiWalletProvider;

describe('useMigrationApprove', () => {
  it('takes only mutationOptions typed to its data and variables', () => {
    expectTypeOf<Parameters<typeof useMigrationApprove<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, Vars<BSC>> | undefined
    >();
  });

  it('defaults K to every spoke chain', () => {
    expectTypeOf<ReturnType<typeof useMigrationApprove>>().toEqualTypeOf<Expected<SpokeChainKey, string>>();
    expectTypeOf<Data<SpokeChainKey>>().toEqualTypeOf<string>();
    expectTypeOf<Wallet<SpokeChainKey>>().toEqualTypeOf<IWalletProvider>();
  });

  it('locking K narrows the bnUSD wallet and the hash per chain family', () => {
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
    expectTypeOf<Wallet<ICON>>().toEqualTypeOf<IEvmWalletProvider | IIconWalletProvider>();
    expectTypeOf<Wallet<SUI>>().toEqualTypeOf<IEvmWalletProvider | ISuiWalletProvider>();
    expectTypeOf<Wallet<SOLANA>>().toEqualTypeOf<IEvmWalletProvider | ISolanaWalletProvider>();
    expectTypeOf<Wallet<STELLAR>>().toEqualTypeOf<IEvmWalletProvider | IStellarWalletProvider>();
    expectTypeOf<Wallet<INJECTIVE>>().toEqualTypeOf<IEvmWalletProvider | IInjectiveWalletProvider>();
    expectTypeOf<Wallet<NEAR>>().toEqualTypeOf<IEvmWalletProvider | INearWalletProvider>();
    expectTypeOf<Wallet<STACKS>>().toEqualTypeOf<IEvmWalletProvider | IStacksWalletProvider>();
    expectTypeOf<Wallet<BITCOIN>>().toEqualTypeOf<IEvmWalletProvider | IBitcoinWalletProvider>();
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
  });

  it('rejects variables that fit neither variant', () => {
    const calls = () => [
      hookSolana.mutate({ params: solanaParams, walletProvider: solana, action: 'migrate' }),
      hookSolana.mutate({ params: revertParams, walletProvider: evm, action: 'revert' }),
      // @ts-expect-error — a Sui wallet signs neither a Solana bnUSD migration nor a hub revert
      hookSolana.mutate({ params: solanaParams, walletProvider: sui, action: 'migrate' }),
      // @ts-expect-error — a hub revert needs the EVM wallet
      hookSolana.mutate({ params: revertParams, walletProvider: solana, action: 'revert' }),
      // @ts-expect-error — bnUSD params for a chain other than the locked K
      hookSolana.mutate({ params: bscParams, walletProvider: solana, action: 'migrate' }),
      // @ts-expect-error — the action is required
      hookSolana.mutate({ params: solanaParams, walletProvider: solana }),
      // @ts-expect-error — the action is 'migrate' or 'revert'
      hookSolana.mutate({ params: solanaParams, walletProvider: solana, action: 'approve' }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
