/**
 * Pins `useLeverageYieldVaultSwap`: generic over the source chain with the full union as default, because the
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
  SpokeChainKey,
  VaultSwapActionParams,
  VaultSwapResponse,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { MutationHookParams } from '../shared/types.js';
import type { SafeUseMutationResult } from '../shared/useSafeMutation.js';
import type { useLeverageYieldVaultSwap } from './useLeverageYieldVaultSwap.js';

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

type ExpectedVars<K extends SpokeChainKey> = Omit<VaultSwapActionParams<K, false>, 'raw'>;
// K cannot be inferred from the hook's arguments (variables arrive at `mutate()`), so it is passed explicitly.
type HookOf<K extends SpokeChainKey> = ReturnType<typeof useLeverageYieldVaultSwap<K>>;
type VarsOf<K extends SpokeChainKey> = Parameters<HookOf<K>['mutate']>[0];
type DataOf<K extends SpokeChainKey> = NonNullable<HookOf<K>['data']>;

declare const bscHook: HookOf<BSC>;
declare const bscVars: VarsOf<BSC>;
declare const solanaWallet: ISolanaWalletProvider;

describe('useLeverageYieldVaultSwap', () => {
  it('defaults K to every spoke chain', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldVaultSwap>[0]>().toEqualTypeOf<
      MutationHookParams<VaultSwapResponse, ExpectedVars<SpokeChainKey>> | undefined
    >();
    expectTypeOf<ReturnType<typeof useLeverageYieldVaultSwap>>().toEqualTypeOf<
      SafeUseMutationResult<VaultSwapResponse, Error, ExpectedVars<SpokeChainKey>>
    >();
    expectTypeOf<VarsOf<SpokeChainKey>['walletProvider']>().toEqualTypeOf<IWalletProvider>();
  });

  it('pins the full result once K is locked', () => {
    expectTypeOf<Parameters<typeof useLeverageYieldVaultSwap<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<VaultSwapResponse, ExpectedVars<BSC>> | undefined
    >();
    expectTypeOf<HookOf<BSC>>().toEqualTypeOf<SafeUseMutationResult<VaultSwapResponse, Error, ExpectedVars<BSC>>>();
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
    expectTypeOf<DataOf<BSC>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<SONIC>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<ICON>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<SUI>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<SOLANA>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<STELLAR>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<INJECTIVE>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<NEAR>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<STACKS>>().toEqualTypeOf<VaultSwapResponse>();
    expectTypeOf<DataOf<BITCOIN>>().toEqualTypeOf<VaultSwapResponse>();
  });

  it('rejects variables that do not match the locked chain', () => {
    expectTypeOf(invalidCalls).toBeFunction();
  });
});

// Never invoked: each call is a compile-time check only.
function invalidCalls(): void {
  // @ts-expect-error — a Solana wallet cannot sign for a BSC-locked hook
  bscHook.mutate({ ...bscVars, walletProvider: solanaWallet });
  // @ts-expect-error — the hook always executes; `raw` is not accepted
  bscHook.mutate({ ...bscVars, raw: true });
}
