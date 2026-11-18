/**
 * Compile-time contract for the `SpokeService` router: the chain key selects the per-family spoke
 * service, wallet provider, raw transaction, gas estimate and receipt, inferred with no type arguments.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinGasEstimate,
  BitcoinRawTransaction,
  BitcoinRawTransactionReceipt,
  ChainKeys,
  DepositParams,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  FeeEstimateTransaction,
  GetBalanceParams,
  GetBalancesParams,
  GetDepositParams,
  Hex,
  IBitcoinWalletProvider,
  IconRawTransaction,
  IconTransactionResult,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveGasEstimate,
  InjectiveRawTransaction,
  InjectiveRawTransactionReceipt,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  NearRawTransaction,
  NearRawTransactionReceipt,
  Result,
  SendMessageParams,
  SolanaGasEstimate,
  SolanaRawTransaction,
  SolanaRawTransactionReceipt,
  SpokeApproveParams,
  SpokeChainKey,
  SpokeIsAllowanceValidParams,
  StacksRawTransaction,
  StacksRawTransactionReceipt,
  StellarRawTransaction,
  StellarSorobanTransactionReceipt,
  SuiGasEstimate,
  SuiRawTransaction,
  SuiRawTransactionReceipt,
  VerifySimulationParams,
  VerifyTxHashParams,
  WalletBalanceMap,
  WalletSimulationParams,
} from '../../../index.js';
import type { BitcoinSpokeService } from './BitcoinSpokeService.js';
import type { EvmSpokeService } from './EvmSpokeService.js';
import type { IconSpokeService } from './IconSpokeService.js';
import type { InjectiveSpokeService } from './InjectiveSpokeService.js';
import type { NearSpokeService } from './NearSpokeService.js';
import type { SolanaSpokeService } from './SolanaSpokeService.js';
import type { SonicSpokeService } from './SonicSpokeService.js';
import type { SpokeService, SpokeServiceType } from './SpokeService.js';
import type { StacksSpokeService } from './StacksSpokeService.js';
import type { StellarSpokeService } from './StellarSpokeService.js';
import type { SuiSpokeService } from './SuiSpokeService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type PR<T> = Promise<Result<T>>;
type Pair<Signed, Raw> = readonly [PR<Signed>, PR<Raw>];
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const spoke: SpokeService;
declare const isRaw: boolean;
declare const w: {
  evm: IEvmWalletProvider;
  solana: ISolanaWalletProvider;
  stellar: IStellarWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  injective: IInjectiveWalletProvider;
  stacks: IStacksWalletProvider;
  near: INearWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};
declare const dep: {
  evm: Flat<DepositParams<BSC, false>>;
  sonic: Flat<DepositParams<SONIC, false>>;
  solana: Flat<DepositParams<SOLANA, false>>;
  stellar: Flat<DepositParams<STELLAR, false>>;
  icon: Flat<DepositParams<ICON, false>>;
  sui: Flat<DepositParams<SUI, false>>;
  injective: Flat<DepositParams<INJECTIVE, false>>;
  stacks: Flat<DepositParams<STACKS, false>>;
  near: Flat<DepositParams<NEAR, false>>;
  bitcoin: Flat<DepositParams<BITCOIN, false>>;
};
declare const msg: {
  evm: Flat<SendMessageParams<BSC, false>>;
  sonic: Flat<SendMessageParams<SONIC, false>>;
  solana: Flat<SendMessageParams<SOLANA, false>>;
  stellar: Flat<SendMessageParams<STELLAR, false>>;
  icon: Flat<SendMessageParams<ICON, false>>;
  sui: Flat<SendMessageParams<SUI, false>>;
  injective: Flat<SendMessageParams<INJECTIVE, false>>;
  stacks: Flat<SendMessageParams<STACKS, false>>;
  near: Flat<SendMessageParams<NEAR, false>>;
  bitcoin: Flat<SendMessageParams<BITCOIN, false>>;
};
declare const appr: {
  evm: Flat<SpokeApproveParams<BSC, false>>;
  sonic: Flat<SpokeApproveParams<SONIC, false>>;
  stellar: Flat<SpokeApproveParams<STELLAR, false>>;
};
declare const solanaApprove: Omit<Flat<SpokeApproveParams<BSC, false>>, 'srcChainKey'> & { srcChainKey: SOLANA };
declare const tx: {
  evm: EvmRawTransaction;
  solana: SolanaRawTransaction;
  stellar: StellarRawTransaction;
  icon: IconRawTransaction;
  sui: SuiRawTransaction;
  injective: InjectiveRawTransaction;
  stacks: StacksRawTransaction;
  near: NearRawTransaction;
  bitcoin: BitcoinRawTransaction;
};
declare const key: {
  bsc: BSC;
  sonic: SONIC;
  solana: SOLANA;
  stellar: STELLAR;
  icon: ICON;
  sui: SUI;
  injective: INJECTIVE;
  stacks: STACKS;
  near: NEAR;
  bitcoin: BITCOIN;
  any: SpokeChainKey;
};
declare const evmAddress: Hex;
declare const iconGetDeposit: GetDepositParams<ICON>;
declare const bscBalance: GetBalanceParams<BSC>;
declare const suiBalances: GetBalancesParams<SUI>;
declare const allowanceP: SpokeIsAllowanceValidParams;
declare const simP: WalletSimulationParams;
declare const verifyHashP: VerifyTxHashParams;
declare const verifySimEvm: VerifySimulationParams<BSC, false>;
declare const verifySimSolanaRaw: VerifySimulationParams<SOLANA, true>;

describe('SpokeService', () => {
  it('getSpokeService: the chain key selects the family service', () => {
    const rows = () =>
      ({
        evm: spoke.getSpokeService(key.bsc),
        sonic: spoke.getSpokeService(key.sonic),
        solana: spoke.getSpokeService(key.solana),
        stellar: spoke.getSpokeService(key.stellar),
        icon: spoke.getSpokeService(key.icon),
        sui: spoke.getSpokeService(key.sui),
        injective: spoke.getSpokeService(key.injective),
        stacks: spoke.getSpokeService(key.stacks),
        near: spoke.getSpokeService(key.near),
        bitcoin: spoke.getSpokeService(key.bitcoin),
        any: spoke.getSpokeService(key.any),
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: EvmSpokeService;
      readonly sonic: SonicSpokeService;
      readonly solana: SolanaSpokeService;
      readonly stellar: StellarSpokeService;
      readonly icon: IconSpokeService;
      readonly sui: SuiSpokeService;
      readonly injective: InjectiveSpokeService;
      readonly stacks: StacksSpokeService;
      readonly near: NearSpokeService;
      readonly bitcoin: BitcoinSpokeService;
      readonly any: SpokeServiceType;
    }>();
    expectTypeOf<SpokeServiceType>().toEqualTypeOf<
      | EvmSpokeService
      | SonicSpokeService
      | SolanaSpokeService
      | StellarSpokeService
      | IconSpokeService
      | SuiSpokeService
      | InjectiveSpokeService
      | StacksSpokeService
      | NearSpokeService
      | BitcoinSpokeService
    >();
  });

  it('deposit: every family narrows to its hash (walletProvider) and raw transaction (raw: true)', () => {
    const rows = () =>
      ({
        evm: [spoke.deposit({ ...dep.evm, walletProvider: w.evm }), spoke.deposit({ ...dep.evm, raw: true })],
        sonic: [spoke.deposit({ ...dep.sonic, walletProvider: w.evm }), spoke.deposit({ ...dep.sonic, raw: true })],
        solana: [
          spoke.deposit({ ...dep.solana, walletProvider: w.solana }),
          spoke.deposit({ ...dep.solana, raw: true }),
        ],
        stellar: [
          spoke.deposit({ ...dep.stellar, walletProvider: w.stellar }),
          spoke.deposit({ ...dep.stellar, raw: true }),
        ],
        icon: [spoke.deposit({ ...dep.icon, walletProvider: w.icon }), spoke.deposit({ ...dep.icon, raw: true })],
        sui: [spoke.deposit({ ...dep.sui, walletProvider: w.sui }), spoke.deposit({ ...dep.sui, raw: true })],
        injective: [
          spoke.deposit({ ...dep.injective, walletProvider: w.injective }),
          spoke.deposit({ ...dep.injective, raw: true }),
        ],
        stacks: [
          spoke.deposit({ ...dep.stacks, walletProvider: w.stacks }),
          spoke.deposit({ ...dep.stacks, raw: true }),
        ],
        near: [spoke.deposit({ ...dep.near, walletProvider: w.near }), spoke.deposit({ ...dep.near, raw: true })],
        bitcoin: [
          spoke.deposit({ ...dep.bitcoin, walletProvider: w.bitcoin }),
          spoke.deposit({ ...dep.bitcoin, raw: true }),
        ],
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: Pair<Hex, EvmRawTransaction>;
      readonly sonic: Pair<Hex, EvmRawTransaction>;
      readonly solana: Pair<string, SolanaRawTransaction>;
      readonly stellar: Pair<string, StellarRawTransaction>;
      readonly icon: Pair<Hex, IconRawTransaction>;
      readonly sui: Pair<string, SuiRawTransaction>;
      readonly injective: Pair<string, InjectiveRawTransaction>;
      readonly stacks: Pair<string, StacksRawTransaction>;
      readonly near: Pair<string, NearRawTransaction>;
      readonly bitcoin: Pair<string, BitcoinRawTransaction | string>;
    }>();
  });

  it('deposit: raw: false matches the signed form; a runtime boolean keeps both results', () => {
    const rawFalse = () => spoke.deposit({ ...dep.evm, raw: false, walletProvider: w.evm });
    expectTypeOf<ReturnType<typeof rawFalse>>().toEqualTypeOf<PR<Hex>>();
    const runtime = () =>
      spoke.deposit(isRaw ? { ...dep.icon, raw: true } : { ...dep.icon, raw: false, walletProvider: w.icon });
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<PR<Hex | IconRawTransaction>>();
    const widened = (args: DepositParams<SOLANA, boolean>) => spoke.deposit(args);
    expectTypeOf<ReturnType<typeof widened>>().toEqualTypeOf<PR<string | SolanaRawTransaction>>();
  });

  it('deposit: rejects mixed modes and a wallet provider of another family', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      spoke.deposit({ ...dep.evm, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      spoke.deposit({ ...dep.evm }),
      // @ts-expect-error — the walletProvider must match the source chain family.
      spoke.deposit({ ...dep.evm, walletProvider: w.solana }),
      // @ts-expect-error — Sui source chain needs a Sui wallet provider.
      spoke.deposit({ ...dep.sui, walletProvider: w.evm }),
    ];
    expectTypeOf(calls).toBeFunction();
  });

  it('sendMessage: every family narrows to its hash and raw transaction', () => {
    const rows = () =>
      ({
        evm: [spoke.sendMessage({ ...msg.evm, walletProvider: w.evm }), spoke.sendMessage({ ...msg.evm, raw: true })],
        sonic: [
          spoke.sendMessage({ ...msg.sonic, walletProvider: w.evm }),
          spoke.sendMessage({ ...msg.sonic, raw: true }),
        ],
        solana: [
          spoke.sendMessage({ ...msg.solana, walletProvider: w.solana }),
          spoke.sendMessage({ ...msg.solana, raw: true }),
        ],
        stellar: [
          spoke.sendMessage({ ...msg.stellar, walletProvider: w.stellar }),
          spoke.sendMessage({ ...msg.stellar, raw: true }),
        ],
        icon: [
          spoke.sendMessage({ ...msg.icon, walletProvider: w.icon }),
          spoke.sendMessage({ ...msg.icon, raw: true }),
        ],
        sui: [spoke.sendMessage({ ...msg.sui, walletProvider: w.sui }), spoke.sendMessage({ ...msg.sui, raw: true })],
        injective: [
          spoke.sendMessage({ ...msg.injective, walletProvider: w.injective }),
          spoke.sendMessage({ ...msg.injective, raw: true }),
        ],
        stacks: [
          spoke.sendMessage({ ...msg.stacks, walletProvider: w.stacks }),
          spoke.sendMessage({ ...msg.stacks, raw: true }),
        ],
        near: [
          spoke.sendMessage({ ...msg.near, walletProvider: w.near }),
          spoke.sendMessage({ ...msg.near, raw: true }),
        ],
        bitcoin: [
          spoke.sendMessage({ ...msg.bitcoin, walletProvider: w.bitcoin }),
          spoke.sendMessage({ ...msg.bitcoin, raw: true }),
        ],
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: Pair<Hex, EvmRawTransaction>;
      readonly sonic: Pair<Hex, EvmRawTransaction>;
      readonly solana: Pair<string, SolanaRawTransaction>;
      readonly stellar: Pair<string, StellarRawTransaction>;
      readonly icon: Pair<Hex, IconRawTransaction>;
      readonly sui: Pair<string, SuiRawTransaction>;
      readonly injective: Pair<string, InjectiveRawTransaction>;
      readonly stacks: Pair<string, StacksRawTransaction>;
      readonly near: Pair<string, NearRawTransaction>;
      readonly bitcoin: Pair<string, BitcoinRawTransaction | string>;
    }>();
    const rawFalse = () => spoke.sendMessage({ ...msg.near, raw: false, walletProvider: w.near });
    expectTypeOf<ReturnType<typeof rawFalse>>().toEqualTypeOf<PR<string>>();
    const runtime = (args: SendMessageParams<BSC, boolean>) => spoke.sendMessage(args);
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<PR<Hex | EvmRawTransaction>>();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      spoke.sendMessage({ ...msg.stacks, raw: true, walletProvider: w.stacks }),
      // @ts-expect-error — the walletProvider must match the source chain family.
      spoke.sendMessage({ ...msg.icon, walletProvider: w.evm }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('approve: hub, EVM spoke and Stellar narrow per mode; other families are rejected', () => {
    const rows = () =>
      ({
        evm: [spoke.approve({ ...appr.evm, walletProvider: w.evm }), spoke.approve({ ...appr.evm, raw: true })],
        sonic: [spoke.approve({ ...appr.sonic, walletProvider: w.evm }), spoke.approve({ ...appr.sonic, raw: true })],
        stellar: [
          spoke.approve({ ...appr.stellar, walletProvider: w.stellar }),
          spoke.approve({ ...appr.stellar, raw: true }),
        ],
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: Pair<Hex, EvmRawTransaction>;
      readonly sonic: Pair<Hex, EvmRawTransaction>;
      readonly stellar: Pair<string, StellarRawTransaction>;
    }>();
    const rawFalse = () => spoke.approve({ ...appr.stellar, raw: false, walletProvider: w.stellar });
    expectTypeOf<ReturnType<typeof rawFalse>>().toEqualTypeOf<PR<string>>();
    const runtime = (args: SpokeApproveParams<SONIC, boolean>) => spoke.approve(args);
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<PR<Hex | EvmRawTransaction>>();
    const invalid = () => [
      // @ts-expect-error — Solana has no spoke approval; its params resolve to never.
      spoke.approve({ ...solanaApprove, walletProvider: w.solana }),
      // @ts-expect-error — raw: true forbids walletProvider.
      spoke.approve({ ...appr.evm, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — the walletProvider must match the source chain family.
      spoke.approve({ ...appr.stellar, walletProvider: w.evm }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('buildApproveTxs: the reset and approve transactions are the chain raw type', () => {
    const rows = () =>
      ({
        evm: spoke.buildApproveTxs({ ...appr.evm, raw: true }),
        sonic: spoke.buildApproveTxs({ ...appr.sonic, raw: true }),
        stellar: spoke.buildApproveTxs({ ...appr.stellar, raw: true }),
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: PR<{ readonly resetTx?: EvmRawTransaction; readonly approveTx: EvmRawTransaction }>;
      readonly sonic: PR<{ readonly resetTx?: EvmRawTransaction; readonly approveTx: EvmRawTransaction }>;
      readonly stellar: PR<{ readonly resetTx?: StellarRawTransaction; readonly approveTx: StellarRawTransaction }>;
    }>();
    const invalid = () =>
      // @ts-expect-error — building approval transactions is raw-only.
      spoke.buildApproveTxs({ ...appr.evm, walletProvider: w.evm });
    expectTypeOf(invalid).toBeFunction();
  });

  it('estimateGas: every family narrows to its gas estimate', () => {
    const rows = () =>
      ({
        evm: spoke.estimateGas({ tx: tx.evm, chainKey: key.bsc }),
        sonic: spoke.estimateGas({ tx: tx.evm, chainKey: key.sonic }),
        solana: spoke.estimateGas({ tx: tx.solana, chainKey: key.solana }),
        stellar: spoke.estimateGas({ tx: tx.stellar, chainKey: key.stellar }),
        icon: spoke.estimateGas({ tx: tx.icon, chainKey: key.icon }),
        sui: spoke.estimateGas({ tx: tx.sui, chainKey: key.sui }),
        injective: spoke.estimateGas({ tx: tx.injective, chainKey: key.injective }),
        stacks: spoke.estimateGas({ tx: tx.stacks, chainKey: key.stacks }),
        near: spoke.estimateGas({ tx: tx.near, chainKey: key.near }),
        bitcoin: spoke.estimateGas({ tx: tx.bitcoin, chainKey: key.bitcoin }),
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: PR<bigint>;
      readonly sonic: PR<bigint>;
      readonly solana: PR<SolanaGasEstimate>;
      readonly stellar: PR<bigint>;
      readonly icon: PR<bigint>;
      readonly sui: PR<SuiGasEstimate>;
      readonly injective: PR<InjectiveGasEstimate>;
      readonly stacks: PR<FeeEstimateTransaction>;
      readonly near: PR<bigint>;
      readonly bitcoin: PR<BitcoinGasEstimate>;
    }>();
    expectTypeOf<SolanaGasEstimate>().toEqualTypeOf<number | undefined>();
    const invalid = () =>
      // @ts-expect-error — the transaction must be the chain's raw transaction.
      spoke.estimateGas({ tx: tx.evm, chainKey: key.icon });
    expectTypeOf(invalid).toBeFunction();
  });

  it('waitForTxReceipt: every family narrows to its receipt', () => {
    const rows = () =>
      ({
        evm: spoke.waitForTxReceipt({ txHash: '', chainKey: key.bsc }),
        sonic: spoke.waitForTxReceipt({ txHash: '', chainKey: key.sonic }),
        solana: spoke.waitForTxReceipt({ txHash: '', chainKey: key.solana }),
        stellar: spoke.waitForTxReceipt({ txHash: '', chainKey: key.stellar }),
        icon: spoke.waitForTxReceipt({ txHash: '', chainKey: key.icon }),
        sui: spoke.waitForTxReceipt({ txHash: '', chainKey: key.sui }),
        injective: spoke.waitForTxReceipt({ txHash: '', chainKey: key.injective }),
        stacks: spoke.waitForTxReceipt({ txHash: '', chainKey: key.stacks }),
        near: spoke.waitForTxReceipt({ txHash: '', chainKey: key.near }),
        bitcoin: spoke.waitForTxReceipt({ txHash: '', chainKey: key.bitcoin }),
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly evm: PR<Receipt<EvmRawTransactionReceipt>>;
      readonly sonic: PR<Receipt<EvmRawTransactionReceipt>>;
      readonly solana: PR<Receipt<SolanaRawTransactionReceipt>>;
      readonly stellar: PR<Receipt<StellarSorobanTransactionReceipt>>;
      readonly icon: PR<Receipt<IconTransactionResult>>;
      readonly sui: PR<Receipt<SuiRawTransactionReceipt>>;
      readonly injective: PR<Receipt<InjectiveRawTransactionReceipt>>;
      readonly stacks: PR<Receipt<StacksRawTransactionReceipt>>;
      readonly near: PR<Receipt<NearRawTransactionReceipt>>;
      readonly bitcoin: PR<Receipt<BitcoinRawTransactionReceipt>>;
    }>();
  });

  it('chain-agnostic reads and checks pin one result type', () => {
    expectTypeOf<ReturnType<SpokeService['isAllowanceValid']>>().toEqualTypeOf<PR<boolean>>();
    expectTypeOf<ReturnType<SpokeService['simulateDeposit']>>().toEqualTypeOf<PR<boolean>>();
    expectTypeOf<ReturnType<SpokeService['simulateRecvMessage']>>().toEqualTypeOf<PR<boolean>>();
    expectTypeOf<ReturnType<SpokeService['getLimit']>>().toEqualTypeOf<PR<bigint>>();
    expectTypeOf<ReturnType<SpokeService['getAvailable']>>().toEqualTypeOf<PR<bigint>>();
    expectTypeOf<ReturnType<SpokeService['verifyTxHash']>>().toEqualTypeOf<PR<boolean>>();
    expectTypeOf<ReturnType<typeof SpokeService.encodeTransfer>>().toEqualTypeOf<Hex>();
    const calls = () =>
      [
        spoke.isAllowanceValid(allowanceP),
        spoke.simulateRecvMessage(simP),
        spoke.verifyTxHash(verifyHashP),
        spoke.simulateDeposit({ ...dep.evm, walletProvider: w.evm }),
      ] as const;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<
      readonly [PR<boolean>, PR<boolean>, PR<boolean>, PR<boolean>]
    >();
  });

  it('balance and deposit reads return bigint / WalletBalanceMap for every family', () => {
    const rows = () =>
      ({
        getDeposit: spoke.getDeposit(iconGetDeposit),
        getWalletBalance: spoke.getWalletBalance(bscBalance),
        getWalletBalances: spoke.getWalletBalances(suiBalances),
      }) as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly getDeposit: PR<bigint>;
      readonly getWalletBalance: PR<bigint>;
      readonly getWalletBalances: PR<WalletBalanceMap>;
    }>();
    expectTypeOf<WalletBalanceMap>().toEqualTypeOf<Record<string, bigint>>();
    const invalid = () =>
      // @ts-expect-error — an ICON source chain needs an ICON address, not an EVM one.
      spoke.getDeposit({ ...iconGetDeposit, srcAddress: evmAddress });
    expectTypeOf(invalid).toBeFunction();
  });

  it('verification steps resolve to Result<void> in every mode', () => {
    const rows = () =>
      [
        spoke.verifySimulation(verifySimEvm),
        spoke.verifySimulation(verifySimSolanaRaw),
        spoke.verifyDepositSimulation({ ...dep.stacks, walletProvider: w.stacks }),
        spoke.verifyDepositSimulation({ ...dep.bitcoin, raw: true }),
      ] as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<readonly [PR<void>, PR<void>, PR<void>, PR<void>]>();
  });
});
