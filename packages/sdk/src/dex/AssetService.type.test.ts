/**
 * Compile-time contract: AssetService wrap/unwrap actions type their result by the source chain
 * family and execution mode; signed orchestrations resolve to a `TxHashPair`. Every chain family is
 * accepted. Errors are the untyped `Result` default (`unknown`), pinned as such.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AssetDepositAction,
  AssetWithdrawAction,
  BitcoinRawTransaction,
  ChainKeys,
  CreateAssetDepositParams,
  CreateAssetWithdrawParams,
  EvmContractCall,
  EvmRawTransaction,
  Hex,
  IBitcoinWalletProvider,
  IconRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveRawTransaction,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  NearRawTransaction,
  RelayExtraData,
  Result,
  SolanaRawTransaction,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxHashPair,
} from '../index.js';
import type { AssetService } from './AssetService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type Keys = {
  evm: BSC;
  hub: typeof ChainKeys.SONIC_MAINNET;
  icon: typeof ChainKeys.ICON_MAINNET;
  sui: typeof ChainKeys.SUI_MAINNET;
  stellar: typeof ChainKeys.STELLAR_MAINNET;
  solana: typeof ChainKeys.SOLANA_MAINNET;
  injective: typeof ChainKeys.INJECTIVE_MAINNET;
  near: typeof ChainKeys.NEAR_MAINNET;
  stacks: typeof ChainKeys.STACKS_MAINNET;
  bitcoin: typeof ChainKeys.BITCOIN_MAINNET;
};
// [signed, raw] result per family, spelled out rather than derived through `TxReturnType`.
type Fam = {
  evm: [Hex, EvmRawTransaction];
  hub: [Hex, EvmRawTransaction];
  icon: [Hex, IconRawTransaction];
  sui: [string, SuiRawTransaction];
  stellar: [string, StellarRawTransaction];
  solana: [string, SolanaRawTransaction];
  injective: [string, InjectiveRawTransaction];
  near: [string, NearRawTransaction];
  stacks: [string, StacksRawTransaction];
  // Bitcoin's raw type already includes the hash string.
  bitcoin: [string, BitcoinRawTransaction | string];
};
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type Approve<T> = Promise<Result<T, unknown>>;
type Intent<T> = Promise<Result<{ tx: T; relayData: RelayExtraData }, unknown>>;
type ApproveMatrix = { readonly [N in keyof Fam]: readonly [Approve<Fam[N][0]>, Approve<Fam[N][1]>] };
type IntentMatrix = { readonly [N in keyof Fam]: readonly [Intent<Fam[N][0]>, Intent<Fam[N][1]>] };

declare const svc: AssetService;
declare const wallet: {
  evm: IEvmWalletProvider;
  hub: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  stellar: IStellarWalletProvider;
  solana: ISolanaWalletProvider;
  injective: IInjectiveWalletProvider;
  near: INearWalletProvider;
  stacks: IStacksWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};
declare const dep: { [N in keyof Keys]: CreateAssetDepositParams<Keys[N]> };
declare const wd: { [N in keyof Keys]: CreateAssetWithdrawParams<Keys[N]> };
declare const isRaw: boolean;

// One row per chain family: [walletProvider, raw: true]. Never invoked.
const approveRows = () =>
  ({
    evm: [svc.approve({ params: dep.evm, walletProvider: wallet.evm }), svc.approve({ params: dep.evm, raw: true })],
    hub: [svc.approve({ params: dep.hub, walletProvider: wallet.hub }), svc.approve({ params: dep.hub, raw: true })],
    icon: [
      svc.approve({ params: dep.icon, walletProvider: wallet.icon }),
      svc.approve({ params: dep.icon, raw: true }),
    ],
    sui: [svc.approve({ params: dep.sui, walletProvider: wallet.sui }), svc.approve({ params: dep.sui, raw: true })],
    stellar: [
      svc.approve({ params: dep.stellar, walletProvider: wallet.stellar }),
      svc.approve({ params: dep.stellar, raw: true }),
    ],
    solana: [
      svc.approve({ params: dep.solana, walletProvider: wallet.solana }),
      svc.approve({ params: dep.solana, raw: true }),
    ],
    injective: [
      svc.approve({ params: dep.injective, walletProvider: wallet.injective }),
      svc.approve({ params: dep.injective, raw: true }),
    ],
    near: [
      svc.approve({ params: dep.near, walletProvider: wallet.near }),
      svc.approve({ params: dep.near, raw: true }),
    ],
    stacks: [
      svc.approve({ params: dep.stacks, walletProvider: wallet.stacks }),
      svc.approve({ params: dep.stacks, raw: true }),
    ],
    bitcoin: [
      svc.approve({ params: dep.bitcoin, walletProvider: wallet.bitcoin }),
      svc.approve({ params: dep.bitcoin, raw: true }),
    ],
  }) as const;
const depositRows = () =>
  ({
    evm: [
      svc.executeDeposit({ params: dep.evm, walletProvider: wallet.evm }),
      svc.executeDeposit({ params: dep.evm, raw: true }),
    ],
    hub: [
      svc.executeDeposit({ params: dep.hub, walletProvider: wallet.hub }),
      svc.executeDeposit({ params: dep.hub, raw: true }),
    ],
    icon: [
      svc.executeDeposit({ params: dep.icon, walletProvider: wallet.icon }),
      svc.executeDeposit({ params: dep.icon, raw: true }),
    ],
    sui: [
      svc.executeDeposit({ params: dep.sui, walletProvider: wallet.sui }),
      svc.executeDeposit({ params: dep.sui, raw: true }),
    ],
    stellar: [
      svc.executeDeposit({ params: dep.stellar, walletProvider: wallet.stellar }),
      svc.executeDeposit({ params: dep.stellar, raw: true }),
    ],
    solana: [
      svc.executeDeposit({ params: dep.solana, walletProvider: wallet.solana }),
      svc.executeDeposit({ params: dep.solana, raw: true }),
    ],
    injective: [
      svc.executeDeposit({ params: dep.injective, walletProvider: wallet.injective }),
      svc.executeDeposit({ params: dep.injective, raw: true }),
    ],
    near: [
      svc.executeDeposit({ params: dep.near, walletProvider: wallet.near }),
      svc.executeDeposit({ params: dep.near, raw: true }),
    ],
    stacks: [
      svc.executeDeposit({ params: dep.stacks, walletProvider: wallet.stacks }),
      svc.executeDeposit({ params: dep.stacks, raw: true }),
    ],
    bitcoin: [
      svc.executeDeposit({ params: dep.bitcoin, walletProvider: wallet.bitcoin }),
      svc.executeDeposit({ params: dep.bitcoin, raw: true }),
    ],
  }) as const;
const withdrawRows = () =>
  ({
    evm: [
      svc.executeWithdraw({ params: wd.evm, walletProvider: wallet.evm }),
      svc.executeWithdraw({ params: wd.evm, raw: true }),
    ],
    hub: [
      svc.executeWithdraw({ params: wd.hub, walletProvider: wallet.hub }),
      svc.executeWithdraw({ params: wd.hub, raw: true }),
    ],
    icon: [
      svc.executeWithdraw({ params: wd.icon, walletProvider: wallet.icon }),
      svc.executeWithdraw({ params: wd.icon, raw: true }),
    ],
    sui: [
      svc.executeWithdraw({ params: wd.sui, walletProvider: wallet.sui }),
      svc.executeWithdraw({ params: wd.sui, raw: true }),
    ],
    stellar: [
      svc.executeWithdraw({ params: wd.stellar, walletProvider: wallet.stellar }),
      svc.executeWithdraw({ params: wd.stellar, raw: true }),
    ],
    solana: [
      svc.executeWithdraw({ params: wd.solana, walletProvider: wallet.solana }),
      svc.executeWithdraw({ params: wd.solana, raw: true }),
    ],
    injective: [
      svc.executeWithdraw({ params: wd.injective, walletProvider: wallet.injective }),
      svc.executeWithdraw({ params: wd.injective, raw: true }),
    ],
    near: [
      svc.executeWithdraw({ params: wd.near, walletProvider: wallet.near }),
      svc.executeWithdraw({ params: wd.near, raw: true }),
    ],
    stacks: [
      svc.executeWithdraw({ params: wd.stacks, walletProvider: wallet.stacks }),
      svc.executeWithdraw({ params: wd.stacks, raw: true }),
    ],
    bitcoin: [
      svc.executeWithdraw({ params: wd.bitcoin, walletProvider: wallet.bitcoin }),
      svc.executeWithdraw({ params: wd.bitcoin, raw: true }),
    ],
  }) as const;

describe('AssetService', () => {
  it('approve narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof approveRows>>().toEqualTypeOf<ApproveMatrix>();
  });

  it('executeDeposit narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof depositRows>>().toEqualTypeOf<IntentMatrix>();
  });

  it('executeWithdraw narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof withdrawRows>>().toEqualTypeOf<IntentMatrix>();
  });

  it('explicit raw: false matches the omitted form; a runtime mode keeps both results', () => {
    const explicit = () => svc.executeDeposit({ params: dep.evm, raw: false, walletProvider: wallet.evm });
    expectTypeOf<ReturnType<typeof explicit>>().toEqualTypeOf<Intent<Hex>>();
    const approve = (args: AssetDepositAction<BSC, boolean>) => svc.approve(args);
    const deposit = (args: AssetDepositAction<BSC, boolean>) => svc.executeDeposit(args);
    const withdraw = (args: AssetWithdrawAction<BSC, boolean>) => svc.executeWithdraw(args);
    expectTypeOf<ReturnType<typeof approve>>().toEqualTypeOf<Approve<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof deposit>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof withdraw>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
  });

  it('isAllowanceValid → Promise<Result<boolean, unknown>> in every mode and family', () => {
    const calls = () =>
      [
        svc.isAllowanceValid({ params: dep.evm, walletProvider: wallet.evm }),
        svc.isAllowanceValid({ params: dep.evm, raw: true }),
        svc.isAllowanceValid({ params: dep.stellar, raw: true }),
        svc.isAllowanceValid({ params: dep.icon, walletProvider: wallet.icon }),
      ] as const;
    type R = Promise<Result<boolean, unknown>>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [R, R, R, R]>();
  });

  it('deposit and withdraw are signed-only and resolve to a TxHashPair in every family', () => {
    const calls = () =>
      [
        svc.deposit({ params: dep.evm, walletProvider: wallet.evm }),
        svc.deposit({ params: dep.hub, walletProvider: wallet.hub }),
        svc.deposit({ params: dep.sui, walletProvider: wallet.sui }),
        svc.withdraw({ params: wd.evm, walletProvider: wallet.evm }),
        svc.withdraw({ params: wd.icon, walletProvider: wallet.icon }),
        svc.withdraw({ params: wd.solana, walletProvider: wallet.solana }),
      ] as const;
    type R = Promise<Result<TxHashPair, unknown>>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [R, R, R, R, R, R]>();
  });

  it('hub-side helpers return their fixed types', () => {
    expectTypeOf<ReturnType<AssetService['isSodaAsXSodaInPool']>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<AssetService['getTokenWrapAction']>>().toEqualTypeOf<Promise<EvmContractCall[]>>();
    expectTypeOf<ReturnType<AssetService['getTokenUnwrapAction']>>().toEqualTypeOf<Promise<EvmContractCall[]>>();
    expectTypeOf<ReturnType<AssetService['getWrappedAmount']>>().toEqualTypeOf<Promise<Result<bigint, unknown>>>();
    expectTypeOf<ReturnType<AssetService['getUnwrappedAmount']>>().toEqualTypeOf<Promise<Result<bigint, unknown>>>();
    expectTypeOf<ReturnType<AssetService['getDeposit']>>().toEqualTypeOf<Promise<Result<bigint, unknown>>>();
  });

  it('rejects wrong wallets and modes', () => {
    const calls = () => [
      // @ts-expect-error — the walletProvider must match the source chain.
      svc.executeDeposit({ params: dep.evm, walletProvider: wallet.solana }),
      // @ts-expect-error — the walletProvider must match the source chain.
      svc.approve({ params: dep.icon, walletProvider: wallet.evm }),
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.executeWithdraw({ params: wd.evm, raw: true, walletProvider: wallet.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      svc.executeDeposit({ params: dep.evm }),
      // @ts-expect-error — the orchestrated deposit is signed only.
      svc.deposit({ params: dep.evm, raw: true }),
      // @ts-expect-error — a non-literal boolean cannot pick a branch in an object literal.
      svc.approve({ params: dep.evm, raw: isRaw }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
