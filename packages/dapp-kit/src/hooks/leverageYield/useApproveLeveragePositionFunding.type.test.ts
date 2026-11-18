/**
 * Pins `useApproveLeveragePositionFunding`: generic over the source chain with the full union as default, because the
 * variables only arrive at `mutate()`. Locking K narrows the wallet provider and the tx hash per chain family.
 */
import type {
  ChainKeys,
  GetWalletProviderType,
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
import type { useApproveLeveragePositionFunding } from './useApproveLeveragePositionFunding.js';

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
  srcChainKey: K;
  srcAddress: string;
  token: string;
  amount: bigint;
  walletProvider?: GetWalletProviderType<K>;
};
// K cannot be inferred from the hook's arguments (variables arrive at `mutate()`), so it is passed explicitly.
type HookOf<K extends SpokeChainKey> = ReturnType<typeof useApproveLeveragePositionFunding<K>>;
type VarsOf<K extends SpokeChainKey> = Parameters<HookOf<K>['mutate']>[0];
type DataOf<K extends SpokeChainKey> = NonNullable<HookOf<K>['data']>;

declare const bscHook: HookOf<BSC>;
declare const bscVars: VarsOf<BSC>;
declare const solanaWallet: ISolanaWalletProvider;
declare const solanaKey: SOLANA;

describe('useApproveLeveragePositionFunding', () => {
  it('defaults K to every spoke chain', () => {
    expectTypeOf<Parameters<typeof useApproveLeveragePositionFunding>[0]>().toEqualTypeOf<
      MutationHookParams<string, ExpectedVars<SpokeChainKey>> | undefined
    >();
    expectTypeOf<ReturnType<typeof useApproveLeveragePositionFunding>>().toEqualTypeOf<
      SafeUseMutationResult<string, Error, ExpectedVars<SpokeChainKey>>
    >();
    expectTypeOf<VarsOf<SpokeChainKey>['walletProvider']>().toEqualTypeOf<IWalletProvider | undefined>();
  });

  it('pins the full result once K is locked', () => {
    expectTypeOf<Parameters<typeof useApproveLeveragePositionFunding<BSC>>[0]>().toEqualTypeOf<
      MutationHookParams<Hex, ExpectedVars<BSC>> | undefined
    >();
    expectTypeOf<HookOf<BSC>>().toEqualTypeOf<SafeUseMutationResult<Hex, Error, ExpectedVars<BSC>>>();
  });

  it('narrows the wallet provider per chain family', () => {
    expectTypeOf<VarsOf<BSC>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf<VarsOf<SONIC>['walletProvider']>().toEqualTypeOf<IEvmWalletProvider | undefined>();
    expectTypeOf<VarsOf<ICON>['walletProvider']>().toEqualTypeOf<IIconWalletProvider | undefined>();
    expectTypeOf<VarsOf<SUI>['walletProvider']>().toEqualTypeOf<ISuiWalletProvider | undefined>();
    expectTypeOf<VarsOf<SOLANA>['walletProvider']>().toEqualTypeOf<ISolanaWalletProvider | undefined>();
    expectTypeOf<VarsOf<STELLAR>['walletProvider']>().toEqualTypeOf<IStellarWalletProvider | undefined>();
    expectTypeOf<VarsOf<INJECTIVE>['walletProvider']>().toEqualTypeOf<IInjectiveWalletProvider | undefined>();
    expectTypeOf<VarsOf<NEAR>['walletProvider']>().toEqualTypeOf<INearWalletProvider | undefined>();
    expectTypeOf<VarsOf<STACKS>['walletProvider']>().toEqualTypeOf<IStacksWalletProvider | undefined>();
    expectTypeOf<VarsOf<BITCOIN>['walletProvider']>().toEqualTypeOf<IBitcoinWalletProvider | undefined>();
  });

  it('narrows the tx hash per chain family', () => {
    expectTypeOf<DataOf<BSC>>().toEqualTypeOf<Hex>();
    expectTypeOf<DataOf<SONIC>>().toEqualTypeOf<Hex>();
    expectTypeOf<DataOf<ICON>>().toEqualTypeOf<Hex>();
    expectTypeOf<DataOf<SUI>>().toEqualTypeOf<string>();
    expectTypeOf<DataOf<SOLANA>>().toEqualTypeOf<string>();
    expectTypeOf<DataOf<STELLAR>>().toEqualTypeOf<string>();
    expectTypeOf<DataOf<INJECTIVE>>().toEqualTypeOf<string>();
    expectTypeOf<DataOf<NEAR>>().toEqualTypeOf<string>();
    expectTypeOf<DataOf<STACKS>>().toEqualTypeOf<string>();
    expectTypeOf<DataOf<BITCOIN>>().toEqualTypeOf<string>();
  });

  it('rejects variables that do not match the locked chain', () => {
    expectTypeOf(invalidCalls).toBeFunction();
  });
});

// Never invoked: each call is a compile-time check only.
function invalidCalls(): void {
  // @ts-expect-error — a Solana wallet cannot sign for a BSC-locked hook
  bscHook.mutate({ ...bscVars, walletProvider: solanaWallet });
  // @ts-expect-error — the source chain is locked to BSC
  bscHook.mutate({ ...bscVars, srcChainKey: solanaKey });
}
