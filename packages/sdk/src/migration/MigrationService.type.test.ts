/**
 * Compile-time contract: MigrationService types each action by its source chain and execution mode.
 * bnUSD accepts any spoke chain; ICX and BALN migrations are ICON-only; the ICX revert is hub-only.
 * Orchestrated (signed) flows always resolve to a `TxHashPair`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BalnMigrateAction,
  BitcoinRawTransaction,
  ChainKeys,
  EvmRawTransaction,
  Hex,
  IBitcoinWalletProvider,
  IcxMigrateAction,
  IcxRevertMigrationAction,
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
  MigrateOrchestrationError,
  MigrationAllowanceCheckError,
  MigrationApproveError,
  MigrationCreateIntentError,
  NearRawTransaction,
  RelayExtraData,
  Result,
  RevertMigrationOrchestrationError,
  SolanaRawTransaction,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxHashPair,
  UnifiedBnUSDMigrateAction,
  UnifiedBnUSDMigrateParams,
} from '../index.js';
import type { MigrationService } from './MigrationService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

type ParamsOf<A> = A extends { params: infer P } ? P : never;
type Intent<T> = Promise<Result<{ tx: T; relayData: RelayExtraData }, MigrationCreateIntentError>>;
type Approve<T> = Promise<Result<T, MigrationApproveError>>;

declare const svc: MigrationService;
declare const evm: IEvmWalletProvider;
declare const icon: IIconWalletProvider;
declare const sui: ISuiWalletProvider;
declare const stellar: IStellarWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const injective: IInjectiveWalletProvider;
declare const near: INearWalletProvider;
declare const stacks: IStacksWalletProvider;
declare const bitcoin: IBitcoinWalletProvider;
declare const isRaw: boolean;

declare const bnBsc: UnifiedBnUSDMigrateParams<BSC>;
declare const bnSonic: UnifiedBnUSDMigrateParams<SONIC>;
declare const bnIcon: UnifiedBnUSDMigrateParams<ICON>;
declare const bnSui: UnifiedBnUSDMigrateParams<SUI>;
declare const bnStellar: UnifiedBnUSDMigrateParams<STELLAR>;
declare const bnSolana: UnifiedBnUSDMigrateParams<SOLANA>;
declare const bnInjective: UnifiedBnUSDMigrateParams<INJECTIVE>;
declare const bnNear: UnifiedBnUSDMigrateParams<NEAR>;
declare const bnStacks: UnifiedBnUSDMigrateParams<STACKS>;
declare const bnBitcoin: UnifiedBnUSDMigrateParams<BITCOIN>;
declare const icxP: ParamsOf<IcxMigrateAction<false>>;
declare const balnP: ParamsOf<BalnMigrateAction<false>>;
declare const revertP: ParamsOf<IcxRevertMigrationAction<false>>;

// bnUSD intent per chain family: [walletProvider, raw: true]. Never invoked.
const bnUsdIntentRows = () =>
  ({
    evm: [
      svc.createMigratebnUSDIntent({ params: bnBsc, walletProvider: evm }),
      svc.createMigratebnUSDIntent({ params: bnBsc, raw: true }),
    ],
    hub: [
      svc.createMigratebnUSDIntent({ params: bnSonic, walletProvider: evm }),
      svc.createMigratebnUSDIntent({ params: bnSonic, raw: true }),
    ],
    icon: [
      svc.createMigratebnUSDIntent({ params: bnIcon, walletProvider: icon }),
      svc.createMigratebnUSDIntent({ params: bnIcon, raw: true }),
    ],
    sui: [
      svc.createMigratebnUSDIntent({ params: bnSui, walletProvider: sui }),
      svc.createMigratebnUSDIntent({ params: bnSui, raw: true }),
    ],
    stellar: [
      svc.createMigratebnUSDIntent({ params: bnStellar, walletProvider: stellar }),
      svc.createMigratebnUSDIntent({ params: bnStellar, raw: true }),
    ],
    solana: [
      svc.createMigratebnUSDIntent({ params: bnSolana, walletProvider: solana }),
      svc.createMigratebnUSDIntent({ params: bnSolana, raw: true }),
    ],
    injective: [
      svc.createMigratebnUSDIntent({ params: bnInjective, walletProvider: injective }),
      svc.createMigratebnUSDIntent({ params: bnInjective, raw: true }),
    ],
    near: [
      svc.createMigratebnUSDIntent({ params: bnNear, walletProvider: near }),
      svc.createMigratebnUSDIntent({ params: bnNear, raw: true }),
    ],
    stacks: [
      svc.createMigratebnUSDIntent({ params: bnStacks, walletProvider: stacks }),
      svc.createMigratebnUSDIntent({ params: bnStacks, raw: true }),
    ],
    bitcoin: [
      svc.createMigratebnUSDIntent({ params: bnBitcoin, walletProvider: bitcoin }),
      svc.createMigratebnUSDIntent({ params: bnBitcoin, raw: true }),
    ],
  }) as const;

// bnUSD approve per chain family: [walletProvider, raw: true]. Never invoked.
const bnUsdApproveRows = () =>
  ({
    evm: [
      svc.approve({ params: bnBsc, walletProvider: evm }, 'migrate'),
      svc.approve({ params: bnBsc, raw: true }, 'migrate'),
    ],
    hub: [
      svc.approve({ params: bnSonic, walletProvider: evm }, 'revert'),
      svc.approve({ params: bnSonic, raw: true }, 'revert'),
    ],
    icon: [
      svc.approve({ params: bnIcon, walletProvider: icon }, 'migrate'),
      svc.approve({ params: bnIcon, raw: true }, 'migrate'),
    ],
    sui: [
      svc.approve({ params: bnSui, walletProvider: sui }, 'migrate'),
      svc.approve({ params: bnSui, raw: true }, 'migrate'),
    ],
    stellar: [
      svc.approve({ params: bnStellar, walletProvider: stellar }, 'migrate'),
      svc.approve({ params: bnStellar, raw: true }, 'migrate'),
    ],
    solana: [
      svc.approve({ params: bnSolana, walletProvider: solana }, 'migrate'),
      svc.approve({ params: bnSolana, raw: true }, 'migrate'),
    ],
    injective: [
      svc.approve({ params: bnInjective, walletProvider: injective }, 'migrate'),
      svc.approve({ params: bnInjective, raw: true }, 'migrate'),
    ],
    near: [
      svc.approve({ params: bnNear, walletProvider: near }, 'migrate'),
      svc.approve({ params: bnNear, raw: true }, 'migrate'),
    ],
    stacks: [
      svc.approve({ params: bnStacks, walletProvider: stacks }, 'migrate'),
      svc.approve({ params: bnStacks, raw: true }, 'migrate'),
    ],
    bitcoin: [
      svc.approve({ params: bnBitcoin, walletProvider: bitcoin }, 'migrate'),
      svc.approve({ params: bnBitcoin, raw: true }, 'migrate'),
    ],
  }) as const;

describe('MigrationService', () => {
  it('createMigratebnUSDIntent narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof bnUsdIntentRows>>().toEqualTypeOf<{
      readonly evm: readonly [Intent<Hex>, Intent<EvmRawTransaction>];
      readonly hub: readonly [Intent<Hex>, Intent<EvmRawTransaction>];
      readonly icon: readonly [Intent<Hex>, Intent<IconRawTransaction>];
      readonly sui: readonly [Intent<string>, Intent<SuiRawTransaction>];
      readonly stellar: readonly [Intent<string>, Intent<StellarRawTransaction>];
      readonly solana: readonly [Intent<string>, Intent<SolanaRawTransaction>];
      readonly injective: readonly [Intent<string>, Intent<InjectiveRawTransaction>];
      readonly near: readonly [Intent<string>, Intent<NearRawTransaction>];
      readonly stacks: readonly [Intent<string>, Intent<StacksRawTransaction>];
      // Bitcoin's raw type already includes the hash string.
      readonly bitcoin: readonly [Intent<string>, Intent<BitcoinRawTransaction | string>];
    }>();
  });

  it('approve with bnUSD params narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof bnUsdApproveRows>>().toEqualTypeOf<{
      readonly evm: readonly [Approve<Hex>, Approve<EvmRawTransaction>];
      readonly hub: readonly [Approve<Hex>, Approve<EvmRawTransaction>];
      readonly icon: readonly [Approve<Hex>, Approve<IconRawTransaction>];
      readonly sui: readonly [Approve<string>, Approve<SuiRawTransaction>];
      readonly stellar: readonly [Approve<string>, Approve<StellarRawTransaction>];
      readonly solana: readonly [Approve<string>, Approve<SolanaRawTransaction>];
      readonly injective: readonly [Approve<string>, Approve<InjectiveRawTransaction>];
      readonly near: readonly [Approve<string>, Approve<NearRawTransaction>];
      readonly stacks: readonly [Approve<string>, Approve<StacksRawTransaction>];
      readonly bitcoin: readonly [Approve<string>, Approve<BitcoinRawTransaction | string>];
    }>();
  });

  it('approve with ICX revert params resolves on the hub', () => {
    const signed = () => svc.approve({ params: revertP, walletProvider: evm }, 'revert');
    const raw = () => svc.approve({ params: revertP, raw: true }, 'revert');
    expectTypeOf<ReturnType<typeof signed>>().toEqualTypeOf<Approve<Hex>>();
    expectTypeOf<ReturnType<typeof raw>>().toEqualTypeOf<Approve<EvmRawTransaction>>();
  });

  it('createMigrateBalnIntent and createMigrateIcxToSodaIntent are ICON-only', () => {
    const baln = () =>
      [
        svc.createMigrateBalnIntent({ params: balnP, walletProvider: icon }),
        svc.createMigrateBalnIntent({ params: balnP, raw: false, walletProvider: icon }),
        svc.createMigrateBalnIntent({ params: balnP, raw: true }),
      ] as const;
    const icx = () =>
      [
        svc.createMigrateIcxToSodaIntent({ params: icxP, walletProvider: icon }),
        svc.createMigrateIcxToSodaIntent({ params: icxP, raw: false, walletProvider: icon }),
        svc.createMigrateIcxToSodaIntent({ params: icxP, raw: true }),
      ] as const;
    type Icon = readonly [Intent<Hex>, Intent<Hex>, Intent<IconRawTransaction>];
    expectTypeOf<ReturnType<typeof baln>>().toEqualTypeOf<Icon>();
    expectTypeOf<ReturnType<typeof icx>>().toEqualTypeOf<Icon>();
  });

  it('createRevertSodaToIcxMigrationIntent is hub-only', () => {
    const revert = () =>
      [
        svc.createRevertSodaToIcxMigrationIntent({ params: revertP, walletProvider: evm }),
        svc.createRevertSodaToIcxMigrationIntent({ params: revertP, raw: false, walletProvider: evm }),
        svc.createRevertSodaToIcxMigrationIntent({ params: revertP, raw: true }),
      ] as const;
    expectTypeOf<ReturnType<typeof revert>>().toEqualTypeOf<
      readonly [Intent<Hex>, Intent<Hex>, Intent<EvmRawTransaction>]
    >();
  });

  it('a mode only known at runtime keeps both results', () => {
    const bnUsd = (args: UnifiedBnUSDMigrateAction<BSC, boolean>) => svc.createMigratebnUSDIntent(args);
    const approve = (args: UnifiedBnUSDMigrateAction<BSC, boolean>) => svc.approve(args, 'migrate');
    const baln = (args: BalnMigrateAction<boolean>) => svc.createMigrateBalnIntent(args);
    const icx = (args: IcxMigrateAction<boolean>) => svc.createMigrateIcxToSodaIntent(args);
    const revert = (args: IcxRevertMigrationAction<boolean>) => svc.createRevertSodaToIcxMigrationIntent(args);
    expectTypeOf<ReturnType<typeof bnUsd>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof approve>>().toEqualTypeOf<Approve<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof baln>>().toEqualTypeOf<Intent<Hex | IconRawTransaction>>();
    expectTypeOf<ReturnType<typeof icx>>().toEqualTypeOf<Intent<Hex | IconRawTransaction>>();
    expectTypeOf<ReturnType<typeof revert>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
  });

  it('signed orchestrations resolve to a TxHashPair', () => {
    const bnUsdEvm = () => svc.migratebnUSD({ params: bnBsc, walletProvider: evm });
    const bnUsdIcon = () => svc.migratebnUSD({ params: bnIcon, walletProvider: icon });
    expectTypeOf<ReturnType<typeof bnUsdEvm>>().toEqualTypeOf<Promise<Result<TxHashPair, MigrateOrchestrationError>>>();
    expectTypeOf<ReturnType<typeof bnUsdIcon>>().toEqualTypeOf<
      Promise<Result<TxHashPair, MigrateOrchestrationError>>
    >();
    expectTypeOf<ReturnType<MigrationService['migrateIcxToSoda']>>().toEqualTypeOf<
      Promise<Result<TxHashPair, MigrateOrchestrationError>>
    >();
    expectTypeOf<ReturnType<MigrationService['migrateBaln']>>().toEqualTypeOf<
      Promise<Result<TxHashPair, MigrateOrchestrationError>>
    >();
    expectTypeOf<ReturnType<MigrationService['revertMigrateSodaToIcx']>>().toEqualTypeOf<
      Promise<Result<TxHashPair, RevertMigrationOrchestrationError>>
    >();
  });

  it('isAllowanceValid → Promise<Result<boolean, MigrationAllowanceCheckError>> for every params kind', () => {
    const calls = () =>
      [
        svc.isAllowanceValid(bnBsc, 'migrate'),
        svc.isAllowanceValid(bnIcon, 'migrate'),
        svc.isAllowanceValid(icxP, 'migrate'),
        svc.isAllowanceValid(balnP, 'migrate'),
        svc.isAllowanceValid(revertP, 'revert'),
      ] as const;
    type R = Promise<Result<boolean, MigrationAllowanceCheckError>>;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [R, R, R, R, R]>();
  });

  it('rejects wrong chains, wallets and modes', () => {
    const calls = () => [
      // @ts-expect-error — BALN migration is ICON-only; an EVM wallet cannot sign it.
      svc.createMigrateBalnIntent({ params: balnP, walletProvider: evm }),
      // @ts-expect-error — ICX migration is ICON-only; bnUSD params from BSC are not accepted.
      svc.createMigrateIcxToSodaIntent({ params: bnBsc, walletProvider: icon }),
      // @ts-expect-error — the ICX revert runs on the hub; an ICON wallet cannot sign it.
      svc.createRevertSodaToIcxMigrationIntent({ params: revertP, walletProvider: icon }),
      // @ts-expect-error — the walletProvider must match the bnUSD source chain.
      svc.createMigratebnUSDIntent({ params: bnBsc, walletProvider: solana }),
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.createMigratebnUSDIntent({ params: bnBsc, raw: true, walletProvider: evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      svc.approve({ params: bnBsc }, 'migrate'),
      // @ts-expect-error — the orchestrated flow is signed only.
      svc.migratebnUSD({ params: bnBsc, raw: true }),
      // @ts-expect-error — approve does not take ICX migrate (ICON) params.
      svc.approve({ params: icxP, walletProvider: icon }, 'migrate'),
      // @ts-expect-error — a non-literal boolean cannot pick a branch in an object literal.
      svc.createMigrateBalnIntent({ params: balnP, raw: isRaw }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
