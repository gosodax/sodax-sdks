/**
 * Pins MoneyMarketService. Every exec-mode action narrows by the source chain family and the execution
 * mode the caller picks, with no type arguments; the remaining methods have a single result type.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Address,
  BitcoinRawTransaction,
  ChainKeys,
  EstimateGasParams,
  EvmContractCall,
  EvmRawTransaction,
  FeeEstimateTransaction,
  GetMoneyMarketTokensApiResponse,
  Hex,
  IBitcoinWalletProvider,
  IconRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveGasEstimate,
  InjectiveRawTransaction,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  MoneyMarketAllowanceCheckError,
  MoneyMarketApproveError,
  MoneyMarketBorrowActionParams,
  MoneyMarketBorrowParams,
  MoneyMarketCreateIntentError,
  MoneyMarketGasEstimationError,
  MoneyMarketOrchestrationError,
  MoneyMarketRepayActionParams,
  MoneyMarketRepayParams,
  MoneyMarketSupplyActionParams,
  MoneyMarketSupplyParams,
  MoneyMarketWithdrawActionParams,
  MoneyMarketWithdrawParams,
  NearRawTransaction,
  RelayExtraData,
  Result,
  SolanaRawTransaction,
  SpokeChainKey,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiGasEstimate,
  SuiRawTransaction,
  TxHashPair,
  XToken,
} from '../index.js';
import type { MoneyMarketService } from './MoneyMarketService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;

type P<K extends SpokeChainKey> = {
  supply: MoneyMarketSupplyParams<K>;
  borrow: MoneyMarketBorrowParams<K>;
  withdraw: MoneyMarketWithdrawParams<K>;
  repay: MoneyMarketRepayParams<K>;
  gas: EstimateGasParams<K>;
};

type Approve<T> = Promise<Result<T, MoneyMarketApproveError>>;
type Intent<T> = Promise<Result<{ tx: T; relayData: RelayExtraData }, MoneyMarketCreateIntentError>>;
type Orchestrated = Promise<Result<TxHashPair, MoneyMarketOrchestrationError>>;
// Per family: [walletProvider, raw: false, raw: true] for each exec-mode action, then the single-mode methods.
type Expected<Signed, Raw, Gas> = {
  readonly approve: readonly [Approve<Signed>, Approve<Signed>, Approve<Raw>];
  readonly createSupplyIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createBorrowIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createWithdrawIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createRepayIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly supply: Orchestrated;
  readonly borrow: Orchestrated;
  readonly withdraw: Orchestrated;
  readonly repay: Orchestrated;
  readonly isAllowanceValid: Promise<Result<boolean, MoneyMarketAllowanceCheckError>>;
  readonly estimateGas: Promise<Result<Gas, MoneyMarketGasEstimationError>>;
};

declare const mm: MoneyMarketService;
declare const isRaw: boolean;
declare const p: {
  evm: P<typeof ChainKeys.BSC_MAINNET>;
  hub: P<typeof ChainKeys.SONIC_MAINNET>;
  icon: P<typeof ChainKeys.ICON_MAINNET>;
  sui: P<typeof ChainKeys.SUI_MAINNET>;
  solana: P<typeof ChainKeys.SOLANA_MAINNET>;
  stellar: P<typeof ChainKeys.STELLAR_MAINNET>;
  injective: P<typeof ChainKeys.INJECTIVE_MAINNET>;
  stacks: P<typeof ChainKeys.STACKS_MAINNET>;
  near: P<typeof ChainKeys.NEAR_MAINNET>;
  bitcoin: P<typeof ChainKeys.BITCOIN_MAINNET>;
};
declare const w: {
  evm: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  solana: ISolanaWalletProvider;
  stellar: IStellarWalletProvider;
  injective: IInjectiveWalletProvider;
  stacks: IStacksWalletProvider;
  near: INearWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};

// Never invoked: `mm`, `p` and `w` exist only at the type level.
const evmRows = () =>
  ({
    approve: [
      mm.approve({ params: p.evm.supply, walletProvider: w.evm }),
      mm.approve({ params: p.evm.supply, raw: false, walletProvider: w.evm }),
      mm.approve({ params: p.evm.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.evm.supply, walletProvider: w.evm }),
      mm.createSupplyIntent({ params: p.evm.supply, raw: false, walletProvider: w.evm }),
      mm.createSupplyIntent({ params: p.evm.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.evm.borrow, walletProvider: w.evm }),
      mm.createBorrowIntent({ params: p.evm.borrow, raw: false, walletProvider: w.evm }),
      mm.createBorrowIntent({ params: p.evm.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.evm.withdraw, walletProvider: w.evm }),
      mm.createWithdrawIntent({ params: p.evm.withdraw, raw: false, walletProvider: w.evm }),
      mm.createWithdrawIntent({ params: p.evm.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.evm.repay, walletProvider: w.evm }),
      mm.createRepayIntent({ params: p.evm.repay, raw: false, walletProvider: w.evm }),
      mm.createRepayIntent({ params: p.evm.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.evm.supply, walletProvider: w.evm }),
    borrow: mm.borrow({ params: p.evm.borrow, walletProvider: w.evm }),
    withdraw: mm.withdraw({ params: p.evm.withdraw, walletProvider: w.evm }),
    repay: mm.repay({ params: p.evm.repay, walletProvider: w.evm }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.evm.repay }),
    estimateGas: mm.estimateGas(p.evm.gas),
  }) as const;

const hubRows = () =>
  ({
    approve: [
      mm.approve({ params: p.hub.supply, walletProvider: w.evm }),
      mm.approve({ params: p.hub.supply, raw: false, walletProvider: w.evm }),
      mm.approve({ params: p.hub.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.hub.supply, walletProvider: w.evm }),
      mm.createSupplyIntent({ params: p.hub.supply, raw: false, walletProvider: w.evm }),
      mm.createSupplyIntent({ params: p.hub.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.hub.borrow, walletProvider: w.evm }),
      mm.createBorrowIntent({ params: p.hub.borrow, raw: false, walletProvider: w.evm }),
      mm.createBorrowIntent({ params: p.hub.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.hub.withdraw, walletProvider: w.evm }),
      mm.createWithdrawIntent({ params: p.hub.withdraw, raw: false, walletProvider: w.evm }),
      mm.createWithdrawIntent({ params: p.hub.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.hub.repay, walletProvider: w.evm }),
      mm.createRepayIntent({ params: p.hub.repay, raw: false, walletProvider: w.evm }),
      mm.createRepayIntent({ params: p.hub.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.hub.supply, walletProvider: w.evm }),
    borrow: mm.borrow({ params: p.hub.borrow, walletProvider: w.evm }),
    withdraw: mm.withdraw({ params: p.hub.withdraw, walletProvider: w.evm }),
    repay: mm.repay({ params: p.hub.repay, walletProvider: w.evm }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.hub.repay }),
    estimateGas: mm.estimateGas(p.hub.gas),
  }) as const;

const iconRows = () =>
  ({
    approve: [
      mm.approve({ params: p.icon.supply, walletProvider: w.icon }),
      mm.approve({ params: p.icon.supply, raw: false, walletProvider: w.icon }),
      mm.approve({ params: p.icon.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.icon.supply, walletProvider: w.icon }),
      mm.createSupplyIntent({ params: p.icon.supply, raw: false, walletProvider: w.icon }),
      mm.createSupplyIntent({ params: p.icon.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.icon.borrow, walletProvider: w.icon }),
      mm.createBorrowIntent({ params: p.icon.borrow, raw: false, walletProvider: w.icon }),
      mm.createBorrowIntent({ params: p.icon.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.icon.withdraw, walletProvider: w.icon }),
      mm.createWithdrawIntent({ params: p.icon.withdraw, raw: false, walletProvider: w.icon }),
      mm.createWithdrawIntent({ params: p.icon.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.icon.repay, walletProvider: w.icon }),
      mm.createRepayIntent({ params: p.icon.repay, raw: false, walletProvider: w.icon }),
      mm.createRepayIntent({ params: p.icon.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.icon.supply, walletProvider: w.icon }),
    borrow: mm.borrow({ params: p.icon.borrow, walletProvider: w.icon }),
    withdraw: mm.withdraw({ params: p.icon.withdraw, walletProvider: w.icon }),
    repay: mm.repay({ params: p.icon.repay, walletProvider: w.icon }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.icon.repay }),
    estimateGas: mm.estimateGas(p.icon.gas),
  }) as const;

const suiRows = () =>
  ({
    approve: [
      mm.approve({ params: p.sui.supply, walletProvider: w.sui }),
      mm.approve({ params: p.sui.supply, raw: false, walletProvider: w.sui }),
      mm.approve({ params: p.sui.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.sui.supply, walletProvider: w.sui }),
      mm.createSupplyIntent({ params: p.sui.supply, raw: false, walletProvider: w.sui }),
      mm.createSupplyIntent({ params: p.sui.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.sui.borrow, walletProvider: w.sui }),
      mm.createBorrowIntent({ params: p.sui.borrow, raw: false, walletProvider: w.sui }),
      mm.createBorrowIntent({ params: p.sui.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.sui.withdraw, walletProvider: w.sui }),
      mm.createWithdrawIntent({ params: p.sui.withdraw, raw: false, walletProvider: w.sui }),
      mm.createWithdrawIntent({ params: p.sui.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.sui.repay, walletProvider: w.sui }),
      mm.createRepayIntent({ params: p.sui.repay, raw: false, walletProvider: w.sui }),
      mm.createRepayIntent({ params: p.sui.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.sui.supply, walletProvider: w.sui }),
    borrow: mm.borrow({ params: p.sui.borrow, walletProvider: w.sui }),
    withdraw: mm.withdraw({ params: p.sui.withdraw, walletProvider: w.sui }),
    repay: mm.repay({ params: p.sui.repay, walletProvider: w.sui }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.sui.repay }),
    estimateGas: mm.estimateGas(p.sui.gas),
  }) as const;

const solanaRows = () =>
  ({
    approve: [
      mm.approve({ params: p.solana.supply, walletProvider: w.solana }),
      mm.approve({ params: p.solana.supply, raw: false, walletProvider: w.solana }),
      mm.approve({ params: p.solana.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.solana.supply, walletProvider: w.solana }),
      mm.createSupplyIntent({ params: p.solana.supply, raw: false, walletProvider: w.solana }),
      mm.createSupplyIntent({ params: p.solana.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.solana.borrow, walletProvider: w.solana }),
      mm.createBorrowIntent({ params: p.solana.borrow, raw: false, walletProvider: w.solana }),
      mm.createBorrowIntent({ params: p.solana.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.solana.withdraw, walletProvider: w.solana }),
      mm.createWithdrawIntent({ params: p.solana.withdraw, raw: false, walletProvider: w.solana }),
      mm.createWithdrawIntent({ params: p.solana.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.solana.repay, walletProvider: w.solana }),
      mm.createRepayIntent({ params: p.solana.repay, raw: false, walletProvider: w.solana }),
      mm.createRepayIntent({ params: p.solana.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.solana.supply, walletProvider: w.solana }),
    borrow: mm.borrow({ params: p.solana.borrow, walletProvider: w.solana }),
    withdraw: mm.withdraw({ params: p.solana.withdraw, walletProvider: w.solana }),
    repay: mm.repay({ params: p.solana.repay, walletProvider: w.solana }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.solana.repay }),
    estimateGas: mm.estimateGas(p.solana.gas),
  }) as const;

const stellarRows = () =>
  ({
    approve: [
      mm.approve({ params: p.stellar.supply, walletProvider: w.stellar }),
      mm.approve({ params: p.stellar.supply, raw: false, walletProvider: w.stellar }),
      mm.approve({ params: p.stellar.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.stellar.supply, walletProvider: w.stellar }),
      mm.createSupplyIntent({ params: p.stellar.supply, raw: false, walletProvider: w.stellar }),
      mm.createSupplyIntent({ params: p.stellar.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.stellar.borrow, walletProvider: w.stellar }),
      mm.createBorrowIntent({ params: p.stellar.borrow, raw: false, walletProvider: w.stellar }),
      mm.createBorrowIntent({ params: p.stellar.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.stellar.withdraw, walletProvider: w.stellar }),
      mm.createWithdrawIntent({ params: p.stellar.withdraw, raw: false, walletProvider: w.stellar }),
      mm.createWithdrawIntent({ params: p.stellar.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.stellar.repay, walletProvider: w.stellar }),
      mm.createRepayIntent({ params: p.stellar.repay, raw: false, walletProvider: w.stellar }),
      mm.createRepayIntent({ params: p.stellar.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.stellar.supply, walletProvider: w.stellar }),
    borrow: mm.borrow({ params: p.stellar.borrow, walletProvider: w.stellar }),
    withdraw: mm.withdraw({ params: p.stellar.withdraw, walletProvider: w.stellar }),
    repay: mm.repay({ params: p.stellar.repay, walletProvider: w.stellar }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.stellar.repay }),
    estimateGas: mm.estimateGas(p.stellar.gas),
  }) as const;

const injectiveRows = () =>
  ({
    approve: [
      mm.approve({ params: p.injective.supply, walletProvider: w.injective }),
      mm.approve({ params: p.injective.supply, raw: false, walletProvider: w.injective }),
      mm.approve({ params: p.injective.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.injective.supply, walletProvider: w.injective }),
      mm.createSupplyIntent({ params: p.injective.supply, raw: false, walletProvider: w.injective }),
      mm.createSupplyIntent({ params: p.injective.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.injective.borrow, walletProvider: w.injective }),
      mm.createBorrowIntent({ params: p.injective.borrow, raw: false, walletProvider: w.injective }),
      mm.createBorrowIntent({ params: p.injective.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.injective.withdraw, walletProvider: w.injective }),
      mm.createWithdrawIntent({ params: p.injective.withdraw, raw: false, walletProvider: w.injective }),
      mm.createWithdrawIntent({ params: p.injective.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.injective.repay, walletProvider: w.injective }),
      mm.createRepayIntent({ params: p.injective.repay, raw: false, walletProvider: w.injective }),
      mm.createRepayIntent({ params: p.injective.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.injective.supply, walletProvider: w.injective }),
    borrow: mm.borrow({ params: p.injective.borrow, walletProvider: w.injective }),
    withdraw: mm.withdraw({ params: p.injective.withdraw, walletProvider: w.injective }),
    repay: mm.repay({ params: p.injective.repay, walletProvider: w.injective }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.injective.repay }),
    estimateGas: mm.estimateGas(p.injective.gas),
  }) as const;

const stacksRows = () =>
  ({
    approve: [
      mm.approve({ params: p.stacks.supply, walletProvider: w.stacks }),
      mm.approve({ params: p.stacks.supply, raw: false, walletProvider: w.stacks }),
      mm.approve({ params: p.stacks.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.stacks.supply, walletProvider: w.stacks }),
      mm.createSupplyIntent({ params: p.stacks.supply, raw: false, walletProvider: w.stacks }),
      mm.createSupplyIntent({ params: p.stacks.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.stacks.borrow, walletProvider: w.stacks }),
      mm.createBorrowIntent({ params: p.stacks.borrow, raw: false, walletProvider: w.stacks }),
      mm.createBorrowIntent({ params: p.stacks.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.stacks.withdraw, walletProvider: w.stacks }),
      mm.createWithdrawIntent({ params: p.stacks.withdraw, raw: false, walletProvider: w.stacks }),
      mm.createWithdrawIntent({ params: p.stacks.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.stacks.repay, walletProvider: w.stacks }),
      mm.createRepayIntent({ params: p.stacks.repay, raw: false, walletProvider: w.stacks }),
      mm.createRepayIntent({ params: p.stacks.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.stacks.supply, walletProvider: w.stacks }),
    borrow: mm.borrow({ params: p.stacks.borrow, walletProvider: w.stacks }),
    withdraw: mm.withdraw({ params: p.stacks.withdraw, walletProvider: w.stacks }),
    repay: mm.repay({ params: p.stacks.repay, walletProvider: w.stacks }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.stacks.repay }),
    estimateGas: mm.estimateGas(p.stacks.gas),
  }) as const;

const nearRows = () =>
  ({
    approve: [
      mm.approve({ params: p.near.supply, walletProvider: w.near }),
      mm.approve({ params: p.near.supply, raw: false, walletProvider: w.near }),
      mm.approve({ params: p.near.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.near.supply, walletProvider: w.near }),
      mm.createSupplyIntent({ params: p.near.supply, raw: false, walletProvider: w.near }),
      mm.createSupplyIntent({ params: p.near.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.near.borrow, walletProvider: w.near }),
      mm.createBorrowIntent({ params: p.near.borrow, raw: false, walletProvider: w.near }),
      mm.createBorrowIntent({ params: p.near.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.near.withdraw, walletProvider: w.near }),
      mm.createWithdrawIntent({ params: p.near.withdraw, raw: false, walletProvider: w.near }),
      mm.createWithdrawIntent({ params: p.near.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.near.repay, walletProvider: w.near }),
      mm.createRepayIntent({ params: p.near.repay, raw: false, walletProvider: w.near }),
      mm.createRepayIntent({ params: p.near.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.near.supply, walletProvider: w.near }),
    borrow: mm.borrow({ params: p.near.borrow, walletProvider: w.near }),
    withdraw: mm.withdraw({ params: p.near.withdraw, walletProvider: w.near }),
    repay: mm.repay({ params: p.near.repay, walletProvider: w.near }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.near.repay }),
    estimateGas: mm.estimateGas(p.near.gas),
  }) as const;

const bitcoinRows = () =>
  ({
    approve: [
      mm.approve({ params: p.bitcoin.supply, walletProvider: w.bitcoin }),
      mm.approve({ params: p.bitcoin.supply, raw: false, walletProvider: w.bitcoin }),
      mm.approve({ params: p.bitcoin.supply, raw: true }),
    ],
    createSupplyIntent: [
      mm.createSupplyIntent({ params: p.bitcoin.supply, walletProvider: w.bitcoin }),
      mm.createSupplyIntent({ params: p.bitcoin.supply, raw: false, walletProvider: w.bitcoin }),
      mm.createSupplyIntent({ params: p.bitcoin.supply, raw: true }),
    ],
    createBorrowIntent: [
      mm.createBorrowIntent({ params: p.bitcoin.borrow, walletProvider: w.bitcoin }),
      mm.createBorrowIntent({ params: p.bitcoin.borrow, raw: false, walletProvider: w.bitcoin }),
      mm.createBorrowIntent({ params: p.bitcoin.borrow, raw: true }),
    ],
    createWithdrawIntent: [
      mm.createWithdrawIntent({ params: p.bitcoin.withdraw, walletProvider: w.bitcoin }),
      mm.createWithdrawIntent({ params: p.bitcoin.withdraw, raw: false, walletProvider: w.bitcoin }),
      mm.createWithdrawIntent({ params: p.bitcoin.withdraw, raw: true }),
    ],
    createRepayIntent: [
      mm.createRepayIntent({ params: p.bitcoin.repay, walletProvider: w.bitcoin }),
      mm.createRepayIntent({ params: p.bitcoin.repay, raw: false, walletProvider: w.bitcoin }),
      mm.createRepayIntent({ params: p.bitcoin.repay, raw: true }),
    ],
    supply: mm.supply({ params: p.bitcoin.supply, walletProvider: w.bitcoin }),
    borrow: mm.borrow({ params: p.bitcoin.borrow, walletProvider: w.bitcoin }),
    withdraw: mm.withdraw({ params: p.bitcoin.withdraw, walletProvider: w.bitcoin }),
    repay: mm.repay({ params: p.bitcoin.repay, walletProvider: w.bitcoin }),
    isAllowanceValid: mm.isAllowanceValid({ params: p.bitcoin.repay }),
    estimateGas: mm.estimateGas(p.bitcoin.gas),
  }) as const;

describe('MoneyMarketService — exec-mode actions narrow by chain family and mode', () => {
  it('evm (BSC_MAINNET): Hex signed, EvmRawTransaction raw, bigint gas', () => {
    expectTypeOf<ReturnType<typeof evmRows>>().toEqualTypeOf<Expected<Hex, EvmRawTransaction, bigint>>();
  });

  it('hub (SONIC_MAINNET): Hex signed, EvmRawTransaction raw, bigint gas', () => {
    expectTypeOf<ReturnType<typeof hubRows>>().toEqualTypeOf<Expected<Hex, EvmRawTransaction, bigint>>();
  });

  it('icon (ICON_MAINNET): Hex signed, IconRawTransaction raw, bigint gas', () => {
    expectTypeOf<ReturnType<typeof iconRows>>().toEqualTypeOf<Expected<Hex, IconRawTransaction, bigint>>();
  });

  it('sui (SUI_MAINNET): string signed, SuiRawTransaction raw, SuiGasEstimate gas', () => {
    expectTypeOf<ReturnType<typeof suiRows>>().toEqualTypeOf<Expected<string, SuiRawTransaction, SuiGasEstimate>>();
  });

  it('solana (SOLANA_MAINNET): string signed, SolanaRawTransaction raw, number | undefined gas', () => {
    expectTypeOf<ReturnType<typeof solanaRows>>().toEqualTypeOf<
      Expected<string, SolanaRawTransaction, number | undefined>
    >();
  });

  it('stellar (STELLAR_MAINNET): string signed, StellarRawTransaction raw, bigint gas', () => {
    expectTypeOf<ReturnType<typeof stellarRows>>().toEqualTypeOf<Expected<string, StellarRawTransaction, bigint>>();
  });

  it('injective (INJECTIVE_MAINNET): string signed, InjectiveRawTransaction raw, InjectiveGasEstimate gas', () => {
    expectTypeOf<ReturnType<typeof injectiveRows>>().toEqualTypeOf<
      Expected<string, InjectiveRawTransaction, InjectiveGasEstimate>
    >();
  });

  it('stacks (STACKS_MAINNET): string signed, StacksRawTransaction raw, FeeEstimateTransaction gas', () => {
    expectTypeOf<ReturnType<typeof stacksRows>>().toEqualTypeOf<
      Expected<string, StacksRawTransaction, FeeEstimateTransaction>
    >();
  });

  it('near (NEAR_MAINNET): string signed, NearRawTransaction raw, bigint gas', () => {
    expectTypeOf<ReturnType<typeof nearRows>>().toEqualTypeOf<Expected<string, NearRawTransaction, bigint>>();
  });

  it('bitcoin (BITCOIN_MAINNET): string signed, BitcoinRawTransaction | string raw, bigint gas', () => {
    expectTypeOf<ReturnType<typeof bitcoinRows>>().toEqualTypeOf<
      Expected<string, BitcoinRawTransaction | string, bigint>
    >();
  });

  it('a mode only known at runtime keeps both results, inferred from the argument', () => {
    const approve = (args: MoneyMarketSupplyActionParams<BSC, boolean>) => mm.approve(args);
    const supply = (args: MoneyMarketSupplyActionParams<BSC, boolean>) => mm.createSupplyIntent(args);
    const borrow = (args: MoneyMarketBorrowActionParams<SOLANA, boolean>) => mm.createBorrowIntent(args);
    const withdraw = (args: MoneyMarketWithdrawActionParams<BSC, boolean>) => mm.createWithdrawIntent(args);
    const repay = (args: MoneyMarketRepayActionParams<BSC, boolean>) => mm.createRepayIntent(args);
    const ternary = () =>
      mm.createSupplyIntent(
        isRaw ? { params: p.evm.supply, raw: true } : { params: p.evm.supply, raw: false, walletProvider: w.evm },
      );
    expectTypeOf<ReturnType<typeof approve>>().toEqualTypeOf<Approve<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof supply>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof borrow>>().toEqualTypeOf<Intent<string | SolanaRawTransaction>>();
    expectTypeOf<ReturnType<typeof withdraw>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof repay>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof ternary>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
  });

  it('rejects mixed modes, mismatched wallets, raw orchestration and mismatched actions', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      mm.createSupplyIntent({ params: p.evm.supply, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      mm.createBorrowIntent({ params: p.evm.borrow }),
      // @ts-expect-error — raw: false still needs a walletProvider.
      mm.approve({ params: p.evm.supply, raw: false }),
      // @ts-expect-error — the walletProvider must match the source chain (Solana wallet on BSC).
      mm.createWithdrawIntent({ params: p.evm.withdraw, walletProvider: w.solana }),
      // @ts-expect-error — the walletProvider must match the source chain (EVM wallet on Stellar).
      mm.createRepayIntent({ params: p.stellar.repay, walletProvider: w.evm }),
      // @ts-expect-error — orchestrated actions broadcast and wait, so they have no raw mode.
      mm.supply({ params: p.evm.supply, raw: true }),
      // @ts-expect-error — orchestrated actions need a walletProvider.
      mm.repay({ params: p.evm.repay }),
      // @ts-expect-error — createSupplyIntent only takes supply params.
      mm.createSupplyIntent({ params: p.evm.borrow, walletProvider: w.evm }),
      // @ts-expect-error — the raw transaction must belong to the gas estimate chain.
      mm.estimateGas({ chainKey: p.evm.gas.chainKey, tx: p.solana.gas.tx }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});

describe('MoneyMarketService — single result type', () => {
  it('build*Data returns hub calldata', () => {
    expectTypeOf<ReturnType<MoneyMarketService['buildSupplyData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<MoneyMarketService['buildBorrowData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<MoneyMarketService['buildWithdrawData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<MoneyMarketService['buildRepayData']>>().toEqualTypeOf<Hex>();
  });

  it('static encoders return an EVM contract call', () => {
    expectTypeOf<ReturnType<typeof MoneyMarketService.encodeSupply>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof MoneyMarketService.encodeWithdraw>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof MoneyMarketService.encodeBorrow>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof MoneyMarketService.encodeRepay>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof MoneyMarketService.encodeRepayWithATokens>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<
      ReturnType<typeof MoneyMarketService.encodeSetUserUseReserveAsCollateral>
    >().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<typeof MoneyMarketService.calculateATokenAmount>>().toEqualTypeOf<bigint>();
  });

  it('supported token and reserve lookups', () => {
    expectTypeOf<ReturnType<MoneyMarketService['getSupportedTokensByChainId']>>().toEqualTypeOf<readonly XToken[]>();
    expectTypeOf<
      ReturnType<MoneyMarketService['getSupportedTokens']>
    >().toEqualTypeOf<GetMoneyMarketTokensApiResponse>();
    expectTypeOf<ReturnType<MoneyMarketService['getSupportedReserves']>>().toEqualTypeOf<readonly Address[]>();
  });
});
