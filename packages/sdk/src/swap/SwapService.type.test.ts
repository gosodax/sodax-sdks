/**
 * Compile-time contract for `SwapService`: every public method's exact result type, and for the
 * chain- and mode-generic actions the result per chain family and execution mode, inferred from the
 * arguments with no type arguments. Enforced by `pnpm checkTs`; no-ops under vitest.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinGasEstimate,
  BitcoinRawTransaction,
  CancelIntentParams,
  ChainKeys,
  CreateIntentParams,
  CreateLimitOrderParams,
  DetailedStatusError,
  DetailedSwapStatus,
  EvmGasEstimate,
  EvmRawTransaction,
  FeeAmount,
  FeeEstimateTransaction,
  GetRelayResponse,
  Hex,
  IBitcoinWalletProvider,
  IconGasEstimate,
  IconRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveGasEstimate,
  InjectiveRawTransaction,
  Intent,
  IntentDeliveryInfo,
  IntentState,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  NearGasEstimate,
  NearRawTransaction,
  PacketData,
  PartnerFee,
  PostExecutionError,
  RelayExtraData,
  Result,
  SolanaGasEstimate,
  SolanaRawTransaction,
  SolverErrorResponse,
  SolverExecutionResponse,
  SolverIntentQuoteResponse,
  SolverIntentStatusResponse,
  SpokeChainKey,
  StacksRawTransaction,
  StellarGasEstimate,
  StellarRawTransaction,
  SuiGasEstimate,
  SuiRawTransaction,
  SwapCreateIntentError,
  SwapError,
  SwapSpeedTierResult,
  SwapWithApprovalError,
  TxHashPair,
  XToken,
  ApprovalStrategy,
  ApprovalStrategyError,
} from '../index.js';
import type { SwapService } from './SwapService.js';

type SONIC = typeof ChainKeys.SONIC_MAINNET;
type BSC = typeof ChainKeys.BSC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

// [broadcast hash, unsigned transaction] per chain family, spelled out rather than derived from `TxReturnType`.
type Family = {
  sonic: [Hex, EvmRawTransaction];
  bsc: [Hex, EvmRawTransaction];
  icon: [Hex, IconRawTransaction];
  sui: [string, SuiRawTransaction];
  solana: [string, SolanaRawTransaction];
  stellar: [string, StellarRawTransaction];
  injective: [string, InjectiveRawTransaction];
  near: [string, NearRawTransaction];
  stacks: [string, StacksRawTransaction];
  // Bitcoin's raw type already includes the hash string.
  bitcoin: [string, BitcoinRawTransaction | string];
};
// Columns of every matrix row: [walletProvider, raw: false, raw: true, runtime boolean].
type Modes<Hash, Raw> = [Result<Hash>, Result<Hash>, Result<Raw>, Result<Hash | Raw>];
type AwaitAll<T extends readonly unknown[]> = { -readonly [I in keyof T]: Awaited<T[I]> };
type Settled<T extends Record<string, readonly unknown[]>> = { -readonly [F in keyof T]: AwaitAll<T[F]> };
type Created<Tx> = { tx: Tx; intent: Intent & FeeAmount; relayData: RelayExtraData };

declare const swaps: SwapService;
declare const isRaw: boolean;
declare const w: {
  evm: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  solana: ISolanaWalletProvider;
  stellar: IStellarWalletProvider;
  injective: IInjectiveWalletProvider;
  near: INearWalletProvider;
  stacks: IStacksWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};
declare const p: {
  sonic: CreateIntentParams<SONIC>;
  bsc: CreateIntentParams<BSC>;
  icon: CreateIntentParams<ICON>;
  sui: CreateIntentParams<SUI>;
  solana: CreateIntentParams<SOLANA>;
  stellar: CreateIntentParams<STELLAR>;
  injective: CreateIntentParams<INJECTIVE>;
  near: CreateIntentParams<NEAR>;
  stacks: CreateIntentParams<STACKS>;
  bitcoin: CreateIntentParams<BITCOIN>;
};
declare const lo: {
  sonic: CreateLimitOrderParams<SONIC>;
  bsc: CreateLimitOrderParams<BSC>;
  icon: CreateLimitOrderParams<ICON>;
  sui: CreateLimitOrderParams<SUI>;
  solana: CreateLimitOrderParams<SOLANA>;
  stellar: CreateLimitOrderParams<STELLAR>;
  injective: CreateLimitOrderParams<INJECTIVE>;
  near: CreateLimitOrderParams<NEAR>;
  stacks: CreateLimitOrderParams<STACKS>;
  bitcoin: CreateLimitOrderParams<BITCOIN>;
};
declare const c: {
  sonic: CancelIntentParams<SONIC>;
  bsc: CancelIntentParams<BSC>;
  icon: CancelIntentParams<ICON>;
  sui: CancelIntentParams<SUI>;
  solana: CancelIntentParams<SOLANA>;
  stellar: CancelIntentParams<STELLAR>;
  injective: CancelIntentParams<INJECTIVE>;
  near: CancelIntentParams<NEAR>;
  stacks: CancelIntentParams<STACKS>;
  bitcoin: CancelIntentParams<BITCOIN>;
};
declare const intent: Intent;

// Never invoked: each row is one chain family across the four execution modes.
const approveRows = () =>
  ({
    sonic: [
      swaps.approve({ params: p.sonic, walletProvider: w.evm }),
      swaps.approve({ params: p.sonic, raw: false, walletProvider: w.evm }),
      swaps.approve({ params: p.sonic, raw: true }),
      swaps.approve(isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm }),
    ],
    bsc: [
      swaps.approve({ params: p.bsc, walletProvider: w.evm }),
      swaps.approve({ params: p.bsc, raw: false, walletProvider: w.evm }),
      swaps.approve({ params: p.bsc, raw: true }),
      swaps.approve(isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm }),
    ],
    icon: [
      swaps.approve({ params: p.icon, walletProvider: w.icon }),
      swaps.approve({ params: p.icon, raw: false, walletProvider: w.icon }),
      swaps.approve({ params: p.icon, raw: true }),
      swaps.approve(isRaw ? { params: p.icon, raw: true } : { params: p.icon, raw: false, walletProvider: w.icon }),
    ],
    sui: [
      swaps.approve({ params: p.sui, walletProvider: w.sui }),
      swaps.approve({ params: p.sui, raw: false, walletProvider: w.sui }),
      swaps.approve({ params: p.sui, raw: true }),
      swaps.approve(isRaw ? { params: p.sui, raw: true } : { params: p.sui, raw: false, walletProvider: w.sui }),
    ],
    solana: [
      swaps.approve({ params: p.solana, walletProvider: w.solana }),
      swaps.approve({ params: p.solana, raw: false, walletProvider: w.solana }),
      swaps.approve({ params: p.solana, raw: true }),
      swaps.approve(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      swaps.approve({ params: p.stellar, walletProvider: w.stellar }),
      swaps.approve({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      swaps.approve({ params: p.stellar, raw: true }),
      swaps.approve(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      swaps.approve({ params: p.injective, walletProvider: w.injective }),
      swaps.approve({ params: p.injective, raw: false, walletProvider: w.injective }),
      swaps.approve({ params: p.injective, raw: true }),
      swaps.approve(
        isRaw ? { params: p.injective, raw: true } : { params: p.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      swaps.approve({ params: p.near, walletProvider: w.near }),
      swaps.approve({ params: p.near, raw: false, walletProvider: w.near }),
      swaps.approve({ params: p.near, raw: true }),
      swaps.approve(isRaw ? { params: p.near, raw: true } : { params: p.near, raw: false, walletProvider: w.near }),
    ],
    stacks: [
      swaps.approve({ params: p.stacks, walletProvider: w.stacks }),
      swaps.approve({ params: p.stacks, raw: false, walletProvider: w.stacks }),
      swaps.approve({ params: p.stacks, raw: true }),
      swaps.approve(
        isRaw ? { params: p.stacks, raw: true } : { params: p.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      swaps.approve({ params: p.bitcoin, walletProvider: w.bitcoin }),
      swaps.approve({ params: p.bitcoin, raw: false, walletProvider: w.bitcoin }),
      swaps.approve({ params: p.bitcoin, raw: true }),
      swaps.approve(
        isRaw ? { params: p.bitcoin, raw: true } : { params: p.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

const createIntentRows = () =>
  ({
    sonic: [
      swaps.createIntent({ params: p.sonic, walletProvider: w.evm }),
      swaps.createIntent({ params: p.sonic, raw: false, walletProvider: w.evm }),
      swaps.createIntent({ params: p.sonic, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      swaps.createIntent({ params: p.bsc, walletProvider: w.evm }),
      swaps.createIntent({ params: p.bsc, raw: false, walletProvider: w.evm }),
      swaps.createIntent({ params: p.bsc, raw: true }),
      swaps.createIntent(isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm }),
    ],
    icon: [
      swaps.createIntent({ params: p.icon, walletProvider: w.icon }),
      swaps.createIntent({ params: p.icon, raw: false, walletProvider: w.icon }),
      swaps.createIntent({ params: p.icon, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.icon, raw: true } : { params: p.icon, raw: false, walletProvider: w.icon },
      ),
    ],
    sui: [
      swaps.createIntent({ params: p.sui, walletProvider: w.sui }),
      swaps.createIntent({ params: p.sui, raw: false, walletProvider: w.sui }),
      swaps.createIntent({ params: p.sui, raw: true }),
      swaps.createIntent(isRaw ? { params: p.sui, raw: true } : { params: p.sui, raw: false, walletProvider: w.sui }),
    ],
    solana: [
      swaps.createIntent({ params: p.solana, walletProvider: w.solana }),
      swaps.createIntent({ params: p.solana, raw: false, walletProvider: w.solana }),
      swaps.createIntent({ params: p.solana, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      swaps.createIntent({ params: p.stellar, walletProvider: w.stellar }),
      swaps.createIntent({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      swaps.createIntent({ params: p.stellar, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      swaps.createIntent({ params: p.injective, walletProvider: w.injective }),
      swaps.createIntent({ params: p.injective, raw: false, walletProvider: w.injective }),
      swaps.createIntent({ params: p.injective, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.injective, raw: true } : { params: p.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      swaps.createIntent({ params: p.near, walletProvider: w.near }),
      swaps.createIntent({ params: p.near, raw: false, walletProvider: w.near }),
      swaps.createIntent({ params: p.near, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.near, raw: true } : { params: p.near, raw: false, walletProvider: w.near },
      ),
    ],
    stacks: [
      swaps.createIntent({ params: p.stacks, walletProvider: w.stacks }),
      swaps.createIntent({ params: p.stacks, raw: false, walletProvider: w.stacks }),
      swaps.createIntent({ params: p.stacks, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.stacks, raw: true } : { params: p.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      swaps.createIntent({ params: p.bitcoin, walletProvider: w.bitcoin }),
      swaps.createIntent({ params: p.bitcoin, raw: false, walletProvider: w.bitcoin }),
      swaps.createIntent({ params: p.bitcoin, raw: true }),
      swaps.createIntent(
        isRaw ? { params: p.bitcoin, raw: true } : { params: p.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

const createLimitOrderIntentRows = () =>
  ({
    sonic: [
      swaps.createLimitOrderIntent({ params: lo.sonic, walletProvider: w.evm }),
      swaps.createLimitOrderIntent({ params: lo.sonic, raw: false, walletProvider: w.evm }),
      swaps.createLimitOrderIntent({ params: lo.sonic, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.sonic, raw: true } : { params: lo.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      swaps.createLimitOrderIntent({ params: lo.bsc, walletProvider: w.evm }),
      swaps.createLimitOrderIntent({ params: lo.bsc, raw: false, walletProvider: w.evm }),
      swaps.createLimitOrderIntent({ params: lo.bsc, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.bsc, raw: true } : { params: lo.bsc, raw: false, walletProvider: w.evm },
      ),
    ],
    icon: [
      swaps.createLimitOrderIntent({ params: lo.icon, walletProvider: w.icon }),
      swaps.createLimitOrderIntent({ params: lo.icon, raw: false, walletProvider: w.icon }),
      swaps.createLimitOrderIntent({ params: lo.icon, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.icon, raw: true } : { params: lo.icon, raw: false, walletProvider: w.icon },
      ),
    ],
    sui: [
      swaps.createLimitOrderIntent({ params: lo.sui, walletProvider: w.sui }),
      swaps.createLimitOrderIntent({ params: lo.sui, raw: false, walletProvider: w.sui }),
      swaps.createLimitOrderIntent({ params: lo.sui, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.sui, raw: true } : { params: lo.sui, raw: false, walletProvider: w.sui },
      ),
    ],
    solana: [
      swaps.createLimitOrderIntent({ params: lo.solana, walletProvider: w.solana }),
      swaps.createLimitOrderIntent({ params: lo.solana, raw: false, walletProvider: w.solana }),
      swaps.createLimitOrderIntent({ params: lo.solana, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.solana, raw: true } : { params: lo.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      swaps.createLimitOrderIntent({ params: lo.stellar, walletProvider: w.stellar }),
      swaps.createLimitOrderIntent({ params: lo.stellar, raw: false, walletProvider: w.stellar }),
      swaps.createLimitOrderIntent({ params: lo.stellar, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.stellar, raw: true } : { params: lo.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      swaps.createLimitOrderIntent({ params: lo.injective, walletProvider: w.injective }),
      swaps.createLimitOrderIntent({ params: lo.injective, raw: false, walletProvider: w.injective }),
      swaps.createLimitOrderIntent({ params: lo.injective, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.injective, raw: true } : { params: lo.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      swaps.createLimitOrderIntent({ params: lo.near, walletProvider: w.near }),
      swaps.createLimitOrderIntent({ params: lo.near, raw: false, walletProvider: w.near }),
      swaps.createLimitOrderIntent({ params: lo.near, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.near, raw: true } : { params: lo.near, raw: false, walletProvider: w.near },
      ),
    ],
    stacks: [
      swaps.createLimitOrderIntent({ params: lo.stacks, walletProvider: w.stacks }),
      swaps.createLimitOrderIntent({ params: lo.stacks, raw: false, walletProvider: w.stacks }),
      swaps.createLimitOrderIntent({ params: lo.stacks, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.stacks, raw: true } : { params: lo.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      swaps.createLimitOrderIntent({ params: lo.bitcoin, walletProvider: w.bitcoin }),
      swaps.createLimitOrderIntent({ params: lo.bitcoin, raw: false, walletProvider: w.bitcoin }),
      swaps.createLimitOrderIntent({ params: lo.bitcoin, raw: true }),
      swaps.createLimitOrderIntent(
        isRaw ? { params: lo.bitcoin, raw: true } : { params: lo.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

const createCancelIntentRows = () =>
  ({
    sonic: [
      swaps.createCancelIntent({ params: c.sonic, walletProvider: w.evm }),
      swaps.createCancelIntent({ params: c.sonic, raw: false, walletProvider: w.evm }),
      swaps.createCancelIntent({ params: c.sonic, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.sonic, raw: true } : { params: c.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      swaps.createCancelIntent({ params: c.bsc, walletProvider: w.evm }),
      swaps.createCancelIntent({ params: c.bsc, raw: false, walletProvider: w.evm }),
      swaps.createCancelIntent({ params: c.bsc, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.bsc, raw: true } : { params: c.bsc, raw: false, walletProvider: w.evm },
      ),
    ],
    icon: [
      swaps.createCancelIntent({ params: c.icon, walletProvider: w.icon }),
      swaps.createCancelIntent({ params: c.icon, raw: false, walletProvider: w.icon }),
      swaps.createCancelIntent({ params: c.icon, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.icon, raw: true } : { params: c.icon, raw: false, walletProvider: w.icon },
      ),
    ],
    sui: [
      swaps.createCancelIntent({ params: c.sui, walletProvider: w.sui }),
      swaps.createCancelIntent({ params: c.sui, raw: false, walletProvider: w.sui }),
      swaps.createCancelIntent({ params: c.sui, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.sui, raw: true } : { params: c.sui, raw: false, walletProvider: w.sui },
      ),
    ],
    solana: [
      swaps.createCancelIntent({ params: c.solana, walletProvider: w.solana }),
      swaps.createCancelIntent({ params: c.solana, raw: false, walletProvider: w.solana }),
      swaps.createCancelIntent({ params: c.solana, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.solana, raw: true } : { params: c.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      swaps.createCancelIntent({ params: c.stellar, walletProvider: w.stellar }),
      swaps.createCancelIntent({ params: c.stellar, raw: false, walletProvider: w.stellar }),
      swaps.createCancelIntent({ params: c.stellar, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.stellar, raw: true } : { params: c.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      swaps.createCancelIntent({ params: c.injective, walletProvider: w.injective }),
      swaps.createCancelIntent({ params: c.injective, raw: false, walletProvider: w.injective }),
      swaps.createCancelIntent({ params: c.injective, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.injective, raw: true } : { params: c.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      swaps.createCancelIntent({ params: c.near, walletProvider: w.near }),
      swaps.createCancelIntent({ params: c.near, raw: false, walletProvider: w.near }),
      swaps.createCancelIntent({ params: c.near, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.near, raw: true } : { params: c.near, raw: false, walletProvider: w.near },
      ),
    ],
    stacks: [
      swaps.createCancelIntent({ params: c.stacks, walletProvider: w.stacks }),
      swaps.createCancelIntent({ params: c.stacks, raw: false, walletProvider: w.stacks }),
      swaps.createCancelIntent({ params: c.stacks, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.stacks, raw: true } : { params: c.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      swaps.createCancelIntent({ params: c.bitcoin, walletProvider: w.bitcoin }),
      swaps.createCancelIntent({ params: c.bitcoin, raw: false, walletProvider: w.bitcoin }),
      swaps.createCancelIntent({ params: c.bitcoin, raw: true }),
      swaps.createCancelIntent(
        isRaw ? { params: c.bitcoin, raw: true } : { params: c.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

// `isAllowanceValid` accepts either mode; its result is a boolean regardless.
const isAllowanceValidRows = () =>
  ({
    sonic: [
      swaps.isAllowanceValid({ params: p.sonic, walletProvider: w.evm }),
      swaps.isAllowanceValid({ params: p.sonic, raw: false, walletProvider: w.evm }),
      swaps.isAllowanceValid({ params: p.sonic, raw: true }),
      swaps.isAllowanceValid(
        isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      swaps.isAllowanceValid({ params: p.bsc, walletProvider: w.evm }),
      swaps.isAllowanceValid({ params: p.bsc, raw: false, walletProvider: w.evm }),
      swaps.isAllowanceValid({ params: p.bsc, raw: true }),
      swaps.isAllowanceValid(
        isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm },
      ),
    ],
    stellar: [
      swaps.isAllowanceValid({ params: p.stellar, walletProvider: w.stellar }),
      swaps.isAllowanceValid({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      swaps.isAllowanceValid({ params: p.stellar, raw: true }),
      swaps.isAllowanceValid(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    solana: [
      swaps.isAllowanceValid({ params: p.solana, walletProvider: w.solana }),
      swaps.isAllowanceValid({ params: p.solana, raw: false, walletProvider: w.solana }),
      swaps.isAllowanceValid({ params: p.solana, raw: true }),
      swaps.isAllowanceValid(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
  }) as const;

// `buildApproveTxs` is raw-only and returns the chain's unsigned approval transactions.
const buildApproveTxsRows = () =>
  ({
    sonic: swaps.buildApproveTxs({ params: p.sonic, raw: true }),
    bsc: swaps.buildApproveTxs({ params: p.bsc, raw: true }),
    icon: swaps.buildApproveTxs({ params: p.icon, raw: true }),
    sui: swaps.buildApproveTxs({ params: p.sui, raw: true }),
    solana: swaps.buildApproveTxs({ params: p.solana, raw: true }),
    stellar: swaps.buildApproveTxs({ params: p.stellar, raw: true }),
    injective: swaps.buildApproveTxs({ params: p.injective, raw: true }),
    near: swaps.buildApproveTxs({ params: p.near, raw: true }),
    stacks: swaps.buildApproveTxs({ params: p.stacks, raw: true }),
    bitcoin: swaps.buildApproveTxs({ params: p.bitcoin, raw: true }),
  }) as const;

declare const evmTx: EvmRawTransaction;
declare const iconTx: IconRawTransaction;
declare const suiTx: SuiRawTransaction;
declare const solanaTx: SolanaRawTransaction;
declare const stellarTx: StellarRawTransaction;
declare const injectiveTx: InjectiveRawTransaction;
declare const nearTx: NearRawTransaction;
declare const stacksTx: StacksRawTransaction;
declare const bitcoinTx: BitcoinRawTransaction;
declare const k: {
  sonic: SONIC;
  bsc: BSC;
  icon: ICON;
  sui: SUI;
  solana: SOLANA;
  stellar: STELLAR;
  injective: INJECTIVE;
  near: NEAR;
  stacks: STACKS;
  bitcoin: BITCOIN;
};

const estimateGasRows = () =>
  ({
    sonic: swaps.estimateGas({ tx: evmTx, chainKey: k.sonic }),
    bsc: swaps.estimateGas({ tx: evmTx, chainKey: k.bsc }),
    icon: swaps.estimateGas({ tx: iconTx, chainKey: k.icon }),
    sui: swaps.estimateGas({ tx: suiTx, chainKey: k.sui }),
    solana: swaps.estimateGas({ tx: solanaTx, chainKey: k.solana }),
    stellar: swaps.estimateGas({ tx: stellarTx, chainKey: k.stellar }),
    injective: swaps.estimateGas({ tx: injectiveTx, chainKey: k.injective }),
    near: swaps.estimateGas({ tx: nearTx, chainKey: k.near }),
    stacks: swaps.estimateGas({ tx: stacksTx, chainKey: k.stacks }),
    bitcoin: swaps.estimateGas({ tx: bitcoinTx, chainKey: k.bitcoin }),
  }) as const;

type Unwrapped<T> = { -readonly [F in keyof T]: Awaited<T[F]> };

describe('SwapService — chain- and mode-generic actions', () => {
  it('approve: hash per family when signed, unsigned tx with raw: true, both for a runtime boolean', () => {
    expectTypeOf<Settled<ReturnType<typeof approveRows>>>().toEqualTypeOf<{
      [F in keyof Family]: Modes<Family[F][0], Family[F][1]>;
    }>();
  });

  it('createIntent: the spoke tx per family and mode, wrapped with the intent and relay data', () => {
    expectTypeOf<Settled<ReturnType<typeof createIntentRows>>>().toEqualTypeOf<{
      [F in keyof Family]: [
        Result<Created<Family[F][0]>, SwapCreateIntentError>,
        Result<Created<Family[F][0]>, SwapCreateIntentError>,
        Result<Created<Family[F][1]>, SwapCreateIntentError>,
        Result<Created<Family[F][0] | Family[F][1]>, SwapCreateIntentError>,
      ];
    }>();
  });

  it('createLimitOrderIntent: same shape as createIntent', () => {
    expectTypeOf<Settled<ReturnType<typeof createLimitOrderIntentRows>>>().toEqualTypeOf<{
      [F in keyof Family]: [
        Result<Created<Family[F][0]>, SwapCreateIntentError>,
        Result<Created<Family[F][0]>, SwapCreateIntentError>,
        Result<Created<Family[F][1]>, SwapCreateIntentError>,
        Result<Created<Family[F][0] | Family[F][1]>, SwapCreateIntentError>,
      ];
    }>();
  });

  it('createCancelIntent: hash per family when signed, unsigned tx with raw: true', () => {
    expectTypeOf<Settled<ReturnType<typeof createCancelIntentRows>>>().toEqualTypeOf<{
      [F in keyof Family]: Modes<Family[F][0], Family[F][1]>;
    }>();
  });

  it('isAllowanceValid: a boolean in every family and mode', () => {
    type B = Result<boolean>;
    expectTypeOf<Settled<ReturnType<typeof isAllowanceValidRows>>>().toEqualTypeOf<{
      sonic: [B, B, B, B];
      bsc: [B, B, B, B];
      stellar: [B, B, B, B];
      solana: [B, B, B, B];
    }>();
  });

  it('buildApproveTxs: the chain’s unsigned reset/approve pair', () => {
    expectTypeOf<Unwrapped<ReturnType<typeof buildApproveTxsRows>>>().toEqualTypeOf<{
      [F in keyof Family]: Result<{ readonly resetTx?: Family[F][1]; readonly approveTx: Family[F][1] }>;
    }>();
  });

  it('estimateGas: the gas estimate type of the chain', () => {
    expectTypeOf<Unwrapped<ReturnType<typeof estimateGasRows>>>().toEqualTypeOf<{
      sonic: Result<EvmGasEstimate>;
      bsc: Result<EvmGasEstimate>;
      icon: Result<IconGasEstimate>;
      sui: Result<SuiGasEstimate>;
      solana: Result<SolanaGasEstimate>;
      stellar: Result<StellarGasEstimate>;
      injective: Result<InjectiveGasEstimate>;
      near: Result<NearGasEstimate>;
      stacks: Result<FeeEstimateTransaction>;
      bitcoin: Result<BitcoinGasEstimate>;
    }>();
  });

  it('signed-only orchestrations resolve to the same result whatever the chain', () => {
    const swapCalls = () =>
      [
        swaps.swap({ params: p.bsc, walletProvider: w.evm }),
        swaps.swap({ params: p.solana, raw: false, walletProvider: w.solana }),
        swaps.swap({ params: p.bitcoin, walletProvider: w.bitcoin }),
      ] as const;
    type SwapOk = Result<
      { solverExecutionResponse: SolverExecutionResponse; intent: Intent; intentDeliveryInfo: IntentDeliveryInfo },
      SwapError
    >;
    expectTypeOf<Settled<{ r: ReturnType<typeof swapCalls> }>['r']>().toEqualTypeOf<[SwapOk, SwapOk, SwapOk]>();

    const limitCalls = () =>
      [
        swaps.createLimitOrder({ params: lo.sonic, walletProvider: w.evm }),
        swaps.createLimitOrder({ params: lo.sui, walletProvider: w.sui }),
      ] as const;
    expectTypeOf<Settled<{ r: ReturnType<typeof limitCalls> }>['r']>().toEqualTypeOf<[SwapOk, SwapOk]>();

    const withApproval = () =>
      [
        swaps.swapWithApproval({ params: p.bsc, walletProvider: w.evm }),
        swaps.swapWithApproval({ params: p.stellar, walletProvider: w.stellar, resumeBatchId: 'id' }),
      ] as const;
    type WithApprovalOk = Result<
      {
        solverExecutionResponse: SolverExecutionResponse;
        intent: Intent;
        intentDeliveryInfo: IntentDeliveryInfo;
      } & { approvalStrategy: ApprovalStrategy },
      SwapWithApprovalError
    >;
    expectTypeOf<Settled<{ r: ReturnType<typeof withApproval> }>['r']>().toEqualTypeOf<
      [WithApprovalOk, WithApprovalOk]
    >();

    const strategy = () =>
      [
        swaps.getApprovalStrategy({ params: p.bsc, walletProvider: w.evm }),
        swaps.getApprovalStrategy({ params: p.icon, walletProvider: w.icon }),
      ] as const;
    type StrategyOk = Result<ApprovalStrategy, ApprovalStrategyError>;
    expectTypeOf<Settled<{ r: ReturnType<typeof strategy> }>['r']>().toEqualTypeOf<[StrategyOk, StrategyOk]>();

    const cancels = () =>
      [
        swaps.cancelIntent({ params: c.bsc, walletProvider: w.evm }),
        swaps.cancelIntent({ params: c.near, walletProvider: w.near }),
        swaps.cancelLimitOrder({ params: c.sonic, walletProvider: w.evm }),
        swaps.cancelLimitOrder({ params: c.stacks, walletProvider: w.stacks }),
      ] as const;
    type Pair = Result<TxHashPair>;
    expectTypeOf<Settled<{ r: ReturnType<typeof cancels> }>['r']>().toEqualTypeOf<[Pair, Pair, Pair, Pair]>();
  });

  it('rejects invalid chain / wallet / mode combinations', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids a walletProvider.
      swaps.approve({ params: p.bsc, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      swaps.createIntent({ params: p.bsc }),
      // @ts-expect-error — the walletProvider must match the source chain family.
      swaps.createIntent({ params: p.solana, walletProvider: w.evm }),
      // @ts-expect-error — the walletProvider must match the source chain family.
      swaps.createCancelIntent({ params: c.icon, walletProvider: w.sui }),
      // @ts-expect-error — swap is signed-only.
      swaps.swap({ params: p.bsc, raw: true }),
      // @ts-expect-error — createLimitOrder is signed-only.
      swaps.createLimitOrder({ params: lo.bsc, raw: true }),
      // @ts-expect-error — cancelIntent is signed-only.
      swaps.cancelIntent({ params: c.bsc, raw: true }),
      // @ts-expect-error — swapWithApproval is signed-only.
      swaps.swapWithApproval({ params: p.bsc, raw: true }),
      // @ts-expect-error — buildApproveTxs is raw-only.
      swaps.buildApproveTxs({ params: p.bsc, walletProvider: w.evm }),
      // @ts-expect-error — the tx must be the chain's raw transaction type.
      swaps.estimateGas({ tx: suiTx, chainKey: k.bsc }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});

describe('SwapService — non-narrowing methods', () => {
  it('pins each result type', () => {
    expectTypeOf<ReturnType<SwapService['getQuote']>>().toEqualTypeOf<
      Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>>
    >();
    expectTypeOf<ReturnType<SwapService['getPartnerFee']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<SwapService['getSolverFee']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<SwapService['getStatus']>>().toEqualTypeOf<
      Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>>
    >();
    expectTypeOf<ReturnType<SwapService['getDetailedStatus']>>().toEqualTypeOf<
      Promise<Result<DetailedSwapStatus, DetailedStatusError>>
    >();
    expectTypeOf<ReturnType<SwapService['postExecution']>>().toEqualTypeOf<
      Promise<Result<SolverExecutionResponse, PostExecutionError>>
    >();
    expectTypeOf<ReturnType<SwapService['submitIntent']>>().toEqualTypeOf<
      Promise<Result<GetRelayResponse<'submit'>>>
    >();
    expectTypeOf<ReturnType<SwapService['getCancelIntentRelayData']>>().toEqualTypeOf<Result<RelayExtraData>>();
    expectTypeOf<ReturnType<SwapService['reconstructRelayData']>>().toEqualTypeOf<Result<RelayExtraData>>();
    expectTypeOf<ReturnType<SwapService['getIntent']>>().toEqualTypeOf<Promise<Result<Intent>>>();
    expectTypeOf<ReturnType<SwapService['getFilledIntent']>>().toEqualTypeOf<Promise<Result<IntentState>>>();
    expectTypeOf<ReturnType<SwapService['getSolvedIntentPacket']>>().toEqualTypeOf<Promise<Result<PacketData>>>();
    expectTypeOf<ReturnType<SwapService['getIntentHash']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<SwapService['getSwapDeadline']>>().toEqualTypeOf<Promise<Result<bigint>>>();
    expectTypeOf<ReturnType<SwapService['getSupportedSwapTokensByChainId']>>().toEqualTypeOf<readonly XToken[]>();
    expectTypeOf<ReturnType<SwapService['getSupportedSwapTokens']>>().toEqualTypeOf<
      Record<SpokeChainKey, readonly XToken[]>
    >();
    expectTypeOf<ReturnType<SwapService['getSwapSpeedTier']>>().toEqualTypeOf<SwapSpeedTierResult>();
  });

  it('getQuote accepts the optional partnerFee override without changing the result', () => {
    expectTypeOf<Parameters<SwapService['getQuote']>[0]['partnerFee']>().toEqualTypeOf<PartnerFee | undefined>();
  });

  it('getIntentSubmitTxExtraData: both params variants resolve to relay data', () => {
    const byHash = () => swaps.getIntentSubmitTxExtraData({ txHash: '0x' });
    const byIntent = () => swaps.getIntentSubmitTxExtraData({ intent });
    expectTypeOf<ReturnType<typeof byHash>>().toEqualTypeOf<Promise<Result<RelayExtraData>>>();
    expectTypeOf<ReturnType<typeof byIntent>>().toEqualTypeOf<Promise<Result<RelayExtraData>>>();
  });
});
