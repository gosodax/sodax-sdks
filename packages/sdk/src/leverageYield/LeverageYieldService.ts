import { SOLVED_PAYOUT_HEADROOM_FACTOR } from '../shared/utils/solved-payout.js';
import {
  type SpokeService,
  type SendMessageParams,
  adjustAmountByFee,
  Erc20Service,
  Erc4626Service,
  EvmVaultTokenService,
  encodeContractCalls,
  encodeRecipient,
  poolAbi,
  SonicSpokeService,
  isSonicChainKeyType,
  isHubChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  isStellarChainKeyType,
  isXrpChainKeyType,
  isEvmWalletProviderType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeIsAllowanceValidParamsStellar,
  isBitcoinChainKeyType,
  isPartnerFeeAmount,
  isPartnerFeePercentage,
  isUndefinedOrValidWalletProviderForChainKey,
  relayTxAndWaitPacket,
  RELAY_FALLBACK_FLOOR_MS,
  retry,
  type RelayExtraData,
  type IntentDeliveryInfo,
  assertMpcPayoutAboveMinimum,
} from '../shared/index.js';
import type { HubProvider, TxHashPair } from '../shared/types/types.js';
import {
  DEFAULT_RELAY_TX_TIMEOUT,
  FEE_PERCENTAGE_SCALE,
  getIntentRelayChainId,
  HUB_CHAIN_KEY,
  isMpcRelayChainKey,
  SolverIntentErrorCode,
  SolverIntentStatusCode,
  type DepositReturnType,
  type SendMessageReturnType,
} from '@sodax/types';
import type {
  Address,
  EvmContractCall,
  EvmRawTransaction,
  EvmSpokeOnlyChainKey,
  FeeAmount,
  GetAddressType,
  GetTokenAddressType,
  GetWalletProviderType,
  Hash,
  Hex,
  HubChainKey,
  IEvmWalletProvider,
  IWalletProvider,
  LeveragePosition,
  LeveragePositionAccount,
  LeveragePositionCollateral,
  LeverageYieldVault,
  PartnerFee,
  Result,
  SolverErrorResponse,
  SolverExecutionRequest,
  SolverExecutionResponse,
  SolverIntentQuoteRequest,
  SolverIntentQuoteResponse,
  LeveragePositionPendingState,
  SolverIntentStatusRequest,
  SolverIntentStatusResponse,
  SonicChainKey,
  SpokeChainKey,
  SpokeExecActionParams,
  StellarChainKey,
  TxReturnType,
  XToken,
} from '@sodax/types';
import type { BackendApiService, RequestOverrideConfig } from '../backendApi/index.js';
import {
  DETAILED_STATUS_NOT_DELIVERED,
  isBackendSubmitTxAbandoned,
  readIntentJournalOutcome,
  resolveDeliveredHubTxHash,
} from '../backendApi/detailedStatusRouting.js';
import { isAuthFailure, isSodaxError } from '../errors/guards.js';
import type { DetailedLeverageYieldStatus, DetailedLeverageYieldStatusKey } from './detailedStatus.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
import { createSubmitTxAttempt, type SubmitTxAttempt } from '../backendApi/submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';
import { canSendAtomicBatch } from '../shared/utils/evmAtomicBatch.js';
import {
  approvalBatchWaitMs,
  confirmApproval,
  confirmApprovalBatch,
  resolveApprovalStrategy,
  runWithApproval,
  sendApprovalBatch,
  type ApprovalOptions,
  type ApprovalStrategy,
  type ApprovalStrategyError,
} from '../shared/utils/approvalBatch.js';
import { intentDepositSpender } from '../swap/intentDepositSpender.js';
import type { ApprovalTxs } from '../shared/types/spoke-types.js';
import { encodeFunctionData, erc20Abi, isAddress, isAddressEqual, isHex, parseAbi, zeroAddress } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { CreateIntentParams, Intent } from '../shared/types/intent-types.js';
import { EvmSolverService } from '../swap/EvmSolverService.js';
import { SolverApiService } from '../swap/SolverApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  allowanceCheckFailed,
  approveFailed,
  executionFailed,
  intentCreationFailed,
  lookupFailed,
  unknownFailed,
  verifyFailed,
  withErrorContext,
} from '../errors/wrappers.js';
import type { LeverageYieldDetailedStatusError } from './errors.js';
import {
  isLeverageYieldAllowanceCheckError,
  isLeverageYieldApproveError,
  isLeverageYieldCreateIntentError,
  isLeverageYieldLookupError,
  isLeverageYieldPostExecutionError,
  isLeverageYieldSwapError,
  isVaultSwapWithApprovalError,
  type LeverageYieldAction,
  type LeverageYieldAllowanceCheckError,
  type LeverageYieldApproveError,
  type LeverageYieldCreateIntentError,
  type LeverageYieldLookupError,
  type LeverageYieldPostExecutionError,
  type LeverageYieldSwapError,
  type VaultSwapWithApprovalError,
  leverageYieldInvariant,
} from './errors.js';
import { resolvePositionFundingAddress } from './positionFunding.js';
import type { PositionLegQuote } from './positionLegQuote.js';
import {
  reportPositionIntent,
  type LeveragePositionIntentResult,
  type PositionIntentNotifier,
} from './positionIntent.js';

// Leverage-vault-specific fragment; standard ERC-4626 lives in the shared ABI directory.
const leverageYieldVaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function getPositionDetails() view returns (uint256 collateral, uint256 debt, uint256 ltv, uint256 healthFactor, uint256 idleAsset)',
  'function pool() view returns (address)',
  'function borrowToken() view returns (address)',
  'function targetLTV() view returns (uint256)',
]);

/** Mirrors `LeveragePosition.MAX_FEE_BPS`. Unlike a vault quote's bound, this one is permanent. */
export const MAX_POSITION_FEE_BPS = 100;

// One owner-controlled AAVE account per position; collateral, debt and HF are read from the pool, not the contracts.
const leveragePositionFactoryAbi = parseAbi([
  'function positionsOf(address owner) view returns (address[])',
  'function nextPositionIdFor(address owner) view returns (uint256)',
  'function predictPosition(address creator, address owner, uint256 positionId) view returns (address)',
  'function createPositionAndLeverage((address owner, address collateral, address borrowToken, uint8 eModeCategory, uint256 originChainId, bytes originAddress, address originAsset, address feeReceiver, uint16 feeBps) cfg, uint256 initialAssets, uint256 borrowAmount, uint256 minCollateralOut) returns (address)',
  'function createPositionFromDebtToken((address owner, address collateral, address borrowToken, uint8 eModeCategory, uint256 originChainId, bytes originAddress, address originAsset, address feeReceiver, uint16 feeBps) cfg, uint256 contribution, uint256 totalInput, uint256 minCollateralOut) returns (address)',
]);

const leveragePositionAbi = parseAbi([
  'function owner() view returns (address)',
  'function collateral() view returns (address)',
  'function borrowToken() view returns (address)',
  'function eModeCategory() view returns (uint8)',
  'function feeBps() view returns (uint16)',
  'function feeReceiver() view returns (address)',
  'function hasPendingOperation() view returns (bool)',
  'function pendingKind() view returns (uint8)',
  'function addLeverage(uint256 borrowAmount, uint256 minCollateralOut)',
  'function decreaseLeverage(uint256 collateralIn, uint256 minDebtOut, address exitAsset)',
  'function withdraw(uint256 amount, address to)',
  'function cancel()',
  'function settle()',
]);

/** Default intent deadline buffer, added to the HUB block timestamp (enforced on-chain), never the client clock. */
const INTENT_DEADLINE_BUFFER_SECONDS = 5 * 60;

/** Budgets for `getDetailedStatus`'s secondary reads (same as `SwapService`); worst case is their sum. */
const RECONCILE_TIMEOUT_MS = 5_000;
const DETAILED_STATUS_SOLVER_TIMEOUT_MS = 5_000;

/** Where a position's funds came from and refund to. A chain KEY, since the on-chain field is a SODAX relay id, not an EVM id. */
export type PositionOrigin = {
  chainKey: SpokeChainKey;
  /** An XRPL address must be able to receive the refund: check it first with `sodax.spoke.xrp.checkDestination`. */
  address: string;
  /** Hub asset a cross-chain refund unwraps into; required off-hub (AssetManager never moves vault tokens), ignored on hub. */
  asset?: Address;
};

/**
 * Funds a position from any chain in one source-chain signature: the deposit is relayed and the position opened in
 * the same batch. `token`/`amount` are on `srcChainKey` in its own decimals, not vault shares.
 */
export type PositionFundingParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  /** Funds come from here and a failed intent refunds to here. */
  srcAddress: string;
  token: string;
  /** In `token`'s own decimals. */
  amount: bigint;
  // No `owner` override: the factory requires `cfg.owner == msg.sender` (the funder's hub wallet).
  /** Fixed for the life of the position. Defaults to 0 (none). */
  eModeCategory?: number;
  /** In the collateral reserve's units. */
  minCollateralOut: bigint;
  /**
   * Percentage variant only; defaults to `leverageYield.partnerFee`. Fixed at creation and borrowed on top,
   * so also pass it to {@link projectLeverageLeg} as `feeBps`.
   */
  partnerFee?: PartnerFee;
};

/** Opening from the collateral side: deposit collateral, borrow against it, swap into more collateral. */
export type OpenPositionParams<K extends SpokeChainKey> = PositionFundingParams<K> & {
  borrowToken: Address;
  /** In `borrowToken`'s units (hub reserves are 18-decimal). */
  borrowAmount: bigint;
};

/** Opening from the debt side: the deposit IS the debt token. */
export type OpenPositionFromDebtTokenParams<K extends SpokeChainKey> = PositionFundingParams<K> & {
  collateral: Address;
  /** Total debt token paid to the solver; the hook borrows this minus the deposit's contribution. */
  totalInput: bigint;
};

declare const positionIntentCall: unique symbol;
declare const positionDirectCall: unique symbol;

/** A position call that POSTS a solver intent and must be reported, or it expires unfilled. Type-only brand. */
export type PositionIntentCall = EvmRawTransaction & { readonly [positionIntentCall]: true };

/** A position call that completes on the hub, with nothing to report. */
export type PositionDirectCall = EvmRawTransaction & { readonly [positionDirectCall]: true };

/** Intent calls must be reported; direct calls may ride along (e.g. settle-then-addLeverage). */
export type PositionBatchCall = PositionIntentCall | PositionDirectCall;

// No funds move, so this is a bare message; calls execute as the user's hub wallet (`onlyOwner`).
export type PositionOperationParams<K extends SpokeChainKey, C extends EvmRawTransaction = EvmRawTransaction> = {
  srcChainKey: K;
  /** Its hub wallet is what executes the calls. */
  srcAddress: string;
  /** Run in order as the hub wallet, so a settle-then-act sequence stays atomic. */
  calls: readonly C[];
};

/** Bitcoin TRADING mode funds from the Bound wallet, which the position paths neither derive nor authorize. */
const BITCOIN_UNSUPPORTED_MESSAGE =
  'Bitcoin is not a supported source chain for leverage positions; use a supported spoke or the hub';

const VAULT_BITCOIN_UNSUPPORTED_MESSAGE =
  'Bitcoin is not a supported chain for leverage-yield vault swaps; use a supported spoke or the hub';

/** MPC-relay hub-wallet messages are confirmed only by a release back, and withdraws/operations release nothing. */
const MPC_RELAY_UNSUPPORTED_MESSAGE =
  'MPC-relay source chains are not supported for leverage yield yet; use a supported spoke or the hub';

const ANY_SOLVER_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** Trimmed from `maxWithdraw`: ERC-4626 `withdraw(maxWithdraw)` can round up to `balanceOf + 1` shares and revert. */
const MAX_WITHDRAW_DUST_BUFFER = 1000n;

/** Percent (3.07 = 3.07%) to RAY (1e27 = 100%); scaled by 1e9 in Number, then 1e16 in bigint, to stay precise. */
function pctToRay(aprPct: number): bigint {
  return BigInt(Math.round(aprPct * 1e9)) * 10n ** 16n;
}

const DEFILLAMA_FETCH_TIMEOUT_MS = 10_000;

/** One retry only: best-effort read with a fallback, run inside `getEffectiveApr`'s `Promise.all`. */
const DEFILLAMA_FETCH_MAX_ATTEMPTS = 2;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Latest compounded APY (incl. rewards) for a DefiLlama pool. Throws after retries; callers fall back to
 * the registry's `fallbackAprPct`. New LSDs need only a `lsdSource.poolId` in `leverageYieldVaults`.
 */
async function fetchDefillamaApr(poolId: string): Promise<number> {
  return retry(async () => {
    const response = await fetchWithTimeout(`https://yields.llama.fi/chart/${poolId}`, DEFILLAMA_FETCH_TIMEOUT_MS);
    if (!response.ok) throw new Error(`DefiLlama APR fetch failed: HTTP ${response.status}`);
    const json = (await response.json()) as { data?: ReadonlyArray<{ apy?: unknown }> };
    const series = json?.data;
    if (!Array.isArray(series) || series.length === 0) {
      throw new Error('DefiLlama APR response: empty time series');
    }
    const latest = series[series.length - 1]?.apy;
    if (typeof latest !== 'number') throw new Error('DefiLlama APR: latest entry missing numeric apy');
    return latest;
  }, DEFILLAMA_FETCH_MAX_ATTEMPTS);
}

/** Snapshot from the vault's non-standard `getPositionDetails()`. */
export type LeverageYieldPosition = {
  /** Vault-asset units (18 decimals). */
  collateral: bigint;
  /** Vault-asset units (18 decimals). */
  debt: bigint;
  /** Basis points (`8_500` = 85%). */
  ltv: bigint;
  /** WAD (1e18); `type(uint256).max` = no debt. */
  healthFactor: bigint;
  /** Held by the vault but not yet supplied to the pool, in vault-asset units (18 decimals). */
  idleAsset: bigint;
};

/**
 * Rates in RAY (1e27 = 100%). `netAprRay` is steady-state at `targetLTV`:
 * `supply + targetLTV / (1 - targetLTV) x (supply - borrow)`; negative when the spread inverts.
 */
export type LeverageYieldApr = {
  supplyAprRay: bigint;
  borrowAprRay: bigint;
  /** Basis points, from `vault.targetLTV()`. */
  targetLtvBps: bigint;
  /** Debt / equity x1e18 (truncated); total exposure is `1 + leverageMultiplier`. */
  leverageMultiplierWad: bigint;
  /** Can be negative. */
  netAprRay: bigint;
};

export type LeverageYieldLsdApr = {
  /** RAY (1e27 = 100%). Zero when the vault has no configured LSD source. */
  aprRay: bigint;
  /** Suffixed with `(fallback)` on error. */
  label: string;
  /** True when from the hardcoded `fallbackAprPct` (manual provider, fetch failure or no source); show as estimate. */
  stale: boolean;
};

/** AAVE + LSD view: inherited `netAprRay` is AAVE-only; `effectiveNetAprRay` includes LSD staking yield. */
export type LeverageYieldEffectiveApr = LeverageYieldApr & {
  lsdApr: LeverageYieldLsdApr;
  /** `supplyAprRay + lsdApr.aprRay`, in RAY. */
  effectiveSupplyAprRay: bigint;
  /** `effectiveSupplyAprRay + leverage x (effectiveSupplyAprRay - borrowAprRay)`, in RAY. Headline number. */
  effectiveNetAprRay: bigint;
};

/** Swap any solver token on `srcChainKey` into lsoda* shares in the hub wallet; spread into `swaps.swap()`. */
export type LeverageYieldSwapDepositParams = {
  /** Its address doubles as the lsoda* token. */
  vault: Address;
  srcChainKey: SpokeChainKey;
  srcAddress: string;
  inputToken: string;
  /** Input-token decimals. */
  inputAmount: bigint;
  /** 18 decimals, slippage already applied. */
  minOutputAmount: bigint;
  /** Unix seconds. Defaults to the hub block timestamp + 5 min. */
  deadline?: bigint;
  /** `0x0` = any solver. */
  solver?: Address;
  /** Per-intent fee override; defaults to `config.leverageYieldPartnerFee`. */
  partnerFee?: PartnerFee;
};

/** Swap lsoda* shares from the hub wallet back to any token; carries `hubWalletSwap: true` for `swaps.swap()`. */
export type LeverageYieldSwapWithdrawParams = {
  /** Its address doubles as the lsoda* token. */
  vault: Address;
  /** Chain the `sendMessage` is signed from (drives hub-wallet derivation). */
  srcChainKey: SpokeChainKey;
  srcAddress: string;
  dstChainKey: SpokeChainKey;
  outputToken: string;
  /** lsoda* shares (18 decimals). */
  inputAmount: bigint;
  /** Output-token decimals, slippage already applied. */
  minOutputAmount: bigint;
  /** Defaults to `srcAddress`. */
  recipient?: string;
  /** Unix seconds. Defaults to the hub block timestamp + 5 min. */
  deadline?: bigint;
  /** `0x0` = any solver. */
  solver?: Address;
  /** Defaults to `config.leverageYieldPartnerFee`; deducted from `inputAmount` in lsoda* shares. */
  partnerFee?: PartnerFee;
};

export type LeverageYieldQuoteParams = SolverIntentQuoteRequest & {
  /** Defaults to `config.leverageYieldPartnerFee`; pass the same value as to `vaultSwap` to keep them consistent. */
  partnerFee?: PartnerFee;
};

/** Built by `deposit` / `withdraw`; spread into `vaultSwap` with a wallet provider. */
export type LeverageYieldSwapPayload = {
  params: CreateIntentParams;
  hubWalletSwap?: true;
  /** Override only; when absent the configured leverage-yield fee still applies in both directions. */
  partnerFee?: PartnerFee;
};

/** Smaller than `SwapExtras`: vault swaps have no chain-specific source variants. */
export type LeverageYieldExtras = {
  /** Backend submit-tx API key override (`x-api-key`); no effect on the client-side relay path. */
  apiKey?: string;
};

/**
 * `hubWalletSwap`: `inputToken` is already in the hub wallet, so the intent is authorized via `sendMessage`
 * from `srcChainKey`. `partnerFee` overrides `config.leverageYieldPartnerFee` for this intent only.
 */
export type VaultSwapActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateIntentParams<K>,
  LeverageYieldExtras
> & { hubWalletSwap?: boolean; partnerFee?: PartnerFee };

/** Mirrors swap's `CreateIntentResult`, duplicated so the leverage-yield surface stands alone. */
export type CreateVaultIntentResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;
  intent: Intent & FeeAmount;
  relayData: RelayExtraData;
};

export type VaultSwapWithApprovalParams<K extends SpokeChainKey> = VaultSwapActionParams<K, false> &
  ApprovalOptions & {
    /** The `context.batchId` of an {@link ATOMIC_BATCH_UNCONFIRMED} error to resume instead of resending. */
    resumeBatchId?: string;
    /** That error's `context.callCount`; needed to match a batch confirmed as one tx per call. */
    resumeBatchCallCount?: number;
  };

/** Mirrors swap's `SwapResponse`, duplicated so the leverage-yield surface stands alone. */
export type VaultSwapResponse = {
  solverExecutionResponse: SolverExecutionResponse;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
};

export type VaultSwapWithApprovalResponse = VaultSwapResponse & { approvalStrategy: ApprovalStrategy };

export type LeverageYieldApproveParams<R extends boolean> = {
  vault: Address;
  /** Of the vault's underlying asset. */
  amount: bigint;
  walletProvider: IEvmWalletProvider;
  raw?: R;
};

export type LeverageYieldAllowanceParams = {
  vault: Address;
  amount: bigint;
  owner: Address;
};

export type LeverageYieldServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
  backendApi: BackendApiService;
};

/**
 * Treats lsoda* vault shares as solver-tradeable tokens: deposits and withdrawals are intents run by `vaultSwap`,
 * keeping vault concerns off the generic swap surface. `getEffectiveApr` is LSD-aware; `getApr` is AAVE-only.
 */
export class LeverageYieldService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;
  private readonly backendApi: BackendApiService;

  /** Read live off `ConfigService` so config and behavior can never disagree. Default ON. */
  get useBackendSubmitTx(): boolean {
    return this.config.leverageYieldUseBackendSubmitTx;
  }

  constructor({ hubProvider, config, spoke, backendApi }: LeverageYieldServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
    this.spoke = spoke;
    this.backendApi = backendApi;
  }

  public listVaults(): readonly LeverageYieldVault[] {
    return this.config.sodaxConfig.leverageYield.vaults;
  }

  /** Returns `undefined` when not registered. */
  public getVault(name: string): LeverageYieldVault | undefined {
    return this.listVaults().find(v => v.name === name);
  }

  /** Case-insensitive; `undefined` when not registered. */
  public getVaultByAddress(address: Address): LeverageYieldVault | undefined {
    const normalized = address.toLowerCase();
    return this.listVaults().find(v => v.vault.toLowerCase() === normalized);
  }

  /** Caller's deadline verbatim, else hub block timestamp + buffer (enforced on-chain against hub block time). */
  private async resolveDeadline(
    deadline: bigint | undefined,
    srcChainKey: SpokeChainKey,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    if (deadline !== undefined) return { ok: true, value: deadline };
    try {
      const block = await this.hubProvider.publicClient.getBlock({
        includeTransactions: false,
        blockTag: 'latest',
      });
      return { ok: true, value: block.timestamp + BigInt(INTENT_DEADLINE_BUFFER_SECONDS) };
    } catch (error) {
      return { ok: false, error: lookupFailed('leverageYield', 'resolveDeadline', error, { srcChainKey }) };
    }
  }

  /**
   * Quotes net of the effective LEVERAGE-YIELD fee, matching `createVaultIntent`; `sodax.swaps.getQuote` uses the
   * swap fee instead. Vault as `token_dst` quotes a deposit, as `token_src` a withdraw (both directions charged).
   */
  public async getQuote(
    payload: LeverageYieldQuoteParams,
  ): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>> {
    const { partnerFee = this.config.leverageYieldPartnerFee, ...request } = payload;
    // Not `srcChainKey`/`dstChainKey`: on a withdraw quote `token_src_blockchain_id` is the hub, not the signer's chain.
    const baseCtx = {
      method: 'getQuote',
      tokenSrcChainKey: request.token_src_blockchain_id,
      tokenDstChainKey: request.token_dst_blockchain_id,
    };
    try {
      leverageYieldInvariant(request.amount > 0n, 'amount must be greater than 0', {
        ...baseCtx,
        field: 'amount',
      });
      // Assert fee/net-amount problems as VALIDATION_FAILED rather than letting them surface as LOOKUP_FAILED.
      if (isPartnerFeeAmount(partnerFee)) {
        leverageYieldInvariant(
          partnerFee.amount < request.amount,
          `partnerFee amount (${partnerFee.amount}) must be less than the quote amount (${request.amount})`,
          { ...baseCtx, field: 'partnerFee' },
        );
      } else if (isPartnerFeePercentage(partnerFee)) {
        // `calculatePercentageFeeAmount` does `BigInt(percentage)`, which throws on fractions like 0.5.
        leverageYieldInvariant(
          Number.isInteger(partnerFee.percentage) &&
            partnerFee.percentage >= 0 &&
            partnerFee.percentage <= Number(FEE_PERCENTAGE_SCALE),
          `partnerFee percentage must be a whole number of basis points between 0 and ${FEE_PERCENTAGE_SCALE} (got ${partnerFee.percentage})`,
          { ...baseCtx, field: 'partnerFee' },
        );
      }
      const netAmount = adjustAmountByFee(request.amount, partnerFee, request.quote_type);
      leverageYieldInvariant(netAmount > 0n, 'amount net of the partner fee must be greater than 0', {
        ...baseCtx,
        field: 'partnerFee',
      });
      const adjustedPayload = { ...request, amount: netAmount } satisfies SolverIntentQuoteRequest;
      // `await`, not bare `return`: getQuote rejects on its preconditions, which must settle inside this try.
      return await SolverApiService.getQuote(adjustedPayload, this.config.solver, this.config);
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getQuote', error, baseCtx) };
    }
  }

  /** Payload for a deposit (any token -> lsoda*), delivered to the user's hub wallet so `withdraw` can spend it. */
  public async deposit(
    params: LeverageYieldSwapDepositParams,
  ): Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'deposit' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), VAULT_BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(params.inputAmount > 0n, 'inputAmount must be greater than 0', {
        ...baseCtx,
        field: 'inputAmount',
      });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.inputToken.length > 0, 'inputToken is required', {
        ...baseCtx,
        field: 'inputToken',
      });

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const deadlineResult = await this.resolveDeadline(params.deadline, params.srcChainKey);
      if (!deadlineResult.ok) return deadlineResult;
      const deadline = deadlineResult.value;

      return {
        ok: true,
        value: {
          params: {
            inputToken: params.inputToken,
            outputToken: params.vault,
            inputAmount: params.inputAmount,
            minOutputAmount: params.minOutputAmount,
            deadline,
            allowPartialFill: false,
            srcChainKey: params.srcChainKey,
            dstChainKey: this.hubProvider.chainConfig.chain.key,
            srcAddress: params.srcAddress,
            dstAddress: hubWallet,
            solver: params.solver ?? ANY_SOLVER_ADDRESS,
            data: '0x',
          },
          // Only included when supplied, so the payload has no undefined-valued keys.
          ...(params.partnerFee !== undefined && { partnerFee: params.partnerFee }),
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Payload for a withdraw (lsoda* -> any token) with `hubWalletSwap: true`. Charged too: the fee comes out of
   * `inputAmount`, so the receiver accrues lsoda* shares rather than the output token.
   */
  public async withdraw(
    params: LeverageYieldSwapWithdrawParams,
  ): Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'withdraw' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), VAULT_BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(!isBitcoinChainKeyType(params.dstChainKey), VAULT_BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        dstChainKey: params.dstChainKey,
        field: 'dstChainKey',
      });
      leverageYieldInvariant(params.inputAmount > 0n, 'inputAmount must be greater than 0', {
        ...baseCtx,
        field: 'inputAmount',
      });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.outputToken.length > 0, 'outputToken is required', {
        ...baseCtx,
        field: 'outputToken',
      });

      const deadlineResult = await this.resolveDeadline(params.deadline, params.srcChainKey);
      if (!deadlineResult.ok) return deadlineResult;
      const deadline = deadlineResult.value;

      return {
        ok: true,
        value: {
          params: {
            inputToken: params.vault,
            outputToken: params.outputToken,
            inputAmount: params.inputAmount,
            minOutputAmount: params.minOutputAmount,
            deadline,
            allowPartialFill: false,
            srcChainKey: params.srcChainKey,
            dstChainKey: params.dstChainKey,
            srcAddress: params.srcAddress,
            dstAddress: params.recipient ?? params.srcAddress,
            solver: params.solver ?? ANY_SOLVER_ADDRESS,
            data: '0x',
          },
          hubWalletSwap: true,
          ...(params.partnerFee !== undefined && { partnerFee: params.partnerFee }),
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Creates the intent on the source chain without notifying the solver. For a manual flow, relay `relayData`
   * then call {@link LeverageYieldService.notifySolver} with the hub-side intent tx hash.
   */
  public async createVaultIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: VaultSwapActionParams<K, Raw>,
  ): Promise<Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>> {
    // `swaps.partnerFee` deliberately does NOT apply to vault intents.
    const { params, skipSimulation, hubWalletSwap, partnerFee = this.config.leverageYieldPartnerFee } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };

    try {
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), VAULT_BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(
        !isMpcRelayChainKey(params.dstChainKey) || params.allowPartialFill !== true,
        'allowPartialFill is not supported for a vault swap to an MPC-relay chain',
        { ...baseCtx, field: 'allowPartialFill' },
      );
      leverageYieldInvariant(!isBitcoinChainKeyType(params.dstChainKey), VAULT_BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'dstChainKey',
      });
      leverageYieldInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        baseCtx,
      );
      // Hub-wallet swap (withdraw): `inputToken` lives on the hub, not on the signing chain.
      const hubChainKey = this.hubProvider.chainConfig.chain.key;
      const inputTokenChainKey = hubWalletSwap ? hubChainKey : params.srcChainKey;
      leverageYieldInvariant(
        this.config.isValidOriginalAssetAddress(inputTokenChainKey, params.inputToken),
        `Unsupported spoke chain token (srcChainKey: ${inputTokenChainKey}, inputToken: ${params.inputToken})`,
        { ...baseCtx, field: 'inputToken' },
      );
      leverageYieldInvariant(
        this.config.isValidOriginalAssetAddress(params.dstChainKey, params.outputToken),
        `Unsupported spoke chain token (params.dstChain: ${params.dstChainKey}, params.outputToken: ${params.outputToken})`,
        { ...baseCtx, field: 'outputToken' },
      );
      leverageYieldInvariant(
        this.config.isValidSpokeChainKey(params.srcChainKey),
        `Invalid spoke chain (srcChainKey): ${params.srcChainKey}`,
        { ...baseCtx, field: 'srcChainKey' },
      );
      leverageYieldInvariant(
        this.config.isValidSpokeChainKey(params.dstChainKey),
        `Invalid spoke chain (params.dstChain): ${params.dstChainKey}`,
        { ...baseCtx, field: 'dstChainKey' },
      );
      const outputTokenInfo = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.outputToken);
      if (outputTokenInfo) {
        assertMpcPayoutAboveMinimum({
          feature: 'leverageYield',
          token: outputTokenInfo,
          amount: params.minOutputAmount,
          context: { ...baseCtx, field: 'minOutputAmount' },
        });
        if (
          isXrpChainKeyType(params.dstChainKey) &&
          outputTokenInfo.address !== this.config.getChainConfig(params.dstChainKey).nativeToken
        ) {
          const quote = await this.getQuote({
            token_src: params.inputToken,
            token_src_blockchain_id: inputTokenChainKey,
            token_dst: params.outputToken,
            token_dst_blockchain_id: params.dstChainKey,
            amount: params.inputAmount,
            quote_type: 'exact_input',
            partnerFee,
          });
          leverageYieldInvariant(
            quote.ok && quote.value.quoted_amount > 0n,
            'A current exact-input quote is required for an XRPL issued-token destination',
            { ...baseCtx, field: 'minOutputAmount' },
          );
          leverageYieldInvariant(
            params.minOutputAmount * SOLVED_PAYOUT_HEADROOM_FACTOR >= quote.value.quoted_amount,
            'minOutputAmount must be at least half the current quote for an XRPL issued-token destination',
            { ...baseCtx, field: 'minOutputAmount' },
          );
        }
        await this.spoke.assertReleaseRecipientReady({
          feature: 'leverageYield',
          chainKey: params.dstChainKey,
          recipient: encodeRecipient(params.dstChainKey, params.dstAddress),
          token: outputTokenInfo.address,
          amount: params.minOutputAmount,
          maxAmount: params.minOutputAmount * SOLVED_PAYOUT_HEADROOM_FACTOR,
          context: { ...baseCtx, field: 'dstAddress' },
        });
      }
      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(
        params.srcAddress,
        params.srcChainKey,
      );

      // Withdraw: the user signs a `sendMessage` authorizing the hub wallet to run [approve, createIntent] itself.
      if (hubWalletSwap) {
        const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
          { ...params, srcChainKey: hubChainKey, srcAddress: creatorHubWalletAddress },
          creatorHubWalletAddress,
          this.config,
          partnerFee,
        );

        const coreSendMessageParams = {
          srcChainKey: params.srcChainKey,
          srcAddress: params.srcAddress as GetAddressType<K>,
          dstChainKey: hubChainKey,
          dstAddress: creatorHubWalletAddress,
          payload: data,
          skipSimulation,
        } as const;

        const txResult = await this.spoke.sendMessage(
          _params.raw
            ? { ...coreSendMessageParams, raw: true }
            : {
                ...coreSendMessageParams,
                raw: false,
                walletProvider: _params.walletProvider as GetWalletProviderType<K>,
              },
        );

        if (!txResult.ok) {
          if (isLeverageYieldCreateIntentError(txResult.error)) {
            return { ok: false, error: txResult.error };
          }
          return { ok: false, error: intentCreationFailed('leverageYield', txResult.error, baseCtx) };
        }

        return {
          ok: true,
          value: {
            tx: txResult.value satisfies SendMessageReturnType<K, Raw> as TxReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: creatorHubWalletAddress, payload: data },
          },
        };
      }

      if (isHubChainKeyType(params.srcChainKey) && isSonicChainKeyType(params.srcChainKey)) {
        const coreSonicParams = {
          createIntentParams: params,
          creatorHubWalletAddress,
          solverConfig: this.config.solver,
          fee: partnerFee,
          hubProvider: this.hubProvider,
        } as const;

        const [txResult, intent, feeAmount, data] = await SonicSpokeService.createSwapIntent(
          _params.raw
            ? { ...coreSonicParams, raw: true }
            : {
                ...coreSonicParams,
                raw: false,
                walletProvider: _params.walletProvider as GetWalletProviderType<SonicChainKey>,
              },
        );

        return {
          ok: true,
          value: {
            tx: txResult satisfies TxReturnType<SonicChainKey, boolean> as TxReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: intent.creator, payload: data },
          },
        };
      }

      const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
        params,
        creatorHubWalletAddress,
        this.config,
        partnerFee,
      );

      const coreDepositParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        to: creatorHubWalletAddress,
        token: params.inputToken as GetTokenAddressType<K>,
        amount: params.inputAmount,
        data: data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreDepositParams,
              raw: true,
            }
          : {
              ...coreDepositParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        if (isLeverageYieldCreateIntentError(txResult.error)) {
          return { ok: false, error: txResult.error };
        }
        return {
          ok: false,
          error: intentCreationFailed('leverageYield', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies DepositReturnType<K, Raw> as TxReturnType<K, Raw>,
          intent: { ...intent, feeAmount } as Intent & FeeAmount,
          relayData: { address: intent.creator, payload: data },
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('leverageYield', error, baseCtx),
      };
    }
  }

  /**
   * End-to-end vault swap: create intent, verify, relay to the hub (skipped from the hub), notify the solver.
   * An MPC-relay payout is released after the fill; `sodax.swaps.waitForIntentDelivery` waits for it.
   */
  public async vaultSwap<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
  ): Promise<Result<VaultSwapResponse, LeverageYieldSwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'vaultSwap' satisfies LeverageYieldAction };
    return this.config.analytics.trackResult(
      'leverageYield',
      'vaultSwap',
      async () => {
        try {
          const createIntentResult = await this.createVaultIntent(_params);
          if (!createIntentResult.ok) {
            return { ok: false, error: createIntentResult.error };
          }

          return await this.completeVaultSwap(_params, createIntentResult.value);
        } catch (error) {
          if (isLeverageYieldSwapError(error)) return { ok: false, error };
          return {
            ok: false,
            error: unknownFailed('leverageYield', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          dstChainKey: _params.params.dstChainKey,
          srcAddress: _params.params.srcAddress,
          dstAddress: _params.params.dstAddress,
          inputToken: _params.params.inputToken,
          outputToken: _params.params.outputToken,
          inputAmount: _params.params.inputAmount,
        }),
        success: value => ({
          intentId: value.intent.intentId,
          srcTxHash: value.intentDeliveryInfo.srcTxHash,
          dstTxHash: value.intentDeliveryInfo.dstTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Which approval path {@link vaultSwapWithApproval} would take; read-only. A withdraw (`hubWalletSwap`) is
   * always `'not-required'`; `'atomic-batch'` needs an EVM spoke source and an EIP-5792 wallet.
   */
  public async getApprovalStrategy<K extends SpokeChainKey>(
    _params: VaultSwapWithApprovalParams<K>,
  ): Promise<Result<ApprovalStrategy, ApprovalStrategyError>> {
    const { params, walletProvider, hubWalletSwap, allowAccountUpgrade = true } = _params;
    if (hubWalletSwap) return { ok: true, value: 'not-required' };

    const allowance = await this.isDepositAllowanceValid(params);
    if (!allowance.ok) {
      return {
        ok: false,
        error: allowanceCheckFailed('leverageYield', allowance.error, {
          srcChainKey: params.srcChainKey,
          dstChainKey: params.dstChainKey,
          action: 'vaultSwapWithApproval' satisfies LeverageYieldAction,
        }),
      };
    }
    if (allowance.value) return { ok: true, value: 'not-required' };
    return {
      ok: true,
      value: await resolveApprovalStrategy({ srcChainKey: params.srcChainKey, walletProvider, allowAccountUpgrade }),
    };
  }

  /**
   * {@link vaultSwap} with the deposit's approval folded in (one atomic batch on EIP-5792 wallets). A batch the user
   * saw is never resent; on {@link ATOMIC_BATCH_UNCONFIRMED} call again with `resumeBatchId` / `resumeBatchCallCount`.
   */
  public async vaultSwapWithApproval<K extends SpokeChainKey>(
    _params: VaultSwapWithApprovalParams<K>,
  ): Promise<Result<VaultSwapWithApprovalResponse, VaultSwapWithApprovalError>> {
    const { params } = _params;
    const baseCtx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'vaultSwapWithApproval' satisfies LeverageYieldAction,
    };
    return this.config.analytics.trackResult(
      'leverageYield',
      'vaultSwapWithApproval',
      async () => {
        try {
          if (_params.resumeBatchId !== undefined) return await this.resumeAtomicBatch(_params, _params.resumeBatchId);

          const strategy = await this.getApprovalStrategy(_params);
          if (!strategy.ok) return strategy;

          const { result: created, approvalStrategy } = await runWithApproval<
            CreateVaultIntentResult<K, false>,
            VaultSwapWithApprovalError
          >({
            strategy: strategy.value,
            notRequired: () => this.createVaultIntent(_params),
            atomicBatch: () => this.createVaultIntentInAtomicBatch(_params),
            sequential: afterRefusedBatch => this.approveThenCreateVaultIntent(_params, afterRefusedBatch),
            onBatchRefused: error =>
              this.config.logger.warn('[vaultSwapWithApproval] wallet refused the atomic batch; approving separately', {
                error,
              }),
          });
          if (!created.ok) return created;
          const completed = await this.completeVaultSwap(_params, created.value);
          if (!completed.ok) return completed;
          return { ok: true, value: { ...completed.value, approvalStrategy } };
        } catch (error) {
          if (isVaultSwapWithApprovalError(error)) return { ok: false, error };
          return { ok: false, error: unknownFailed('leverageYield', error, baseCtx) };
        }
      },
      {
        start: () => ({
          srcChainKey: params.srcChainKey,
          dstChainKey: params.dstChainKey,
          srcAddress: params.srcAddress,
          dstAddress: params.dstAddress,
          inputToken: params.inputToken,
          outputToken: params.outputToken,
          inputAmount: params.inputAmount,
        }),
        success: value => ({
          intentId: value.intent.intentId,
          srcTxHash: value.intentDeliveryInfo.srcTxHash,
          dstTxHash: value.intentDeliveryInfo.dstTxHash,
          approvalStrategy: value.approvalStrategy,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Approve + deposit as one EIP-5792 batch (`[reset?, approve, deposit]`); the batch tx hash is the intent tx. */
  private async createVaultIntentInAtomicBatch<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
  ): Promise<Result<CreateVaultIntentResult<K, false>, VaultSwapWithApprovalError>> {
    const { params, walletProvider, extras, skipSimulation, partnerFee } = _params;
    const srcChainKey = params.srcChainKey;
    leverageYieldInvariant(
      isEvmSpokeOnlyChainKeyType(srcChainKey) && isEvmWalletProviderType(walletProvider),
      'Atomic batches need an EVM spoke source and an EVM wallet provider',
    );
    const ctx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'vaultSwapWithApproval' satisfies LeverageYieldAction,
      approvalStrategy: 'atomic-batch',
    };

    const [approval, created] = await Promise.all([
      this.buildDepositApproveTxs(params, srcChainKey),
      this.createVaultIntent<K, true>({ params, extras, skipSimulation, partnerFee, raw: true }),
    ]);
    if (!approval.ok) return { ok: false, error: approveFailed('leverageYield', approval.error, ctx) };
    if (!created.ok) return { ok: false, error: withErrorContext(created.error, ctx) };

    const { resetTx, approveTx } = approval.value;
    const depositTx = created.value.tx as EvmRawTransaction;
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs: resetTx ? [resetTx, approveTx, depositTx] : [approveTx, depositTx],
      timeoutMs: approvalBatchWaitMs(_params.timeout),
      feature: 'leverageYield',
      context: ctx,
    });
    if (!sent.ok) return sent;
    return {
      ok: true,
      value: {
        tx: sent.value.txHash satisfies TxReturnType<EvmSpokeOnlyChainKey, false> as TxReturnType<K, false>,
        intent: created.value.intent,
        relayData: created.value.relayData,
      },
    };
  }

  /** Resumes an {@link ATOMIC_BATCH_UNCONFIRMED} batch without resending; the intent is read back from the hub tx. */
  private async resumeAtomicBatch<K extends SpokeChainKey>(
    _params: VaultSwapWithApprovalParams<K>,
    batchId: string,
  ): Promise<Result<VaultSwapWithApprovalResponse, VaultSwapWithApprovalError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    leverageYieldInvariant(
      isEvmSpokeOnlyChainKeyType(srcChainKey) &&
        isEvmWalletProviderType(walletProvider) &&
        canSendAtomicBatch(walletProvider),
      'Resuming an atomic batch needs an EVM spoke source and an EIP-5792 wallet provider',
    );
    const ctx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'vaultSwapWithApproval' satisfies LeverageYieldAction,
      approvalStrategy: 'atomic-batch',
    };
    const timeoutMs = approvalBatchWaitMs(_params.timeout);

    const deposit = await confirmApprovalBatch({
      walletProvider,
      batchId,
      callCount: _params.resumeBatchCallCount,
      timeoutMs,
      feature: 'leverageYield',
      context: ctx,
    });
    if (!deposit.ok) return deposit;
    const srcTxHash = deposit.value.txHash;
    const txCtx = { ...ctx, srcTxHash };

    // An EVM spoke tx is relayed by its hash alone, so the lost `relayData` is not needed.
    const packet = await relayTxAndWaitPacket({
      srcTxHash,
      chainKey: srcChainKey,
      relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
    });
    if (!packet.ok) return { ok: false, error: mapRelayFailure(packet.error, { feature: 'leverageYield', ...txCtx }) };
    const dstTxHash = packet.value.dst_tx_hash as Hash;

    let intent: Intent;
    try {
      intent = await EvmSolverService.getIntent(dstTxHash, this.config, this.hubProvider.publicClient);
    } catch (error) {
      return { ok: false, error: unknownFailed('leverageYield', error, { ...txCtx, dstTxHash }) };
    }
    const solved = await this.notifySolver({ intent_tx_hash: dstTxHash });
    // The hub tx is what a retried `notifySolver` needs.
    if (!solved.ok) return { ok: false, error: withErrorContext(solved.error, { srcChainKey, srcTxHash, dstTxHash }) };

    return {
      ok: true,
      value: {
        solverExecutionResponse: solved.value,
        intent,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash,
          srcAddress: params.srcAddress,
          dstChainKey: params.dstChainKey,
          dstTxHash,
          dstAddress: params.dstAddress,
        } satisfies IntentDeliveryInfo,
        approvalStrategy: 'atomic-batch',
      },
    };
  }

  private async approveThenCreateVaultIntent<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
    validated = false,
  ): Promise<Result<CreateVaultIntentResult<K, false>, VaultSwapWithApprovalError>> {
    const { params, extras, skipSimulation, partnerFee } = _params;
    const ctx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'vaultSwapWithApproval' satisfies LeverageYieldAction,
      approvalStrategy: 'sequential',
    };

    // Build the deposit unsigned first, so params that can never deposit fail before the user pays for an approval.
    if (!validated) {
      const preflight = await this.createVaultIntent<K, true>({
        params,
        extras,
        skipSimulation,
        partnerFee,
        raw: true,
      });
      if (!preflight.ok) return { ok: false, error: withErrorContext(preflight.error, ctx) };
    }

    const approved = await this.approveDeposit(_params);
    if (!approved.ok) {
      return {
        ok: false,
        error: isLeverageYieldApproveError(approved.error)
          ? withErrorContext(approved.error, ctx)
          : approveFailed('leverageYield', approved.error, ctx),
      };
    }

    const confirmed = await confirmApproval({
      waitForTxReceipt: receiptParams => this.spoke.waitForTxReceipt(receiptParams),
      txHash: approved.value,
      chainKey: params.srcChainKey,
      feature: 'leverageYield',
      context: ctx,
    });
    if (!confirmed.ok) return confirmed;

    return this.createVaultIntent(_params);
  }

  private async isDepositAllowanceValid<K extends SpokeChainKey>(
    params: CreateIntentParams<K>,
  ): Promise<Result<boolean>> {
    try {
      const { srcChainKey } = params;
      if (isHubChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: intentDepositSpender(this.config, srcChainKey),
        } satisfies SpokeIsAllowanceValidParamsHub);
      }
      if (isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: intentDepositSpender(this.config, srcChainKey),
        } satisfies SpokeIsAllowanceValidParamsEvmSpoke);
      }
      if (isStellarChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);
      }
      return { ok: true, value: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  private async buildDepositApproveTxs(
    params: CreateIntentParams,
    srcChainKey: EvmSpokeOnlyChainKey,
  ): Promise<Result<ApprovalTxs<EvmSpokeOnlyChainKey>>> {
    try {
      return await this.spoke.buildApproveTxs<EvmSpokeOnlyChainKey>({
        srcChainKey,
        owner: params.srcAddress as GetAddressType<EvmSpokeOnlyChainKey>,
        token: params.inputToken as GetTokenAddressType<EvmSpokeOnlyChainKey>,
        amount: params.inputAmount,
        spender: intentDepositSpender(this.config, srcChainKey),
        raw: true,
      });
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Resolves at broadcast. */
  private async approveDeposit<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
  ): Promise<Result<TxReturnType<K, false>>> {
    const { params, walletProvider } = _params;
    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        leverageYieldInvariant(
          isOptionalEvmWalletProviderType(walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
        );
        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, false>({
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.inputAmount,
          spender: intentDepositSpender(this.config, params.srcChainKey),
          raw: false,
          walletProvider,
        });
        if (!result.ok) return result;
        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, false> as TxReturnType<K, false>,
        };
      }
      if (isStellarChainKeyType(params.srcChainKey)) {
        leverageYieldInvariant(
          isOptionalStellarWalletProviderType(walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
        );
        const result = await this.spoke.approve<StellarChainKey, false>({
          srcChainKey: params.srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
          raw: false,
          walletProvider,
        });
        if (!result.ok) return result;
        return {
          ok: true,
          value: result.value satisfies TxReturnType<StellarChainKey, false> as TxReturnType<K, false>,
        };
      }
      leverageYieldInvariant(false, 'Approve only supported for hub (Sonic), EVM spokes, and Stellar', {
        srcChainKey: params.srcChainKey,
        field: 'srcChainKey',
      });
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Backend submit-tx when enabled, falling back to {@link fallbackVaultSwapSteps} on any non-success. */
  private async completeVaultSwap<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
    created: CreateVaultIntentResult<K, false>,
  ): Promise<Result<VaultSwapResponse, LeverageYieldSwapError>> {
    // PER-ATTEMPT budget: the fallback gets a fresh one, else a slow backend leaves it too little (RELAY_TIMEOUT).
    const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

    // Fallback is safe because re-relay / re-post are idempotent; a keyless caller against a key-enforcing
    // deployment spends one rejected attempt here (opt out with `leverageYield.useBackendSubmitTx: false`).
    if (this.useBackendSubmitTx) {
      const submitted = await this.submitTx(_params, created, createSubmitTxAttempt(timeoutMs));
      if (submitted.ok) return submitted;
      this.config.logger.warn(
        '[leverageYield] backend submit-tx did not complete; falling back to the client-side relay',
        { error: submitted.error },
      );
    }

    return this.fallbackVaultSwapSteps(_params, created, timeoutMs);
  }

  /** Client-side completion: verify, relay to the hub (unless the source is the hub), notify the solver. */
  private async fallbackVaultSwapSteps<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
    created: CreateVaultIntentResult<K, false>,
    timeoutMs: number,
  ): Promise<Result<VaultSwapResponse, LeverageYieldSwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const { tx: spokeTxHash, intent, relayData } = created;
    // Every failure from here on is post-broadcast: carry the tx so the caller can keep reading its status.
    const txCtx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'vaultSwap' satisfies LeverageYieldAction,
      srcTxHash: spokeTxHash,
    };

    const verifyTxHashResult = await this.spoke.verifyTxHash({
      txHash: spokeTxHash,
      chainKey: srcChainKey,
    });
    if (!verifyTxHashResult.ok) {
      return { ok: false, error: verifyFailed('leverageYield', verifyTxHashResult.error, txCtx) };
    }

    let dstIntentTxHash: string;
    if (isHubChainKeyType(srcChainKey)) {
      dstIntentTxHash = spokeTxHash;
    } else {
      const packet = await relayTxAndWaitPacket({
        srcTxHash: spokeTxHash,
        data: relayData,
        chainKey: srcChainKey,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        // Floor: `relayTxAndWaitPacket` submits before `timeout` bounds anything, so a zero budget strands the tx.
        timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
      });
      if (!packet.ok) {
        return { ok: false, error: mapRelayFailure(packet.error, { feature: 'leverageYield', ...txCtx }) };
      }
      dstIntentTxHash = packet.value.dst_tx_hash;
    }

    const postExecResult = await this.notifySolver({
      intent_tx_hash: dstIntentTxHash as `0x${string}`,
    });
    if (!postExecResult.ok) {
      // The hub tx is what a retried `notifySolver` needs; status reads cannot surface it while unnotified.
      return {
        ok: false,
        error: withErrorContext(postExecResult.error, {
          srcChainKey,
          srcTxHash: spokeTxHash,
          dstTxHash: dstIntentTxHash,
        }),
      };
    }

    return {
      ok: true,
      value: {
        solverExecutionResponse: postExecResult.value,
        intent,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash: spokeTxHash,
          srcAddress: params.srcAddress,
          dstChainKey: params.dstChainKey,
          dstTxHash: dstIntentTxHash,
          dstAddress: params.dstAddress,
        } satisfies IntentDeliveryInfo,
      },
    };
  }

  /**
   * Backend submit-tx path; never throws, returning `{ ok: false }` so the caller falls back client-side. The
   * fallback can race the backend (which keeps going), which is safe since re-relay/re-post are idempotent.
   */
  private async submitTx<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
    created: CreateVaultIntentResult<K, false>,
    attempt: SubmitTxAttempt,
  ): Promise<Result<VaultSwapResponse, LeverageYieldSwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'vaultSwap' satisfies LeverageYieldAction };
    const { tx: spokeTxHash, intent, relayData } = created;

    try {
      const outcome = await runBackendSubmitTx({
        attempt,
        api: this.backendApi.leverageYield,
        body: {
          txHash: spokeTxHash,
          srcChainKey,
          walletAddress: params.srcAddress,
          intent,
          relayData: relayData.payload,
          operation: _params.hubWalletSwap ? 'withdraw' : 'deposit',
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        // Per-action key wins for both the submit POST and its status polls; undefined keeps the configured key.
        overrideConfig: { apiKey: _params.extras?.apiKey },
        // A vault deposit/withdraw IS a solver swap, so terminal success is `solved`, not bridge's `executed`.
        terminalStatus: 'solved',
        onExecuted: (result): VaultSwapResponse | undefined =>
          result?.dstIntentTxHash && result.intent_hash
            ? {
                // Backend serializes the hex intent_hash as a plain string; brand it at the boundary.
                solverExecutionResponse: { answer: 'OK', intent_hash: result.intent_hash as Hex },
                intent,
                intentDeliveryInfo: {
                  srcChainKey,
                  srcTxHash: spokeTxHash,
                  srcAddress: params.srcAddress,
                  dstChainKey: params.dstChainKey,
                  dstTxHash: result.dstIntentTxHash,
                  dstAddress: params.dstAddress,
                } satisfies IntentDeliveryInfo,
              }
            : undefined,
      });
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('leverageYield', outcome.cause, baseCtx) };
    } catch (error) {
      return { ok: false, error: unknownFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Required for any intent: the solver ignores an unnotified hub intent until it expires. `intent_tx_hash` is
   * the hub tx (relay packet's `dst_tx_hash`, or the source tx for hub-sourced intents).
   */
  public async notifySolver(
    request: SolverExecutionRequest,
  ): Promise<Result<SolverExecutionResponse, LeverageYieldPostExecutionError>> {
    try {
      const result = await SolverApiService.postExecution(
        request,
        this.config.solver,
        this.config.logger,
        this.config.apiKey,
      );
      if (result.ok) return result;

      // Defensive: a malformed upstream payload would otherwise throw a cryptic TypeError below.
      const detail = result.error?.detail ?? {
        code: -999, // SolverIntentErrorCode.UNKNOWN
        message: 'Solver returned malformed error response',
      };
      return {
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', detail.message, {
          feature: 'leverageYield',
          context: {
            phase: 'postExecution',
            api: 'solver',
            solverCode: detail.code,
            solverDetail: detail,
          },
        }),
      };
    } catch (error) {
      if (isLeverageYieldPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, { phase: 'postExecution' }) };
    }
  }

  /**
   * Solver status verbatim (`intent_tx_hash` = hub tx), deliberately NOT reconciled against the backend record;
   * NOT_FOUND often means the notification never landed. Prefer `getDetailedStatus` when you hold the source tx.
   */
  public async getIntentStatus(
    request: SolverIntentStatusRequest,
  ): Promise<Result<SolverIntentStatusResponse, LeverageYieldPostExecutionError>> {
    try {
      const result = await this.solverStatus(request);
      if (result.ok) return result;

      const detail = result.error?.detail ?? {
        code: SolverIntentErrorCode.UNKNOWN,
        message: 'Solver returned malformed error response',
      };
      return {
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', detail.message, {
          feature: 'leverageYield',
          context: {
            phase: 'lookup',
            api: 'solver',
            solverCode: detail.code,
            solverDetail: detail,
          },
        }),
      };
    } catch (error) {
      if (isLeverageYieldPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, { phase: 'lookup' }) };
    }
  }

  /** The api key is the 5th argument; omitting it let a keyed partner notify and then fail to poll. */
  private async solverStatus(
    request: SolverIntentStatusRequest,
    timeoutMs?: number,
    apiKey?: string,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    // Empty string counts as unset, matching how `overrideConfig.apiKey` resolves on the backend legs.
    return SolverApiService.getStatus(
      request,
      this.config.solver,
      this.config.logger,
      timeoutMs,
      apiKey || this.config.apiKey,
    );
  }

  /**
   * {@link solverStatus} plus the durable-record reconcile: every non-final answer is reconciled and a journal
   * cancel reads `FAILED`. `timeoutMs` bounds the solver request alone; the reconcile has its own budget.
   */
  private async resolveSolverStatus(
    request: SolverIntentStatusRequest,
    timeoutMs?: number,
    apiKey?: string,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    const solverResult = await this.solverStatus(request, timeoutMs, apiKey);
    const status = solverResult.ok ? solverResult.value.status : undefined;
    if (status === SolverIntentStatusCode.SOLVED || status === SolverIntentStatusCode.FAILED) return solverResult;
    const forgotten = !solverResult.ok || status === SolverIntentStatusCode.NOT_FOUND;

    // A restarted solver answers NOT_FOUND for filled intents; the backend journal is durable and covers vault
    // intents. Clamped, since a per-call timeout replaces (and could lengthen) the configured one.
    const timeout = Math.min(RECONCILE_TIMEOUT_MS, this.backendApi.requestTimeoutMs);
    // Keys this leg too; no `|| this.config.apiKey` since `BackendApiService` already falls back to its own key.
    const intent = await this.backendApi.getIntentByTxHash(request.intent_tx_hash, { timeout, apiKey });
    const outcome = intent.ok ? readIntentJournalOutcome(intent.value) : undefined;
    if (outcome?.kind === 'solved') {
      return { ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: outcome.fillTxHash } };
    }
    if (outcome?.kind === 'cancelled') return { ok: true, value: { status: SolverIntentStatusCode.FAILED } };
    // Without terminal evidence an in-flight answer stands, even behind an unreadable record.
    if (!forgotten) return solverResult;

    // A record or a 404 answers the question; a 5xx/transport failure doesn't, so don't report an unverified NOT_FOUND.
    const backendAnswered = intent.ok || (isSodaxError(intent.error) && intent.error.context?.status === 404);
    if (solverResult.ok && !backendAnswered) {
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: 'solver reported NOT_FOUND and the durable intent record could not be read to verify it',
          },
        },
      };
    }

    return solverResult;
  }

  /**
   * Routes a vault swap's status by source tx: the backend submit-tx record while usable, else the reconciled
   * solver answer via the relayed hub tx. A rejected API key is surfaced, not routed. `config.apiKey` keys every leg.
   */
  public async getDetailedStatus(
    params: DetailedLeverageYieldStatusKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<DetailedLeverageYieldStatus, LeverageYieldDetailedStatusError>> {
    try {
      const record = await this.backendApi.leverageYield.getSubmitTxStatus(
        { txHash: params.srcTxHash, srcChainKey: params.srcChainKey },
        config,
      );

      // `success: false` is the wire contract's "no record found"; `ok` only proves the request succeeded.
      if (record.ok && record.value.success && !isBackendSubmitTxAbandoned(record.value.data)) {
        return { ok: true, value: { source: 'backend', data: record.value.data } };
      }

      // Lift its status so `isAuthFailure` recognises the wrapped error.
      if (!record.ok && isSodaxError(record.error) && isAuthFailure(record.error)) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(record.error, params.srcChainKey, {
            status: record.error.context?.status,
          }),
        };
      }

      // A record or 404 is definitive; behind a 5xx/transport failure a relay miss must stay an unbudgeted failure.
      const backendAnswered = record.ok || (isSodaxError(record.error) && record.error.context?.status === 404);

      const dstTxHash = await this.resolveHubTxHash(params, backendAnswered);
      if (!dstTxHash.ok) return dstTxHash;

      // Reconciling and bounded, because this read is polled.
      const solver = await this.resolveSolverStatus(
        { intent_tx_hash: dstTxHash.value },
        DETAILED_STATUS_SOLVER_TIMEOUT_MS,
        config?.apiKey,
      );
      if (!solver.ok) {
        return { ok: false, error: this.detailedStatusLookupFailed(solver.error, params.srcChainKey) };
      }
      return { ok: true, value: { source: 'solver', dstTxHash: dstTxHash.value, data: solver.value } };
    } catch (error) {
      // The relay client asserts on empty identifiers rather than returning a Result.
      return { ok: false, error: this.detailedStatusLookupFailed(error, params.srcChainKey) };
    }
  }

  /** Hub tx the solver is keyed on: the source tx on the hub, else from the delivered relay packet / MPC record. */
  private async resolveHubTxHash(
    key: DetailedLeverageYieldStatusKey,
    backendAnswered: boolean,
  ): Promise<Result<Hex, LeverageYieldDetailedStatusError>> {
    let hubTxHash: string = key.srcTxHash;

    if (!isHubChainKeyType(key.srcChainKey)) {
      const delivered = await resolveDeliveredHubTxHash({
        srcChainKey: key.srcChainKey,
        srcTxHash: key.srcTxHash,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        backendAnswered,
        spoke: this.spoke,
      });
      if (!delivered.ok) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(delivered.cause, key.srcChainKey, {
            reason: delivered.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
          }),
        };
      }
      hubTxHash = delivered.hubTxHash;
    }

    if (isHex(hubTxHash)) return { ok: true, value: hubTxHash };
    return {
      ok: false,
      error: this.detailedStatusLookupFailed(
        new Error(`hub tx hash is not a hex string: ${hubTxHash}`),
        key.srcChainKey,
      ),
    };
  }

  /** `reason` only for the budgetable not-delivered miss; `status` lifted so `isAuthFailure` (no cause walk) sees it. */
  private detailedStatusLookupFailed(
    cause: unknown,
    srcChainKey: SpokeChainKey,
    extra?: { reason?: string; status?: number },
  ): LeverageYieldDetailedStatusError {
    return lookupFailed('leverageYield', 'getDetailedStatus', cause, {
      srcChainKey,
      action: 'vaultSwap' satisfies LeverageYieldAction,
      ...extra,
    });
  }

  /** For direct hub vault deposits; the swap-style `deposit` flow handles its own approvals. */
  public async approve<R extends boolean = false>(
    params: LeverageYieldApproveParams<R>,
  ): Promise<Result<TxReturnType<HubChainKey, R>, LeverageYieldApproveError>> {
    const baseCtx = { action: 'approve' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });

      const assetResult = await this.getAsset(params.vault);
      if (!assetResult.ok) {
        return { ok: false, error: approveFailed('leverageYield', assetResult.error, baseCtx) };
      }

      const from = (await params.walletProvider.getWalletAddress()) as Address;
      const baseApprove = {
        token: assetResult.value,
        amount: params.amount,
        from,
        spender: params.vault,
      } as const;

      if (params.raw) {
        const tx = await Erc20Service.approve<true>({ ...baseApprove, raw: true });
        return { ok: true, value: tx as TxReturnType<HubChainKey, R> };
      }

      // Via SpokeService so a stale USDT-class allowance is reset before the approve instead of dead-ending.
      const result = await this.spoke.approve<HubChainKey, false>({
        srcChainKey: this.hubProvider.chainConfig.chain.key,
        token: baseApprove.token,
        amount: baseApprove.amount,
        owner: from,
        spender: baseApprove.spender,
        raw: false,
        walletProvider: params.walletProvider,
      });
      if (!result.ok) {
        return { ok: false, error: approveFailed('leverageYield', result.error, baseCtx) };
      }

      return { ok: true, value: result.value as TxReturnType<HubChainKey, R> };
    } catch (error) {
      if (isLeverageYieldApproveError(error)) return { ok: false, error };
      return { ok: false, error: approveFailed('leverageYield', error, baseCtx) };
    }
  }

  /** Underlying-asset allowance for `owner -> vault`, for direct hub vault deposits. */
  public async isAllowanceValid(
    params: LeverageYieldAllowanceParams,
  ): Promise<Result<boolean, LeverageYieldAllowanceCheckError>> {
    const baseCtx = { action: 'allowanceCheck' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const assetResult = await this.getAsset(params.vault);
      if (!assetResult.ok) {
        return { ok: false, error: allowanceCheckFailed('leverageYield', assetResult.error, baseCtx) };
      }

      const allowance = await this.hubProvider.publicClient.readContract({
        address: assetResult.value,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [params.owner, params.vault],
      });

      return { ok: true, value: allowance >= params.amount };
    } catch (error) {
      if (isLeverageYieldAllowanceCheckError(error)) return { ok: false, error };
      return { ok: false, error: allowanceCheckFailed('leverageYield', error, baseCtx) };
    }
  }

  public async getAsset(vault: Address): Promise<Result<Address, LeverageYieldLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: leverageYieldVaultAbi,
        functionName: 'asset',
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getAsset', error) };
    }
  }

  public async getPosition(vault: Address): Promise<Result<LeverageYieldPosition, LeverageYieldLookupError>> {
    try {
      const [collateral, debt, ltv, healthFactor, idleAsset] = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: leverageYieldVaultAbi,
        functionName: 'getPositionDetails',
      });
      return { ok: true, value: { collateral, debt, ltv, healthFactor, idleAsset } };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPosition', error) };
    }
  }

  /** Steady-state APR from AAVE rates at `targetLTV`, assuming constant rates (see {@link LeverageYieldApr}). */
  public async getApr(vault: Address): Promise<Result<LeverageYieldApr, LeverageYieldLookupError>> {
    try {
      const [pool, asset, borrowToken, targetLtvBps] = await Promise.all([
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'pool',
        }),
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'asset',
        }),
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'borrowToken',
        }),
        this.hubProvider.publicClient.readContract({
          address: vault,
          abi: leverageYieldVaultAbi,
          functionName: 'targetLTV',
        }),
      ]);

      const [assetReserve, borrowReserve] = await Promise.all([
        this.hubProvider.publicClient.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'getReserveData',
          args: [asset],
        }),
        this.hubProvider.publicClient.readContract({
          address: pool,
          abi: poolAbi,
          functionName: 'getReserveData',
          args: [borrowToken],
        }),
      ]);

      const supplyAprRay = assetReserve.currentLiquidityRate;
      const borrowAprRay = borrowReserve.currentVariableBorrowRate;

      const BPS = 10_000n;
      const WAD = 1_000_000_000_000_000_000n; // 1e18, explicit so TS infers `bigint`
      leverageYieldInvariant(targetLtvBps < BPS, `targetLTV (${targetLtvBps}) must be < 100% (10_000 bps)`, {
        method: 'getApr',
        field: 'targetLtvBps',
      });
      const leverageMultiplierWad = (targetLtvBps * WAD) / (BPS - targetLtvBps);

      // Signed bigint math so a negative spread stays negative; multiply before dividing by WAD for precision.
      const spreadRay = supplyAprRay - borrowAprRay;
      const netAprRay = supplyAprRay + (spreadRay * leverageMultiplierWad) / WAD;

      return {
        ok: true,
        value: { supplyAprRay, borrowAprRay, targetLtvBps, leverageMultiplierWad, netAprRay },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getApr', error) };
    }
  }

  /**
   * LSD staking APR from DefiLlama; always `ok` for a known vault, falling back to `fallbackAprPct` with `stale: true`.
   * Vaults without `lsdSource` return `aprRay: 0n`.
   */
  public async getLsdApr(vault: Address): Promise<Result<LeverageYieldLsdApr, LeverageYieldLookupError>> {
    try {
      const cfg = this.getVaultByAddress(vault);
      const source = cfg?.lsdSource;
      if (!source) {
        return { ok: true, value: { aprRay: 0n, label: 'no LSD source', stale: true } };
      }
      try {
        const aprPct = await fetchDefillamaApr(source.poolId);
        return { ok: true, value: { aprRay: pctToRay(aprPct), label: source.label, stale: false } };
      } catch (fetchError) {
        this.config.logger.warn('[leverageYield] DefiLlama APR fetch failed; using fallbackAprPct', {
          vault,
          poolId: source.poolId,
          fallbackAprPct: source.fallbackAprPct,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        });
        return {
          ok: true,
          value: { aprRay: pctToRay(source.fallbackAprPct), label: `${source.label} (fallback)`, stale: true },
        };
      }
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getLsdApr', error) };
    }
  }

  /** {@link getApr} with the LSD staking yield folded into the supply side; AAVE-only `netAprRay` is kept. */
  public async getEffectiveApr(vault: Address): Promise<Result<LeverageYieldEffectiveApr, LeverageYieldLookupError>> {
    try {
      const [aprResult, lsdResult] = await Promise.all([this.getApr(vault), this.getLsdApr(vault)]);
      if (!aprResult.ok) return aprResult;
      if (!lsdResult.ok) return lsdResult;
      const apr = aprResult.value;
      const lsd = lsdResult.value;
      const effectiveSupplyAprRay = apr.supplyAprRay + lsd.aprRay;
      const spreadRay = effectiveSupplyAprRay - apr.borrowAprRay;
      const WAD = 1_000_000_000_000_000_000n; // 1e18 — matches `leverageMultiplierWad`'s scale
      const effectiveNetAprRay = effectiveSupplyAprRay + (spreadRay * apr.leverageMultiplierWad) / WAD;
      return {
        ok: true,
        value: { ...apr, lsdApr: lsd, effectiveSupplyAprRay, effectiveNetAprRay },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getEffectiveApr', error) };
    }
  }

  /** Clamped against the leverage HF floor. */
  public async getMaxWithdraw(vault: Address, owner: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getMaxWithdraw(vault, owner, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Vault-asset units (18 decimals). */
  public async getTotalAssets(vault: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getTotalAssets(vault, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getTotalAssets', inner.error) };
    return { ok: true, value: inner.value };
  }

  public async previewDeposit(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewDeposit(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewDeposit', inner.error) };
    return { ok: true, value: inner.value };
  }

  public async previewWithdraw(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewWithdraw(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  public async previewRedeem(vault: Address, shares: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewRedeem(vault, shares, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewRedeem', inner.error) };
    return { ok: true, value: inner.value };
  }

  public async getShareBalance(vault: Address, owner: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: vault,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getShareBalance', error) };
    }
  }

  /** Hub wallet's `maxWithdraw` less {@link MAX_WITHDRAW_DUST_BUFFER}, safe for an asset-denominated `withdraw`. */
  public async getMaxWithdrawForUser<K extends SpokeChainKey>(
    vault: Address,
    srcChainKey: K,
    srcAddress: string,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
      const maxWithdrawResult = await this.getMaxWithdraw(vault, hubWallet);
      if (!maxWithdrawResult.ok) return maxWithdrawResult;
      const buffered =
        maxWithdrawResult.value > MAX_WITHDRAW_DUST_BUFFER ? maxWithdrawResult.value - MAX_WITHDRAW_DUST_BUFFER : 0n;
      return { ok: true, value: buffered };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdrawForUser', error, { srcChainKey }) };
    }
  }

  public async getShareBalanceForUser<K extends SpokeChainKey>(
    vault: Address,
    srcChainKey: K,
    srcAddress: string,
  ): Promise<Result<bigint, LeverageYieldLookupError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
      return await this.getShareBalance(vault, hubWallet);
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getShareBalanceForUser', error, { srcChainKey }) };
    }
  }

  /** Fails closed on an empty factory override (e.g. a bad env var): a placeholder would post real intents at nothing. */
  private requireFactory(action: string): Result<Address, LeverageYieldLookupError> {
    const factory = this.config.sodaxConfig.leverageYield.positionFactory;
    if (!factory) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          action,
          new Error('leverageYield.positionFactory is not configured; supply the deployed factory address'),
        ),
      };
    }
    return { ok: true, value: factory };
  }

  /** In creation order. */
  public async listPositions(owner: Address): Promise<Result<readonly Address[], LeverageYieldLookupError>> {
    const factory = this.requireFactory('listPositions');
    if (!factory.ok) return factory;
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: factory.value,
        abi: leveragePositionFactoryAbi,
        functionName: 'positionsOf',
        args: [owner],
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'listPositions', error) };
    }
  }

  /** Positions owned by the user's hub wallet; prefer over `listPositions`, since a raw EOA finds nothing. */
  public async listPositionsForUser<K extends SpokeChainKey>(
    srcChainKey: K,
    srcAddress: string,
  ): Promise<Result<readonly Address[], LeverageYieldLookupError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
      return await this.listPositions(hubWallet);
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'listPositionsForUser', error, { srcChainKey }) };
    }
  }

  public async getPositionInfo(position: Address): Promise<Result<LeveragePosition, LeverageYieldLookupError>> {
    try {
      const [owner, collateral, borrowToken, eModeCategory, feeBps, feeReceiver] = await Promise.all([
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'owner',
        }),
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'collateral',
        }),
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'borrowToken',
        }),
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'eModeCategory',
        }),
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'feeBps',
        }),
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'feeReceiver',
        }),
      ]);
      return {
        ok: true,
        value: {
          address: position,
          owner,
          collateral,
          borrowToken,
          eModeCategory,
          // From the position, not config: what a NEW position would carry is not what THIS one does.
          feeBps: Number(feeBps),
          feeReceiver,
        },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPositionInfo', error) };
    }
  }

  /** Live AAVE account data from the pool (`moneyMarket.lendingPool`); the position keeps no accounting itself. */
  public async getPositionAccount(
    position: Address,
  ): Promise<Result<LeveragePositionAccount, LeverageYieldLookupError>> {
    try {
      const [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor] =
        await this.hubProvider.publicClient.readContract({
          address: this.config.sodaxConfig.moneyMarket.lendingPool,
          abi: poolAbi,
          functionName: 'getUserAccountData',
          args: [position],
        });
      return {
        ok: true,
        value: {
          totalCollateralBase,
          totalDebtBase,
          availableBorrowsBase,
          currentLiquidationThreshold,
          ltv,
          healthFactor,
        },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPositionAccount', error) };
    }
  }

  /**
   * Exact aToken balance, to size a full exit: base-currency collateral can't name an amount, and over-asking reverts
   * at fill. A stale read is safe since aToken balances only grow. `collateral` is read from the position when omitted.
   */
  public async getPositionCollateralBalance(
    position: Address,
    collateral?: Address,
  ): Promise<Result<LeveragePositionCollateral, LeverageYieldLookupError>> {
    try {
      const asset =
        collateral ??
        (await this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'collateral',
        }));
      const reserve = await this.hubProvider.publicClient.readContract({
        address: this.config.sodaxConfig.moneyMarket.lendingPool,
        abi: poolAbi,
        functionName: 'getReserveData',
        args: [asset],
      });
      const aToken = reserve.aTokenAddress;
      const balance = await this.hubProvider.publicClient.readContract({
        address: aToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [position],
      });
      return { ok: true, value: { aToken, balance } };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPositionCollateralBalance', error) };
    }
  }

  /**
   * `needsSettle` = recorded `kind` but intent no longer live: the grant and any debt-side contribution are still
   * open until `buildSettlePosition`. A live intent blocks any second operation.
   */
  public async getPositionPendingState(
    position: Address,
  ): Promise<Result<LeveragePositionPendingState, LeverageYieldLookupError>> {
    try {
      const [isLive, kind] = await Promise.all([
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'hasPendingOperation',
        }),
        this.hubProvider.publicClient.readContract({
          address: position,
          abi: leveragePositionAbi,
          functionName: 'pendingKind',
        }),
      ]);
      return { ok: true, value: { kind, isLive, needsSettle: kind !== 0 && !isLive } };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPositionPendingState', error) };
    }
  }

  /** Deterministic clone address for the next position `creator` opens for `owner`. */
  public async predictPosition(
    creator: Address,
    owner: Address,
    positionId?: bigint,
  ): Promise<Result<Address, LeverageYieldLookupError>> {
    const factory = this.requireFactory('predictPosition');
    if (!factory.ok) return factory;
    try {
      const id =
        positionId ??
        (await this.hubProvider.publicClient.readContract({
          address: factory.value,
          abi: leveragePositionFactoryAbi,
          functionName: 'nextPositionIdFor',
          args: [owner],
        }));
      const value = await this.hubProvider.publicClient.readContract({
        address: factory.value,
        abi: leveragePositionFactoryAbi,
        functionName: 'predictPosition',
        args: [creator, owner, id],
      });
      return { ok: true, value };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'predictPosition', error) };
    }
  }

  // Leverage/deleverage calls only POST an intent; poll `getPositionPendingState`, not the receipt, for completion.

  /** Refuses combinations the contract would revert on: better a rejected build than a reverting tx. */
  private resolveOrigin(
    origin: PositionOrigin,
    method: string,
  ): Result<{ chainId: bigint; address: Hex; asset: Address }, LeverageYieldLookupError> {
    if (isMpcRelayChainKey(origin.chainKey)) {
      return {
        ok: false,
        error: lookupFailed('leverageYield', method, new Error('MPC relay refund origins are unsupported')),
      };
    }
    // Unmapped keys return undefined, which would surface from viem as a cryptic BigInt error.
    const chainId = getIntentRelayChainId(origin.chainKey);
    if (chainId === undefined) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          method,
          new Error(`no relay chain id for origin chain ${origin.chainKey}`),
        ),
      };
    }
    const isHub = origin.chainKey === this.hubProvider.chainConfig.chain.key;
    if (!isHub && !origin.asset) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          method,
          new Error(`origin.asset is required for a refund to ${origin.chainKey}`),
        ),
      };
    }
    return {
      ok: true,
      value: {
        chainId,
        // The chain's own encoding (not 0x-prefixed): `originAddress` is the AssetManager's refund destination.
        address: encodeRecipient(origin.chainKey, origin.address),
        // Set on the hub too: the asset decides what a cancel pays back; `address(0)` only when nothing was wrapped.
        asset: (origin.asset ?? zeroAddress) as Address,
      },
    };
  }

  /**
   * Fee (bps) and receiver a position created NOW would carry; fixed at creation. Feed `feeBps` to
   * {@link projectLeverageLeg} and pass the same `override` here as to the open call.
   */
  public getEffectivePositionFee(
    override?: PartnerFee,
  ): Result<{ feeReceiver: Address; feeBps: number }, LeverageYieldLookupError> {
    return this.resolvePositionFee(override, 'getEffectivePositionFee');
  }

  private resolvePositionFee(
    override: PartnerFee | undefined,
    method: string,
  ): Result<{ feeReceiver: Address; feeBps: number }, LeverageYieldLookupError> {
    const fee = override ?? this.config.leverageYieldPartnerFee;
    if (!fee) return { ok: true, value: { feeReceiver: zeroAddress, feeBps: 0 } };
    if (!isPartnerFeePercentage(fee)) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          method,
          new Error('a position partner fee must be the percentage variant; PositionConfig stores basis points'),
        ),
      };
    }
    // Bounded tighter than `getQuote`'s because a position's fee is baked in permanently at creation.
    if (!Number.isInteger(fee.percentage) || fee.percentage < 0 || fee.percentage > MAX_POSITION_FEE_BPS) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          method,
          new Error(
            `a position partner fee must be a whole number of basis points between 0 and MAX_POSITION_FEE_BPS (${MAX_POSITION_FEE_BPS}) (got ${fee.percentage})`,
          ),
        ),
      };
    }
    // `LeveragePosition.initialize` rejects a half-configured fee (rate without receiver, or vice versa).
    if ((fee.percentage === 0) !== isAddressEqual(fee.address, zeroAddress)) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          method,
          new Error(
            `a position partner fee needs a rate and a receiver together, or neither (got ${fee.percentage} bps for ${fee.address})`,
          ),
        ),
      };
    }
    return { ok: true, value: { feeReceiver: fee.address, feeBps: fee.percentage } };
  }

  // The single brand cast lives here (brands are type-only), so no builder carries its own. Never sends value.
  private hubTx<T extends EvmRawTransaction = EvmRawTransaction>(from: Address, to: Address, data: Hex): T {
    return { from, to, value: 0n, data } as T;
  }

  /** Shared by both factory entry points so a mis-spelled field can't silently mis-record the refund destination. */
  private positionConfig(args: {
    owner: Address;
    collateral: Address;
    borrowToken: Address;
    eModeCategory: number;
    origin: { chainId: bigint; address: Hex; asset: Address };
    fee?: { feeReceiver: Address; feeBps: number };
  }): {
    owner: Address;
    collateral: Address;
    borrowToken: Address;
    eModeCategory: number;
    originChainId: bigint;
    originAddress: Hex;
    originAsset: Address;
    feeReceiver: Address;
    feeBps: number;
  } {
    return {
      owner: args.owner,
      collateral: args.collateral,
      borrowToken: args.borrowToken,
      eModeCategory: args.eModeCategory,
      originChainId: args.origin.chainId,
      originAddress: args.origin.address,
      originAsset: args.origin.asset,
      feeReceiver: args.fee?.feeReceiver ?? zeroAddress,
      feeBps: args.fee?.feeBps ?? 0,
    };
  }

  /** Open + request leverage in one tx; pulls `initialAssets` from the signer, so approve the factory first. */
  public buildCreatePositionAndLeverage(params: {
    from: Address;
    owner: Address;
    collateral: Address;
    borrowToken: Address;
    eModeCategory: number;
    origin: PositionOrigin;
    partnerFee?: PartnerFee;
    initialAssets: bigint;
    borrowAmount: bigint;
    minCollateralOut: bigint;
  }): Result<EvmRawTransaction, LeverageYieldLookupError> {
    const method = 'buildCreatePositionAndLeverage';
    const factory = this.requireFactory(method);
    if (!factory.ok) return factory;
    const fee = this.resolvePositionFee(params.partnerFee, method);
    if (!fee.ok) return fee;
    const origin = this.resolveOrigin(params.origin, method);
    if (!origin.ok) return origin;
    return {
      ok: true,
      value: this.hubTx(
        params.from,
        factory.value,
        encodeFunctionData({
          abi: leveragePositionFactoryAbi,
          functionName: 'createPositionAndLeverage',
          args: [
            this.positionConfig({ ...params, origin: origin.value, fee: fee.value }),
            params.initialAssets,
            params.borrowAmount,
            params.minCollateralOut,
          ],
        }),
      ),
    };
  }

  /**
   * Opens from the DEBT token: pulls `contribution` of `borrowToken`, and the hook borrows `totalInput - contribution`.
   * Reverts with `DebtSideHookUnavailable` if the deployment has no debt-side hook.
   */
  public buildCreatePositionFromDebtToken(params: {
    from: Address;
    owner: Address;
    collateral: Address;
    borrowToken: Address;
    eModeCategory: number;
    origin: PositionOrigin;
    partnerFee?: PartnerFee;
    contribution: bigint;
    totalInput: bigint;
    minCollateralOut: bigint;
  }): Result<EvmRawTransaction, LeverageYieldLookupError> {
    const method = 'buildCreatePositionFromDebtToken';
    const factory = this.requireFactory(method);
    if (!factory.ok) return factory;
    const fee = this.resolvePositionFee(params.partnerFee, method);
    if (!fee.ok) return fee;
    const origin = this.resolveOrigin(params.origin, method);
    if (!origin.ok) return origin;
    return {
      ok: true,
      value: this.hubTx(
        params.from,
        factory.value,
        encodeFunctionData({
          abi: leveragePositionFactoryAbi,
          functionName: 'createPositionFromDebtToken',
          args: [
            this.positionConfig({ ...params, origin: origin.value, fee: fee.value }),
            params.contribution,
            params.totalInput,
            params.minCollateralOut,
          ],
        }),
      ),
    };
  }

  /** `minCollateralOut` is the slippage floor. */
  public buildAddLeverage(params: {
    from: Address;
    position: Address;
    borrowAmount: bigint;
    minCollateralOut: bigint;
  }): PositionIntentCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({
        abi: leveragePositionAbi,
        functionName: 'addLeverage',
        args: [params.borrowAmount, params.minCollateralOut],
      }),
    );
  }

  /**
   * Closing into the debt token is this call with the full aToken balance less the fee (`balance x 10_000 / (10_000 + feeBps)`).
   * Any surplus stays in the position until {@link buildSettlePosition} sweeps it to the `owner` (hub wallet).
   */
  public buildDecreaseLeverage(params: {
    from: Address;
    position: Address;
    collateralIn: bigint;
    minDebtOut: bigint;
    /** Full-close surplus is delivered in this underlying to the owner's origin chain; zero/omitted leaves it for settle. */
    exitAsset?: Address;
  }): PositionIntentCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({
        abi: leveragePositionAbi,
        functionName: 'decreaseLeverage',
        args: [params.collateralIn, params.minDebtOut, params.exitAsset ?? zeroAddress],
      }),
    );
  }

  /** The pool rejects withdrawals below HF 1 (not a safety buffer), so no client-side health check is applied. */
  public buildPositionWithdraw(params: {
    from: Address;
    position: Address;
    amount: bigint;
    to: Address;
  }): PositionDirectCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({
        abi: leveragePositionAbi,
        functionName: 'withdraw',
        args: [params.amount, params.to],
      }),
    );
  }

  /**
   * Permissionless: clears a resolved operation and returns loose balances to the owner (e.g. after a third-party
   * cancel past deadline). Reverts while the intent is live; use {@link buildCancelPositionOperation} instead.
   */
  public buildSettlePosition(params: { from: Address; position: Address }): PositionDirectCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({ abi: leveragePositionAbi, functionName: 'settle' }),
    );
  }

  /** Cancels the in-flight operation; a debt-free position also withdraws all collateral back to the owner. */
  public buildCancelPositionOperation(params: { from: Address; position: Address }): PositionDirectCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({ abi: leveragePositionAbi, functionName: 'cancel' }),
    );
  }

  // Calls run as a hub-wallet payload (`onlyOwner` is the hub wallet), routed locally on the hub and relayed elsewhere.

  /** The `(address,uint256,bytes)[]` hub-wallet payload; pass to `spoke.deposit` / `spoke.sendMessage` for manual relay. */
  public encodePositionCalls(txs: readonly EvmRawTransaction[]): Hex {
    return encodeContractCalls(
      txs.map(tx => ({ address: tx.to as Address, value: tx.value ?? 0n, data: tx.data }) satisfies EvmContractCall),
    );
  }

  /** `hubAsset` lands in the hub wallet, `vault` is the 18-decimal reserve positions use; the spoke `address` is neither. */
  private resolveFunding(
    srcChainKey: SpokeChainKey,
    token: string,
    method: string,
  ): Result<{ hubAsset: Address; vault: Address; decimals: number }, LeverageYieldLookupError> {
    // Hub-asset fallback: on the hub the held token IS the hub asset (e.g. Sonic sUSDS's registry entry is an Arbitrum address).
    const spokeToken =
      this.config.getSpokeTokenFromOriginalAssetAddress(srcChainKey, token) ?? this.config.getXTokenFromHubAsset(token);
    if (!spokeToken) {
      return {
        ok: false,
        error: lookupFailed(
          'leverageYield',
          method,
          new Error(`no hub asset registered for ${token} on ${srcChainKey}`),
          { srcChainKey },
        ),
      };
    }
    return {
      ok: true,
      value: {
        hubAsset: spokeToken.hubAsset as Address,
        vault: spokeToken.vault as Address,
        decimals: spokeToken.decimals,
      },
    };
  }

  /** Asset a refund unwraps into (USSD, not `sodaUSSD`), or `undefined` when the funding token IS the reserve. */
  private refundAsset(funding: { hubAsset: Address; vault: Address }): Address | undefined {
    return funding.hubAsset.toLowerCase() === funding.vault.toLowerCase() ? undefined : funding.hubAsset;
  }

  /**
   * Wraps an arriving deposit into its reserve (no-op for soda vault tokens). Assumes a fee-free reserve: a deposit
   * fee would mint fewer shares than predicted and revert the factory's pull.
   */
  private encodeWrapIntoReserve(
    funding: { hubAsset: Address; vault: Address; decimals: number },
    amount: bigint,
  ): { calls: EvmContractCall[]; reserveAmount: bigint } {
    if (this.config.isSodaVaultHubAsset(funding.hubAsset)) {
      return { calls: [], reserveAmount: amount };
    }
    return {
      calls: [
        Erc20Service.encodeApprove(funding.hubAsset, funding.vault, amount),
        EvmVaultTokenService.encodeDeposit(funding.vault, funding.hubAsset, amount),
      ],
      reserveAmount: EvmVaultTokenService.translateIncomingDecimals(funding.decimals, amount),
    };
  }

  /** Shared open prelude: factory, funding, origin, predicted position address, and the wrap + transfer `calls`. */
  private async prepareOpen(
    params: PositionFundingParams<SpokeChainKey> & { owner: Address },
    method: string,
  ): Promise<
    Result<
      {
        factory: Address;
        funding: { hubAsset: Address; vault: Address; decimals: number };
        calls: EvmContractCall[];
        reserveAmount: bigint;
        origin: { chainId: bigint; address: Hex; asset: Address };
        fee: { feeReceiver: Address; feeBps: number };
      },
      LeverageYieldLookupError
    >
  > {
    const factory = this.requireFactory(method);
    if (!factory.ok) return factory;
    const fee = this.resolvePositionFee(params.partnerFee, method);
    if (!fee.ok) return fee;
    const funding = this.resolveFunding(params.srcChainKey, params.token, method);
    if (!funding.ok) return funding;
    const origin = this.resolveOrigin(
      { chainKey: params.srcChainKey, address: params.srcAddress, asset: this.refundAsset(funding.value) },
      method,
    );
    if (!origin.ok) return origin;
    // Creator and owner are the same hub wallet; the factory requires it.
    const predicted = await this.predictPosition(params.owner, params.owner);
    if (!predicted.ok) return predicted;

    const { calls, reserveAmount } = this.encodeWrapIntoReserve(funding.value, params.amount);
    calls.push(Erc20Service.encodeTransfer(funding.value.vault, predicted.value, reserveAmount));
    return {
      ok: true,
      value: {
        factory: factory.value,
        funding: funding.value,
        calls,
        reserveAmount,
        origin: origin.value,
        fee: fee.value,
      },
    };
  }

  /**
   * Collateral-side open payload: wrap, TRANSFER to the predicted position address, create + post intent in one batch.
   * Never open two positions for one owner at once: that advances the id and reverts the batch (spoke funds need recovery).
   */
  public async buildOpenPositionData(
    params: OpenPositionParams<SpokeChainKey> & { owner: Address },
  ): Promise<Result<Hex, LeverageYieldLookupError>> {
    const prep = await this.prepareOpen(params, 'buildOpenPositionData');
    if (!prep.ok) return prep;
    const { factory, funding, calls, reserveAmount, origin, fee } = prep.value;
    calls.push({
      address: factory,
      value: 0n,
      data: encodeFunctionData({
        abi: leveragePositionFactoryAbi,
        functionName: 'createPositionAndLeverage',
        args: [
          this.positionConfig({
            owner: params.owner,
            collateral: funding.vault,
            borrowToken: params.borrowToken,
            eModeCategory: params.eModeCategory ?? 0,
            origin,
            fee,
          }),
          reserveAmount,
          params.borrowAmount,
          params.minCollateralOut,
        ],
      }),
    });

    return { ok: true, value: encodeContractCalls(calls) };
  }

  /** Debt-side mirror of {@link buildOpenPositionData}: the deposit is contributed, not supplied. */
  public async buildOpenPositionFromDebtTokenData(
    params: OpenPositionFromDebtTokenParams<SpokeChainKey> & { owner: Address },
  ): Promise<Result<Hex, LeverageYieldLookupError>> {
    const prep = await this.prepareOpen(params, 'buildOpenPositionFromDebtTokenData');
    if (!prep.ok) return prep;
    const { factory, funding, calls, reserveAmount, origin, fee } = prep.value;
    calls.push({
      address: factory,
      value: 0n,
      data: encodeFunctionData({
        abi: leveragePositionFactoryAbi,
        functionName: 'createPositionFromDebtToken',
        args: [
          this.positionConfig({
            owner: params.owner,
            collateral: params.collateral,
            borrowToken: funding.vault,
            eModeCategory: params.eModeCategory ?? 0,
            origin,
            fee,
          }),
          reserveAmount,
          params.totalInput,
          params.minCollateralOut,
        ],
      }),
    });

    return { ok: true, value: encodeContractCalls(calls) };
  }

  /** Spender is the user's hub wallet on the hub and the asset manager on an EVM spoke; Stellar checks the trustline. */
  public async isPositionFundingAllowanceValid<K extends SpokeChainKey>(params: {
    srcChainKey: K;
    srcAddress: string;
    token: string;
    amount: bigint;
  }): Promise<Result<boolean, LeverageYieldAllowanceCheckError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'allowanceCheck' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(params.amount > 0n, 'amount must be greater than 0', { ...baseCtx, field: 'amount' });
      const srcChainKey: SpokeChainKey = params.srcChainKey;
      const inner =
        isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)
          ? await this.spoke.isAllowanceValid({
              srcChainKey,
              token: params.token,
              amount: params.amount,
              owner: params.srcAddress,
              spender: await this.resolveFundingSpender(srcChainKey, params.srcAddress),
            })
          : await this.spoke.isAllowanceValid({
              srcChainKey,
              token: params.token,
              amount: params.amount,
              owner: params.srcAddress,
            });
      if (inner.ok) return inner;
      return { ok: false, error: allowanceCheckFailed('leverageYield', inner.error, baseCtx) };
    } catch (error) {
      if (isLeverageYieldAllowanceCheckError(error)) return { ok: false, error };
      return { ok: false, error: allowanceCheckFailed('leverageYield', error, baseCtx) };
    }
  }

  /** Waits for the approval to land, so an immediate allowance re-read doesn't prompt a second approval. */
  public async approvePositionFunding<K extends SpokeChainKey>(params: {
    srcChainKey: K;
    srcAddress: string;
    token: string;
    amount: bigint;
    walletProvider?: GetWalletProviderType<K>;
  }): Promise<Result<TxReturnType<K, false>, LeverageYieldApproveError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'approve' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(params.amount > 0n, 'amount must be greater than 0', { ...baseCtx, field: 'amount' });
      const srcChainKey: SpokeChainKey = params.srcChainKey;
      let inner: Result<TxReturnType<SpokeChainKey, false>> = {
        ok: false,
        error: new Error(`[LeverageYieldService.approvePositionFunding] approve is unsupported on ${srcChainKey}`),
      };
      if (isHubChainKeyType(srcChainKey) || isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        leverageYieldInvariant(isAddress(params.token), 'Invalid token address', { ...baseCtx, field: 'token' });
        inner = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, false>({
          srcChainKey,
          token: params.token,
          amount: params.amount,
          owner: params.srcAddress as Address,
          spender: await this.resolveFundingSpender(srcChainKey, params.srcAddress),
          raw: false,
          // `K` stays open here, so the provider is only checkable against the chain key inside `spoke.approve`.
          walletProvider: params.walletProvider as GetWalletProviderType<HubChainKey>,
        });
      } else if (isStellarChainKeyType(srcChainKey)) {
        inner = await this.spoke.approve<StellarChainKey, false>({
          srcChainKey,
          token: params.token,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
          raw: false,
          walletProvider: params.walletProvider as GetWalletProviderType<StellarChainKey>,
        });
      }
      if (!inner.ok) return { ok: false, error: approveFailed('leverageYield', inner.error, baseCtx) };

      // `verifyTxHash` returns immediately on EVM chains, so wait on the EVM provider's receipt there.
      if (params.walletProvider && isEvmWalletProviderType(params.walletProvider as IWalletProvider)) {
        const receipt = await (params.walletProvider as IEvmWalletProvider).waitForTransactionReceipt(
          inner.value as Hex,
        );
        if (receipt.status !== 'success') {
          return { ok: false, error: approveFailed('leverageYield', 'transaction reverted', baseCtx) };
        }
      } else {
        const landed = await this.spoke.verifyTxHash({ txHash: inner.value as never, chainKey: params.srcChainKey });
        if (!landed.ok) return { ok: false, error: approveFailed('leverageYield', landed.error, baseCtx) };
      }

      return inner as Result<TxReturnType<K, false>, never>;
    } catch (error) {
      if (isLeverageYieldApproveError(error)) return { ok: false, error };
      return { ok: false, error: approveFailed('leverageYield', error, baseCtx) };
    }
  }

  /** On the hub the pull happens inside the routed batch (the hub wallet); on an EVM spoke it's the asset manager. */
  private async resolveFundingSpender(
    srcChainKey: HubChainKey | EvmSpokeOnlyChainKey,
    srcAddress: string,
  ): Promise<Address> {
    if (isHubChainKeyType(srcChainKey)) return await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
    return this.config.getChainConfig(srcChainKey).addresses.assetManager;
  }

  /**
   * Opens a position funded from any chain in one signature. Leverage is applied later by the solver; report
   * `dstChainTxHash` via {@link notifySolver} or the intent expires and the deposit comes back.
   * @experimental Off-hub (spoke) origins are unverified on mainnet; Bitcoin is refused.
   */
  public async openPosition<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, OpenPositionParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>> {
    return this.runPositionOpen(_params, 'openPosition', (owner, params) =>
      this.buildOpenPositionData({ ...params, owner }),
    );
  }

  /**
   * Debt-token variant of {@link openPosition}; reverts `DebtSideHookUnavailable` without a debt-side hook.
   * @experimental Off-hub (spoke) origins are unverified on mainnet; Bitcoin is refused.
   */
  public async openPositionFromDebtToken<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>> {
    return this.runPositionOpen(_params, 'openPositionFromDebtToken', (owner, params) =>
      this.buildOpenPositionFromDebtTokenData({ ...params, owner }),
    );
  }

  private async runPositionOpen<K extends SpokeChainKey, P extends PositionFundingParams<K>>(
    _params: SpokeExecActionParams<K, false, P>,
    action: Extract<LeverageYieldAction, 'openPosition' | 'openPositionFromDebtToken'>,
    build: (owner: Address, params: P) => Promise<Result<Hex, LeverageYieldLookupError>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>> {
    return this.config.analytics.trackResult(
      'leverageYield',
      action,
      () => this.executePositionOpen(_params, action, build),
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          inputToken: _params.params.token,
          inputAmount: _params.params.amount,
          eModeCategory: _params.params.eModeCategory,
        }),
        success: value => ({ srcTxHash: value.srcChainTxHash, dstTxHash: value.dstChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  private async executePositionOpen<K extends SpokeChainKey, P extends PositionFundingParams<K>>(
    _params: SpokeExecActionParams<K, false, P>,
    action: 'openPosition' | 'openPositionFromDebtToken',
    buildData: (owner: Address, params: P) => Promise<Result<Hex, LeverageYieldLookupError>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>> {
    const { params, timeout = DEFAULT_RELAY_TX_TIMEOUT } = _params;
    const baseCtx: { srcChainKey: K; action: LeverageYieldAction } = {
      srcChainKey: params.srcChainKey,
      action,
    };

    try {
      // Bitcoin TRADING mode needs the effective (trading) address for the hub wallet, so fail before funds move.
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(params.amount > 0n, 'amount must be greater than 0', { ...baseCtx, field: 'amount' });
      leverageYieldInvariant(params.minCollateralOut > 0n, 'minCollateralOut must be greater than 0', {
        ...baseCtx,
        field: 'minCollateralOut',
      });
      leverageYieldInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        { ...baseCtx, field: 'walletProvider' },
      );

      // The hub wallet is payer, creator and owner at once; the factory rejects any other owner.
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const data = await buildData(hubWallet, params);
      if (!data.ok) return data;

      const txResult = await this.spoke.deposit<K, false>({
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        to: hubWallet,
        token: params.token as GetTokenAddressType<K>,
        amount: params.amount,
        data: data.value,
        skipSimulation: _params.skipSimulation ?? false,
        raw: false,
        walletProvider: _params.walletProvider as GetWalletProviderType<K>,
      });
      if (!txResult.ok) {
        if (isLeverageYieldCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return { ok: false, error: intentCreationFailed('leverageYield', txResult.error, baseCtx) };
      }

      return await this.settleHubWalletMessage(txResult.value, { address: hubWallet, payload: data.value }, baseCtx, {
        timeout,
      });
    } catch (error) {
      if (isLeverageYieldSwapError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, { ...baseCtx, phase: 'intentCreation' }) };
    }
  }

  /**
   * The ONE address to both read the balance from and build the deposit with (they once disagreed and an open reverted).
   * Off-hub: `address`; on hub: `hubAsset`, except native entries, which fund as native. `undefined` when unsupported.
   */
  public resolvePositionFunding(chainKey: SpokeChainKey, token: XToken): Address | undefined {
    const address = resolvePositionFundingAddress(chainKey, this.hubProvider.chainConfig.chain.key, token);
    return address === '' ? undefined : (address as Address);
  }

  /**
   * Quotes a position leg on the HUB reserves, gross of fees (see `positionLegQuote.ts`); prefer over `getQuote`.
   * A {@link isNoRouteRefusal} may mean the leg is merely too small; re-quote at a healthy notional to tell.
   */
  public async getPositionLegQuote(params: {
    inputHubToken: Address;
    outputHubToken: Address;
    /** In `inputHubToken`'s units. */
    amount: bigint;
  }): Promise<Result<PositionLegQuote, SolverErrorResponse | LeverageYieldLookupError>> {
    const hubChainKey = this.hubProvider.chainConfig.chain.key;
    const quote = await this.getQuote({
      token_src: params.inputHubToken,
      token_src_blockchain_id: hubChainKey,
      token_dst: params.outputHubToken,
      token_dst_blockchain_id: hubChainKey,
      amount: params.amount,
      quote_type: 'exact_input',
      // Explicit zero fee: omitting it applies the configured leverage-yield fee.
      partnerFee: { address: zeroAddress, percentage: 0 },
    });
    if (!quote.ok) return quote;
    return { ok: true, value: { quotedAmount: quote.value.quoted_amount } };
  }

  /**
   * Opens a position AND reports its intent (prefer over `openPosition*`). Resolving means the intent is live, not that
   * the position is levered; a failed notification is still `ok: true` (see {@link LeveragePositionIntentResult}).
   * @experimental Off-hub (spoke) origins are unverified on mainnet.
   */
  public async openLeveragePosition<K extends SpokeChainKey>(
    _params:
      | ({ side?: 'collateral' } & SpokeExecActionParams<K, false, OpenPositionParams<K>>)
      | ({ side: 'debt' } & SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>),
  ): Promise<Result<LeveragePositionIntentResult, LeverageYieldSwapError | LeverageYieldLookupError>> {
    // Wraps an already-tracked call on purpose: only this layer sees `notified`.
    return this.config.analytics.trackResult(
      'leverageYield',
      'openLeveragePosition',
      async () => {
        const { side, ...rest } = _params;
        const opened =
          side === 'debt'
            ? await this.openPositionFromDebtToken(
                rest as SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>,
              )
            : await this.openPosition(rest as SpokeExecActionParams<K, false, OpenPositionParams<K>>);
        if (!opened.ok) return opened;
        return { ok: true, value: await reportPositionIntent(this.notifyIntent, opened.value) };
      },
      {
        start: () => ({ srcChainKey: _params.params.srcChainKey, side: _params.side ?? 'collateral' }),
        success: result => ({ ...result.txHashes, notified: result.notified }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Runs and reports intent-posting calls (`addLeverage`, `decreaseLeverage`). Use
   * {@link runLeveragePositionOperation} for `withdraw` / `settle` / `cancel`.
   * @experimental Off-hub (spoke) origins are unverified on mainnet.
   */
  public async submitLeveragePositionIntent<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, PositionOperationParams<K, PositionBatchCall>>,
  ): Promise<Result<LeveragePositionIntentResult, LeverageYieldSwapError>> {
    // Same as `openLeveragePosition`: only this layer sees `notified`.
    return this.config.analytics.trackResult(
      'leverageYield',
      'submitLeveragePositionIntent',
      async () => {
        const routed = await this.operatePosition(_params);
        if (!routed.ok) return routed;
        return { ok: true, value: await reportPositionIntent(this.notifyIntent, routed.value) };
      },
      {
        start: () => ({ srcChainKey: _params.params.srcChainKey, calls: _params.params.calls.length }),
        success: result => ({ ...result.txHashes, notified: result.notified }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Runs non-intent calls (`withdraw`, `settle`, `cancel`), synchronous on the hub, routed as the hub wallet (`onlyOwner`).
   * @experimental Off-hub (spoke) origins are unverified on mainnet, especially exits/cancels back to the spoke.
   */
  public async runLeveragePositionOperation<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, PositionOperationParams<K, PositionDirectCall>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    return this.operatePosition(_params);
  }

  /** Bound once so the notify half can be handed around without losing `this`. */
  private readonly notifyIntent: PositionIntentNotifier = request => this.notifySolver(request);

  /**
   * Runs position calls as the user's hub wallet from any chain, WITHOUT reporting intents; leverage calls need
   * `dstChainTxHash` passed to {@link notifySolver}.
   * @experimental Off-hub (spoke) origins are unverified on mainnet; Bitcoin is refused.
   */
  public async operatePosition<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, PositionOperationParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    return this.config.analytics.trackResult(
      'leverageYield',
      'operatePosition',
      () => this.executePositionOperation(_params),
      {
        // Calls are arbitrary hub calldata, so only the count is emitted.
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          callCount: _params.params.calls.length,
        }),
        success: value => ({ srcTxHash: value.srcChainTxHash, dstTxHash: value.dstChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  private async executePositionOperation<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, PositionOperationParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    const { params, timeout = DEFAULT_RELAY_TX_TIMEOUT } = _params;
    const baseCtx: { srcChainKey: K; action: LeverageYieldAction } = {
      srcChainKey: params.srcChainKey,
      action: 'operatePosition',
    };

    try {
      // Bitcoin TRADING mode needs the effective (trading) address for the hub wallet, so fail before funds move.
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), BITCOIN_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        ...baseCtx,
        field: 'srcChainKey',
      });
      leverageYieldInvariant(params.calls.length > 0, 'at least one call is required', {
        ...baseCtx,
        field: 'calls',
      });
      leverageYieldInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        { ...baseCtx, field: 'walletProvider' },
      );

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const payload = this.encodePositionCalls(params.calls);

      const txResult = await this.spoke.sendMessage<K, false>({
        srcChainKey: params.srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        dstChainKey: HUB_CHAIN_KEY,
        dstAddress: hubWallet,
        payload,
        skipSimulation: _params.skipSimulation ?? false,
        raw: false,
        walletProvider: _params.walletProvider as GetWalletProviderType<K>,
      } satisfies SendMessageParams<K, false>);
      if (!txResult.ok) {
        if (isLeverageYieldCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return { ok: false, error: intentCreationFailed('leverageYield', txResult.error, baseCtx) };
      }

      return await this.settleHubWalletMessage(txResult.value, { address: hubWallet, payload }, baseCtx, { timeout });
    } catch (error) {
      if (isLeverageYieldSwapError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, { ...baseCtx, phase: 'intentCreation' }) };
    }
  }

  /** Verifies the source tx and, off the hub, relays it and waits for the hub side. */
  private async settleHubWalletMessage<K extends SpokeChainKey>(
    srcTxHash: string,
    relayData: RelayExtraData,
    baseCtx: { srcChainKey: K; action: LeverageYieldAction },
    opts: { timeout: number },
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    const verify = await this.spoke.verifyTxHash({ txHash: srcTxHash, chainKey: baseCtx.srcChainKey });
    if (!verify.ok) return { ok: false, error: verifyFailed('leverageYield', verify.error, baseCtx) };

    if (isHubChainKeyType(baseCtx.srcChainKey)) {
      // `verifyTxHash` doesn't wait on EVM, so wait for the hub receipt and check success before reporting it landed.
      const receipt = await this.hubProvider.publicClient.waitForTransactionReceipt({
        hash: srcTxHash as Hex,
        timeout: opts.timeout,
      });
      if (receipt.status !== 'success') {
        return {
          ok: false,
          error: verifyFailed('leverageYield', new Error(`hub transaction ${srcTxHash} reverted`), baseCtx),
        };
      }
      return { ok: true, value: { srcChainTxHash: srcTxHash as Hex, dstChainTxHash: srcTxHash as Hex } };
    }

    const packet = await relayTxAndWaitPacket({
      srcTxHash,
      data: relayData,
      chainKey: baseCtx.srcChainKey,
      relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
      timeout: opts.timeout,
    });
    if (!packet.ok) {
      return {
        ok: false,
        error: mapRelayFailure(packet.error, {
          feature: 'leverageYield',
          action: baseCtx.action,
          srcChainKey: baseCtx.srcChainKey,
        }),
      };
    }

    return { ok: true, value: { srcChainTxHash: srcTxHash as Hex, dstChainTxHash: packet.value.dst_tx_hash } };
  }
}
