import {
  type SpokeService,
  type SendMessageParams,
  adjustAmountByFee,
  Erc20Service,
  Erc4626Service,
  EvmVaultTokenService,
  encodeContractCalls,
  encodeAddress,
  poolAbi,
  SonicSpokeService,
  isSonicChainKeyType,
  isHubChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  isStellarChainKeyType,
  isEvmWalletProviderType,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
  isPartnerFeeAmount,
  isPartnerFeePercentage,
  isUndefinedOrValidWalletProviderForChainKey,
  relayTxAndWaitPacket,
  RELAY_FALLBACK_FLOOR_MS,
  retry,
  type RelayExtraData,
  type IntentDeliveryInfo,
} from '../shared/index.js';
import type { HubProvider, TxHashPair } from '../shared/types/types.js';
import {
  DEFAULT_RELAY_TX_TIMEOUT,
  FEE_PERCENTAGE_SCALE,
  getIntentRelayChainId,
  HUB_CHAIN_KEY,
  isBitcoinChainKey,
  SolverIntentErrorCode,
  SolverIntentStatusCode,
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
  resolveDeliveredPacket,
} from '../backendApi/detailedStatusRouting.js';
import { isFillEvent } from '../backendApi/guards.js';
import { isAuthFailure, isSodaxError } from '../errors/guards.js';
import type { DetailedLeverageYieldStatus, DetailedLeverageYieldStatusKey } from './detailedStatus.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
import { createSubmitTxAttempt, type SubmitTxAttempt } from '../backendApi/submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';
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
} from '../errors/wrappers.js';
import type { LeverageYieldDetailedStatusError } from './errors.js';
import {
  isLeverageYieldAllowanceCheckError,
  isLeverageYieldApproveError,
  isLeverageYieldCreateIntentError,
  isLeverageYieldLookupError,
  isLeverageYieldPostExecutionError,
  isLeverageYieldSwapError,
  type LeverageYieldAction,
  type LeverageYieldAllowanceCheckError,
  type LeverageYieldApproveError,
  type LeverageYieldCreateIntentError,
  type LeverageYieldLookupError,
  type LeverageYieldPostExecutionError,
  type LeverageYieldSwapError,
  leverageYieldInvariant,
} from './errors.js';
import { resolvePositionFundingAddress } from './positionFunding.js';
import type { PositionLegQuote } from './positionLegQuote.js';
import {
  reportPositionIntent,
  type LeveragePositionIntentResult,
  type PositionIntentNotifier,
} from './positionIntent.js';

// ─── ABIs ─────────────────────────────────────────────────────────────────
//
// Standard ERC-4626 lives in `@sodax/sdk/shared/abis/erc4626.abi`. The leverage vault
// adds a single non-standard view (`getPositionDetails`) used for read-only position
// snapshots — keep that fragment here so we don't pollute the shared ABI directory
// with vault-specific declarations.
const leverageYieldVaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function getPositionDetails() view returns (uint256 collateral, uint256 debt, uint256 ltv, uint256 healthFactor, uint256 idleAsset)',
  // Used by getApr() — read-only metadata that doesn't change per pass.
  'function pool() view returns (address)',
  'function borrowToken() view returns (address)',
  'function targetLTV() view returns (uint256)',
]);

/** Mirrors `LeveragePosition.MAX_FEE_BPS`. Unlike a vault quote's bound, this one is permanent. */
export const MAX_POSITION_FEE_BPS = 100;

// Leverage positions are the unpooled counterpart to the vaults above: one owner-controlled
// AAVE account per position, cloned by the factory. Neither contract keeps accounting of its
// own — collateral, debt and health factor are read from the pool via `getUserAccountData`.
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

/**
 * Seconds added to the hub-chain (Sonic) block timestamp for the default intent `deadline`
 * when the caller omits one. Anchored to block time — never the client clock — because the
 * deadline is enforced on-chain against the hub block timestamp.
 */
const INTENT_DEADLINE_BUFFER_SECONDS = 5 * 60;

/**
 * Budgets for the two secondary reads behind {@link LeverageYieldService.getDetailedStatus}: a
 * polled status read must not inherit the much longer default request budget. Same values and same
 * reasoning as `SwapService`'s pair, which documents it at length — including why the relay leg
 * keeps its own, longer budget instead of sharing this one.
 *
 * Worst case for one call is the sum of its legs, not either number.
 */
const RECONCILE_TIMEOUT_MS = 5_000;
const DETAILED_STATUS_SOLVER_TIMEOUT_MS = 5_000;

/**
 * Where a position's funds came from, and so where a failed intent refunds to.
 *
 * Given as a chain KEY rather than a number: the on-chain field is a SODAX relay chain id (Arbitrum
 * is 23, not 42161), and `getIntentRelayChainId` is the map for that. Asking callers for the raw
 * number invites passing an EVM id, which would route a refund nowhere.
 */
export type PositionOrigin = {
  /** Chain the user funded from and is refunded on. */
  chainKey: SpokeChainKey;
  /** The user's address on `chainKey`. */
  address: string;
  /**
   * Hub asset a cross-chain refund unwraps the reserve into. Required off-hub, since the
   * AssetManager moves only its own registered assets and never vault tokens, and ignored on the
   * hub, where a refund is a plain transfer.
   */
  asset?: Address;
};

/**
 * Funding a position from whichever chain the user actually holds tokens on.
 *
 * Positions live on the hub, but nothing requires the user to. The deposit is relayed to their hub
 * wallet and the position is opened from inside that relayed batch, so the whole thing is one
 * signature on the source chain — and the hub is just another source chain here, not a special case.
 *
 * `token` is a token on `srcChainKey`, in that token's own decimals. Its hub reserve is what the
 * position uses: the collateral for {@link LeverageYieldService.openPosition}, the borrow token for
 * {@link LeverageYieldService.openPositionFromDebtToken}. Wrapping into that reserve is part of the
 * relayed batch, so callers pass the amount they hold, not a vault-share amount.
 */
export type PositionFundingParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  /** The user's address on `srcChainKey`. Funds come from here and a failed intent refunds to here. */
  srcAddress: string;
  /** Token on `srcChainKey` to fund with. */
  token: string;
  /** Amount of `token`, in its own decimals. */
  amount: bigint;
  // No `owner` override: the factory requires `cfg.owner == msg.sender`, and the caller at the factory
  // is always the funder's own hub wallet. Naming anyone else would simply revert — and it used to be
  // a theft path, since the creator also chose the refund address.
  /** AAVE eMode category, fixed for the life of the position. Defaults to 0 (none). */
  eModeCategory?: number;
  /** Slippage floor on the collateral the solver must deliver, in the collateral reserve's units. */
  minCollateralOut: bigint;
  /**
   * Partner fee to bake into the position, percentage variant only. Defaults to the configured
   * `leverageYield.partnerFee`. FIXED AT CREATION on-chain and charged on every later operation, so
   * it must also be fed to {@link projectLeverageLeg} as `feeBps` — the fee is borrowed on top of
   * what the solver is paid, so a projection that ignores it understates LTV.
   */
  partnerFee?: PartnerFee;
};

/** Opening from the collateral side: deposit collateral, borrow against it, swap into more collateral. */
export type OpenPositionParams<K extends SpokeChainKey> = PositionFundingParams<K> & {
  /** Hub reserve to borrow. */
  borrowToken: Address;
  /** Amount to borrow, in `borrowToken`'s units (hub reserves are 18-decimal). */
  borrowAmount: bigint;
};

/**
 * Opening from the debt side: the deposit IS the debt token, and the position ends up long
 * `collateral` without the user ever having held it.
 */
export type OpenPositionFromDebtTokenParams<K extends SpokeChainKey> = PositionFundingParams<K> & {
  /** Hub reserve the position ends up long. */
  collateral: Address;
  /** Total debt token paid to the solver. The hook borrows this minus the deposit's contribution. */
  totalInput: bigint;
};

/**
 * Operating an existing position from any chain. No funds move, so this is a bare message rather
 * than a deposit — the calls execute as the user's hub wallet, which is what the position's
 * `onlyOwner` requires.
 */
declare const positionIntentCall: unique symbol;
declare const positionDirectCall: unique symbol;

/**
 * A position call that POSTS a solver intent, so it must be reported or it expires unfilled.
 *
 * The brand is type-only and erased at runtime; it exists so the compiler refuses the one mistake
 * that costs money — routing a leverage change through the path that does not report it.
 */
export type PositionIntentCall = EvmRawTransaction & { readonly [positionIntentCall]: true };

/** A position call that completes on the hub, with nothing to report. Same brand mechanics. */
export type PositionDirectCall = EvmRawTransaction & { readonly [positionDirectCall]: true };

/**
 * What may ride along in a batch that posts an intent.
 *
 * The brand guards ONE direction. An intent call on the route-only path is never reported and expires
 * unfilled — that has to be refused. A direct call on the reporting path is noise, not damage, and
 * refusing it would take the settle-then-act batch with it: `[buildSettlePosition, buildAddLeverage]`
 * is exactly a direct call riding along, and it is the sequence the batch exists for.
 */
export type PositionBatchCall = PositionIntentCall | PositionDirectCall;

export type PositionOperationParams<K extends SpokeChainKey, C extends EvmRawTransaction = EvmRawTransaction> = {
  srcChainKey: K;
  /** The user's address on `srcChainKey`; its hub wallet is what executes the calls. */
  srcAddress: string;
  /**
   * Calls to run as the hub wallet, from the position builders
   * ({@link LeverageYieldService.buildAddLeverage} and friends). More than one is allowed and they
   * execute in order, which is how a settle-then-act sequence stays atomic.
   */
  calls: readonly C[];
};

/**
 * Why positions refuse a Bitcoin source. Every other spoke resolves its own address, but Bitcoin in
 * TRADING mode pulls from the Bound trading wallet, so the hub wallet must be derived from
 * `getEffectiveWalletAddress` and gated on `ensureRadfiAccessToken` — as `createVaultIntent` does.
 * The position paths do neither, so a deposit would fund a hub wallet the batch does not name.
 */
const BITCOIN_UNSUPPORTED_MESSAGE =
  'Bitcoin is not a supported source chain for leverage positions; use a supported spoke or the hub';

/** Sentinel `solver` address meaning "any solver may fill this intent". */
const ANY_SOLVER_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Dust buffer (vault-asset units, 18 decimals) subtracted from the on-chain `maxWithdraw`
 * returned by {@link LeverageYieldService.getMaxWithdrawForUser}. An asset-denominated
 * ERC-4626 `withdraw(maxWithdraw)` can trip the `withdraw → previewWithdraw` round-up,
 * which asks for `balanceOf + 1` shares and reverts. Trimming a few thousand wei sidesteps
 * that edge case at negligible cost to the user.
 */
const MAX_WITHDRAW_DUST_BUFFER = 1000n;

/**
 * Convert a percentage value (e.g. `3.07` for 3.07%) to RAY (1e27 = 100%) via bigint math.
 * `aprPct * 1e9` stays well within `Number` precision (~2^53), then we bigint-shift by
 * 1e16 to land in RAY units (1% = 1e25, so 3.07% = 3.07e25 = 3.07e9 × 1e16).
 */
function pctToRay(aprPct: number): bigint {
  return BigInt(Math.round(aprPct * 1e9)) * 10n ** 16n;
}

/** Per-attempt timeout (ms) for the DefiLlama APR fetch — bounds a hung endpoint. */
const DEFILLAMA_FETCH_TIMEOUT_MS = 10_000;

/**
 * Max attempts (1 retry) for the DefiLlama APR fetch. Deliberately below the shared
 * `DEFAULT_MAX_RETRY` (3): this is a best-effort read with a hardcoded `fallbackAprPct`, and
 * it runs inside `getEffectiveApr`'s `Promise.all`, so a hung endpoint must not stall the
 * headline APR for long. Caps the worst case at `2 × DEFILLAMA_FETCH_TIMEOUT_MS` + one
 * back-off (~22s) instead of the default ~34s, while still riding out a single transient blip.
 */
const DEFILLAMA_FETCH_MAX_ATTEMPTS = 2;

/**
 * `fetch` with an `AbortController`-backed timeout (mirrors `BackendApiService.makeRequest`).
 * Aborts the request after `timeoutMs` so an unresponsive endpoint can't stall the caller
 * indefinitely — the bare `fetch` has no client-side timeout.
 */
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
 * Fetches the latest APR for a DefiLlama yield pool. DefiLlama's `/chart/<poolId>`
 * endpoint returns the pool's full time series with permissive CORS (`access-control-
 * allow-origin: *`) and a small response (~1 entry/day). The latest entry's `apy` is the
 * compounded yield including any reward tokens — what a depositor actually earns.
 *
 * Hardened against a flaky/hung endpoint: each attempt is bounded by
 * {@link DEFILLAMA_FETCH_TIMEOUT_MS} via {@link fetchWithTimeout}, and the whole thing is
 * wrapped in the shared {@link retry} helper (mirrors `SolverApiService`'s fetch usage),
 * capped at {@link DEFILLAMA_FETCH_MAX_ATTEMPTS} so a hung endpoint can't stall
 * `getEffectiveApr` for long before the caller's `fallbackAprPct` kicks in.
 *
 * Adding a new LSD: find its pool ID via the bulk `/pools` endpoint (filter by symbol +
 * project) and reference it from the vault's `lsdSource.poolId` in `leverageYieldVaults`.
 * No SDK changes needed — DefiLlama aggregates rates across all LSD issuers already.
 *
 * Throws on network/parse error after exhausting retries; the caller swallows it and uses
 * the registry's `fallbackAprPct`.
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

// ─── Param types ──────────────────────────────────────────────────────────

/**
 * Leveraged-position snapshot from the vault's non-standard `getPositionDetails()`.
 * Field scales (mirroring the AAVE conventions the vault inherits):
 */
export type LeverageYieldPosition = {
  /** Collateral supplied to the AAVE pool, in vault-asset units (18 decimals). */
  collateral: bigint;
  /** Variable debt borrowed against the collateral, in vault-asset units (18 decimals). */
  debt: bigint;
  /** Current loan-to-value in basis points (out of `10_000`; e.g. `8_500` = 85%). */
  ltv: bigint;
  /** AAVE health factor in WAD (1e18); below `1e18` implies liquidation risk, `type(uint256).max` = no debt. */
  healthFactor: bigint;
  /** Asset held by the vault but not yet supplied to the pool, in vault-asset units (18 decimals). */
  idleAsset: bigint;
};

/**
 * Output of {@link LeverageYieldService.getApr}. All rate fields are in RAY (1e27 = 100%)
 * matching the AAVE convention — divide by `RAY = 10n ** 27n` for the decimal form.
 *
 * `netAprRay` is the headline number a UI shows: net APR earned by a depositor at the
 * vault's `targetLTV`. It's a STEADY-STATE APR, not realised APY — assumes the AAVE rates
 * stay constant and the vault holds at `targetLTV` continuously. Realised APY in practice
 * depends on tick cadence, rate volatility, and the spread between supplyApr and borrowApr.
 *
 * The math:
 * ```
 * leverageMultiplier = targetLTV / (1 - targetLTV)   // e.g. 0.85 / 0.15 = 5.667x
 * netAprRay = supplyAprRay + leverageMultiplier × (supplyAprRay - borrowAprRay)
 * ```
 * Equivalent to the geometric-series limit of recursive borrow → swap → supply at the
 * vault's target LTV. When `supplyApr > borrowApr` the leverage adds yield; when the
 * spread inverts the loop is a net cost and `netAprRay` goes negative.
 */
export type LeverageYieldApr = {
  /** AAVE supply rate of the vault's `asset` (sodaWEETH-style), in RAY. */
  supplyAprRay: bigint;
  /** AAVE variable borrow rate of the vault's `borrowToken` (sodaETH-style), in RAY. */
  borrowAprRay: bigint;
  /** Target LTV in basis points, as read from `vault.targetLTV()`. */
  targetLtvBps: bigint;
  /**
   * Borrowed multiple of equity (debt ÷ equity) ×1e18, i.e. `targetLTV / (1 - targetLTV)` — e.g.
   * 5.667x is `5_666_666_666_666_666_666n` (integer division truncates). Not total exposure: that is
   * `1 + leverageMultiplier` (= `1 / (1 - targetLTV)`), so a UI "Leverage" label shows the sum.
   * Divide by `10n ** 18n` for the decimal form.
   */
  leverageMultiplierWad: bigint;
  /** Net APR earned by a depositor at `targetLtvBps`, in RAY. Can be negative. */
  netAprRay: bigint;
};

/**
 * Off-chain LSD staking-APR snapshot for a leverage-yield vault's underlying asset.
 * Returned by {@link LeverageYieldService.getLsdApr} and embedded in
 * {@link LeverageYieldEffectiveApr}.
 */
export type LeverageYieldLsdApr = {
  /** LSD staking APR in RAY (1e27 = 100%). Zero when the vault has no configured LSD source. */
  aprRay: bigint;
  /** Human-readable provider label, e.g. `'Lido (stETH)'` (suffixed with `(fallback)` on error). */
  label: string;
  /**
   * `true` when this value came from the hardcoded `fallbackAprPct` rather than a live
   * fetch — either because the provider has no live endpoint (`manual`), the network
   * call failed, or the vault has no LSD source configured. UIs should label the value
   * as an estimate in this state.
   */
  stale: boolean;
};

/**
 * Combined AAVE + LSD APR view — extends {@link LeverageYieldApr} with the LSD staking
 * yield folded into the supply side. Returned by {@link LeverageYieldService.getEffectiveApr}.
 *
 * The `netAprRay` inherited from {@link LeverageYieldApr} is the **AAVE-only** number —
 * the negative-spread case the SDK historically reported. `effectiveNetAprRay` is the
 * honest one for LSD-backed strategies because it includes the LSD's native staking yield,
 * which is the dominant component for these vaults.
 */
export type LeverageYieldEffectiveApr = LeverageYieldApr & {
  /** LSD staking APR snapshot used to compute the effective rates. */
  lsdApr: LeverageYieldLsdApr;
  /** `supplyAprRay + lsdApr.aprRay`, in RAY — the yield the supply side actually earns. */
  effectiveSupplyAprRay: bigint;
  /**
   * `effectiveSupplyAprRay + leverage × (effectiveSupplyAprRay − borrowAprRay)`, in RAY.
   * The headline number a UI should display.
   */
  effectiveNetAprRay: bigint;
};

/**
 * Builds the swap payload for a swap-style leverage-yield deposit — swapping any
 * solver-supported `inputToken` on `srcChainKey` into the vault's lsoda* share token,
 * delivered to the user's hub wallet on Sonic. Spread the result into `swaps.swap()`.
 */
export type LeverageYieldSwapDepositParams = {
  /** Hub-side LeverageYieldVault proxy address — its address doubles as the lsoda* token. */
  vault: Address;
  /** Spoke chain the user holds `inputToken` on and signs from. */
  srcChainKey: SpokeChainKey;
  /** User's EOA on `srcChainKey`. */
  srcAddress: string;
  /** Spoke-side token the user pays in. */
  inputToken: string;
  /** Amount of `inputToken` to swap (input-token decimals). */
  inputAmount: bigint;
  /** Minimum acceptable lsoda* output (18 decimals). Slippage already applied. */
  minOutputAmount: bigint;
  /** Deadline (unix seconds). Defaults to the hub block timestamp + 5 min. */
  deadline?: bigint;
  /** Optional specific solver. `0x0` = any solver. */
  solver?: Address;
  /**
   * Partner fee for this deposit, carried on the payload as the per-intent fee override.
   * Defaults to the effective leverage-yield fee (`config.leverageYieldPartnerFee` = the
   * `leverageYield` override if set, else the global `fee`).
   */
  partnerFee?: PartnerFee;
};

/**
 * Builds the swap payload for a swap-style leverage-yield withdraw — swapping the vault's
 * lsoda* shares (held in the user's hub wallet) back into any solver-supported token on
 * any chain. The payload carries `hubWalletSwap: true`; spread it into `swaps.swap()`,
 * which authorises the hub wallet via `Connection.sendMessage`.
 */
export type LeverageYieldSwapWithdrawParams = {
  /** Hub-side LeverageYieldVault proxy address — its address doubles as the lsoda* token. */
  vault: Address;
  /** Spoke chain the user signs the `sendMessage` from (drives hub-wallet derivation). */
  srcChainKey: SpokeChainKey;
  /** User's EOA on `srcChainKey`. */
  srcAddress: string;
  /** Output chain — where the solver delivers the swapped-back token. */
  dstChainKey: SpokeChainKey;
  /** Output spoke-side token address. */
  outputToken: string;
  /** Amount of lsoda* shares to swap (18 decimals). */
  inputAmount: bigint;
  /** Minimum acceptable output (output-token decimals). Slippage already applied. */
  minOutputAmount: bigint;
  /** Recipient on `dstChainKey`. Defaults to `srcAddress`. */
  recipient?: string;
  /** Deadline (unix seconds). Defaults to the hub block timestamp + 5 min. */
  deadline?: bigint;
  /** Optional specific solver. `0x0` = any solver. */
  solver?: Address;
  /**
   * Partner fee for this withdraw, carried on the payload as the per-intent fee override.
   * Defaults to the effective leverage-yield fee (`config.leverageYieldPartnerFee` = the
   * `leverageYield` override if set, else the global `fee`).
   *
   * A withdraw's input token is the vault itself, so the fee is deducted from `inputAmount`
   * in **lsoda\* shares** — the fee receiver accrues vault shares, not the output token.
   */
  partnerFee?: PartnerFee;
};

/**
 * Params for {@link LeverageYieldService.getQuote}. Superset of `SolverIntentQuoteRequest`
 * with the same per-call fee override the vault intent builders take, so a quote and the
 * intent it sizes can be driven by one value.
 */
export type LeverageYieldQuoteParams = SolverIntentQuoteRequest & {
  /**
   * Per-call fee override. Omit to use the effective leverage-yield fee
   * (`config.leverageYieldPartnerFee`); pass the same value you pass to
   * {@link LeverageYieldService.vaultSwap} when overriding per intent.
   */
  partnerFee?: PartnerFee;
};

/**
 * Action-shaped swap payload built by {@link LeverageYieldService.deposit} /
 * {@link LeverageYieldService.withdraw}. Spread it into
 * {@link LeverageYieldService.vaultSwap} (or {@link LeverageYieldService.createVaultIntent})
 * alongside the wallet provider: `vaultSwap({ ...payload, walletProvider })`.
 * `withdraw` sets `hubWalletSwap: true` so the swap spends the lsoda* held in the
 * user's hub wallet.
 */
export type LeverageYieldSwapPayload = {
  params: CreateIntentParams;
  hubWalletSwap?: true;
  /**
   * Per-intent partner-fee override, set by `deposit` / `withdraw` when the caller supplies one.
   * Absent means the effective leverage-yield fee applies — **both directions are charged**;
   * this key only controls whether that configured fee is overridden for this intent.
   */
  partnerFee?: PartnerFee;
};

/**
 * Per-action extras for a vault swap, supplied via the `extras` slot of the action params.
 * Deliberately smaller than `SwapExtras` / `BridgeExtras`: a vault swap has no Stacks or Bitcoin
 * source variants to key off `K`, so this stays chain-agnostic.
 */
export type LeverageYieldExtras = {
  /**
   * Overrides the configured backend API key for this action's backend submit-tx leg; sent as the
   * `x-api-key` header on both the submit POST and its status polls. Falls back to config when
   * omitted. Has no effect on the client-side relay path, which never calls the backend.
   */
  apiKey?: string;
};

/**
 * Exec-mode params for {@link LeverageYieldService.createVaultIntent} /
 * {@link LeverageYieldService.vaultSwap}: `walletProvider` is required and K-narrowed
 * (`raw: true` returns unsigned tx data instead). The two vault-specific execution
 * modifiers live HERE — on the leverage-yield action wrapper, never on the generic swap
 * surface:
 * - `hubWalletSwap` marks `params.inputToken` as a hub-chain token already sitting in the
 *   user's hub wallet — `srcChainKey` is then the chain the user *signs* on, and the
 *   intent is created by authorising the hub wallet via a `Connection.sendMessage`
 *   instead of a spoke-side AssetManager deposit.
 * - `partnerFee` overrides the effective leverage-yield fee
 *   (`config.leverageYieldPartnerFee`) for this intent only.
 *
 * Both stay intersected here rather than moving into {@link LeverageYieldExtras}, where swap and
 * bridge keep their own `partnerFee`: they are vault *execution* modifiers read by
 * `createVaultIntent`, and relocating them would break every existing caller for no gain.
 */
export type VaultSwapActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateIntentParams<K>,
  LeverageYieldExtras
> & { hubWalletSwap?: boolean; partnerFee?: PartnerFee };

/**
 * Success value of {@link LeverageYieldService.createVaultIntent}. Mirrors the swap
 * domain's `CreateIntentResult` — duplicated deliberately so the leverage-yield surface
 * stands alone.
 */
export type CreateVaultIntentResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;
  intent: Intent & FeeAmount;
  relayData: RelayExtraData;
};

/**
 * Success value of {@link LeverageYieldService.vaultSwap}. Mirrors the swap domain's
 * `SwapResponse` — duplicated deliberately so the leverage-yield surface stands alone.
 */
export type VaultSwapResponse = {
  solverExecutionResponse: SolverExecutionResponse;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
};

export type LeverageYieldApproveParams<R extends boolean> = {
  vault: Address;
  /** Amount of the vault's underlying asset to approve. */
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
 * Treats leverage-yield ERC-4626 vault shares (lsoda* tokens) as solver-tradeable tokens:
 * deposits and withdrawals are intent-based swaps the service executes itself via
 * `vaultSwap()` — the generic swap surface stays untouched by vault concerns.
 *
 * Methods:
 * - `getQuote` — solver quote for a vault deposit/withdraw, sized with the effective
 *   leverage-yield fee so the quote matches what the vault intent will charge.
 * - `deposit` / `withdraw` — build a {@link LeverageYieldSwapPayload} for a swap-style deposit
 *   (any token → lsoda*) and withdraw (lsoda* → any token); spread the result into
 *   `vaultSwap()`. `withdraw` sets `hubWalletSwap: true` so the vault swap spends the lsoda*
 *   held in the user's hub wallet via a `Connection.sendMessage`.
 * - `createVaultIntent` / `vaultSwap` / `notifySolver` — leverage-yield copies of the swap
 *   domain's `createIntent` / `swap()` / `postExecution` (duplicated deliberately — the vault
 *   execution modifiers `hubWalletSwap` and per-intent `partnerFee` live here, not on the swap
 *   domain). `createVaultIntent` submits the intent tx on the source spoke chain; `vaultSwap`
 *   orchestrates the full create → verify → relay → notify-solver lifecycle; `notifySolver` is
 *   the standalone notify step, public so callers driving the relay themselves (after a
 *   `createVaultIntent`) can complete the flow.
 * - `approve` / `isAllowanceValid` — Sonic-direct allowance management for the vault's
 *   underlying asset (sodaWEETH-style).
 * - `getPosition` / `getApr` / `getEffectiveApr` / `getLsdApr` / `getMaxWithdraw` /
 *   `getMaxWithdrawForUser` / `getShareBalance` / `getShareBalanceForUser` /
 *   `getTotalAssets` / `previewDeposit` / `previewWithdraw` / `previewRedeem` — reads.
 *   Use `getEffectiveApr` for the honest LSD-aware APR; `getApr` reports the AAVE-only
 *   spread and goes negative when the LSD's native staking yield is the alpha source.
 * - `listVaults` / `getVault` / `getVaultByAddress` — registry lookups.
 */
export class LeverageYieldService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;
  private readonly backendApi: BackendApiService;

  /**
   * Effective backend submit-tx flow (`leverageYield.useBackendSubmitTx`, default ON; opt out with
   * `false`). Read live off `ConfigService`, like `config.leverageYieldPartnerFee`, so the config
   * object and the behavior can never disagree.
   */
  get useBackendSubmitTx(): boolean {
    return this.config.leverageYieldUseBackendSubmitTx;
  }

  constructor({ hubProvider, config, spoke, backendApi }: LeverageYieldServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
    this.spoke = spoke;
    this.backendApi = backendApi;
  }

  // ─── Registry ──────────────────────────────────────────────────────────

  /** Returns the static registry of known leverage-yield vaults. */
  public listVaults(): readonly LeverageYieldVault[] {
    return this.config.sodaxConfig.leverageYield.vaults;
  }

  /** Looks up a vault by its `name` field. Returns `undefined` when not registered. */
  public getVault(name: string): LeverageYieldVault | undefined {
    return this.listVaults().find(v => v.name === name);
  }

  /**
   * Looks up a registered vault by its on-chain proxy address (case-insensitive).
   * Returns `undefined` when the address isn't in the registry.
   */
  public getVaultByAddress(address: Address): LeverageYieldVault | undefined {
    const normalized = address.toLowerCase();
    return this.listVaults().find(v => v.vault.toLowerCase() === normalized);
  }

  /**
   * Resolves the intent `deadline`: returns the caller-supplied value verbatim, otherwise
   * derives a default from the hub-chain (Sonic) block timestamp plus
   * {@link INTENT_DEADLINE_BUFFER_SECONDS}. The deadline is enforced on-chain against the hub
   * block time, so the default is anchored to that block — never the client clock, which can
   * drift and produce an already-expired or over-extended deadline.
   *
   * Returns a {@link Result}: a `getBlock` RPC outage is a read failure, surfaced as
   * `LOOKUP_FAILED` (`method: 'resolveDeadline'`) rather than masquerading as an intent-build
   * failure. The `deposit` / `withdraw` callers forward it verbatim.
   */
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
   * Quotes a vault deposit or withdraw. Vault shares are solver-tradeable, so this is the
   * generic solver quote with one difference that matters: the fee deducted before quoting is
   * the effective **leverage-yield** fee, matching what {@link LeverageYieldService.createVaultIntent}
   * will charge. `sodax.swaps.getQuote` deducts the effective *swap* fee instead, so quoting a
   * vault flow through it makes the quote and the intent disagree whenever the two feature fees
   * differ. Quoting a vault flow through the swap service can be made to agree — pass the same fee
   * explicitly, using a zero fee (`{ address, percentage: 0 }`) where the effective leverage-yield
   * fee is `undefined`, since an explicit `undefined` there falls back to the swap fee — but this
   * method resolves it for you and is the canonical way to quote a vault flow.
   *
   * Pass the vault address as `token_dst` to quote a deposit, or as `token_src` to quote a
   * withdraw; subtract your slippage tolerance from `quoted_amount` to get `minOutputAmount`.
   * When overriding the fee per intent, pass the same `partnerFee` here and to whichever builder
   * you use ({@link LeverageYieldService.deposit}, {@link LeverageYieldService.withdraw}) or
   * directly to {@link LeverageYieldService.vaultSwap} — omitting it everywhere is equally safe,
   * since each side then resolves the same effective leverage-yield fee. Both directions are
   * charged, so this applies to withdrawals as much as deposits.
   *
   * @returns `SolverIntentQuoteResponse` on success. On failure `result.error` is either the
   *   solver's own `SolverErrorResponse` (no path, insufficient liquidity, …) or a SodaxError
   *   with `VALIDATION_FAILED` (bad `amount`, or a partner fee that leaves nothing to quote),
   *   `LOOKUP_FAILED` (unsupported token — the solver payload could not be assembled) or
   *   `UNKNOWN`. Discriminate with `isSodaxError(error)`.
   */
  public async getQuote(
    payload: LeverageYieldQuoteParams,
  ): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse | LeverageYieldLookupError>> {
    const { partnerFee = this.config.leverageYieldPartnerFee, ...request } = payload;
    // Not `srcChainKey`/`dstChainKey`: on a withdraw quote `token_src_blockchain_id` is the hub,
    // not the chain the user signs on, so reusing those field names would invert their meaning
    // relative to every other method in this service.
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
      // The fee arithmetic below throws bare invariants for a malformed or oversized fee, and the
      // solver throws for a non-positive net amount. Those are caller/config input problems, so
      // assert them here as VALIDATION_FAILED rather than letting them surface as LOOKUP_FAILED.
      if (isPartnerFeeAmount(partnerFee)) {
        leverageYieldInvariant(
          partnerFee.amount < request.amount,
          `partnerFee amount (${partnerFee.amount}) must be less than the quote amount (${request.amount})`,
          { ...baseCtx, field: 'partnerFee' },
        );
      } else if (isPartnerFeePercentage(partnerFee)) {
        // Integer-ness matters beyond the bounds check: `calculatePercentageFeeAmount` does
        // `BigInt(percentage)`, which throws a RangeError on a fractional value that is otherwise
        // inside range (e.g. 0.5).
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
      // `await`, not a bare `return`: SolverApiService.getQuote asserts its own preconditions
      // (unsupported token, unresolvable hub asset) as rejections, and a returned promise would
      // settle outside this try block.
      return await SolverApiService.getQuote(adjustedPayload, this.config.solver, this.config);
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getQuote', error, baseCtx) };
    }
  }

  /**
   * Builds the {@link LeverageYieldSwapPayload} for a leverage-yield deposit (any token → lsoda*).
   * The lsoda* output is delivered to the user's hub wallet on Sonic so a later
   * {@link LeverageYieldService.withdraw} can swap it back. Spread the result into
   * {@link LeverageYieldService.vaultSwap}: `vaultSwap({ ...payload, walletProvider })`.
   * An optional `partnerFee` is forwarded on the payload as the per-intent fee override.
   *
   * For `minOutputAmount`, quote via {@link LeverageYieldService.getQuote} with the vault
   * address as the destination token (`token_dst`), then subtract your slippage tolerance.
   */
  public async deposit(
    params: LeverageYieldSwapDepositParams,
  ): Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'deposit' satisfies LeverageYieldAction };
    try {
      leverageYieldInvariant(params.inputAmount > 0n, 'inputAmount must be greater than 0', {
        ...baseCtx,
        field: 'inputAmount',
      });
      leverageYieldInvariant(params.vault.length > 0, 'Vault address is required', { ...baseCtx, field: 'vault' });
      leverageYieldInvariant(params.inputToken.length > 0, 'inputToken is required', {
        ...baseCtx,
        field: 'inputToken',
      });

      // lsoda* lands in the hub wallet so a later `withdraw` can spend it from there.
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
          // Per-intent fee override — only included when the caller supplies one, so the
          // payload stays free of undefined-valued keys.
          ...(params.partnerFee !== undefined && { partnerFee: params.partnerFee }),
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Builds the {@link LeverageYieldSwapPayload} for a leverage-yield withdraw (lsoda* → any
   * token). The payload carries `hubWalletSwap: true` — {@link LeverageYieldService.vaultSwap}
   * then spends the lsoda* held in the user's hub wallet by authorising it via a
   * `Connection.sendMessage` the user signs on `srcChainKey`. Wrapped in a {@link Result} for
   * a call shape uniform with {@link LeverageYieldService.deposit}; async because the default
   * `deadline` is read from the hub block timestamp.
   *
   * An optional `partnerFee` is forwarded on the payload as the per-intent fee override; omit it
   * and the configured leverage-yield fee applies. Withdrawals **are** charged — the fee comes out
   * of `inputAmount`, which for a withdraw is the vault's own shares, so the receiver accrues
   * lsoda\* rather than the output token.
   *
   * For `minOutputAmount`, quote via {@link LeverageYieldService.getQuote} with the vault
   * address as the source token (`token_src`), then subtract your slippage tolerance.
   */
  public async withdraw(
    params: LeverageYieldSwapWithdrawParams,
  ): Promise<Result<LeverageYieldSwapPayload, LeverageYieldCreateIntentError | LeverageYieldLookupError>> {
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'withdraw' satisfies LeverageYieldAction };
    try {
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
          // Per-intent fee override — only included when the caller supplies one, so the
          // payload stays free of undefined-valued keys (mirrors `deposit`).
          ...(params.partnerFee !== undefined && { partnerFee: params.partnerFee }),
        },
      };
    } catch (error) {
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Creates a vault swap intent on the user's source spoke chain without submitting it to
   * the solver. Leverage-yield copy of the swap domain's `createIntent`, specialised for
   * vault flows — duplicated deliberately so the vault-specific execution modifiers
   * (`hubWalletSwap`, per-intent `partnerFee`) stay off the generic swap surface.
   *
   * Use {@link LeverageYieldService.vaultSwap} for the full end-to-end flow
   * (create → relay → notify solver); use this directly when you need the raw transaction
   * or drive the relay yourself (e.g. the backend submit-tx path). To complete a manual flow,
   * relay the returned `relayData` (the shared `relayTxAndWaitPacket` helper) and then call
   * {@link LeverageYieldService.notifySolver} with the hub-side intent tx hash.
   *
   * @param _params - Intent parameters, source chain key, wallet provider (when `raw: false`),
   *   and optional `skipSimulation` / `hubWalletSwap` / `partnerFee`.
   * @returns A `Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>`.
   *   On success contains:
   *   - `tx` — chain-specific tx hash (executed) or raw tx data (raw mode).
   *   - `intent` — the fully constructed `Intent` object augmented with `feeAmount`.
   *   - `relayData` — `{ address, payload }` needed to submit the intent to the relayer.
   *
   *   On failure `result.error` is a SodaxError with `VALIDATION_FAILED` (invariant
   *   precondition), `INTENT_CREATION_FAILED` (spoke-side creation/deposit failed) or
   *   `UNKNOWN` (defensive fallback).
   */
  public async createVaultIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: VaultSwapActionParams<K, Raw>,
  ): Promise<Result<CreateVaultIntentResult<K, Raw>, LeverageYieldCreateIntentError>> {
    // Per-intent partnerFee override beats the effective leverage-yield fee (per-feature override,
    // else global). undefined = no fee. `swaps.partnerFee` deliberately does NOT apply to vault intents.
    const { params, skipSimulation, hubWalletSwap, partnerFee = this.config.leverageYieldPartnerFee } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };

    try {
      leverageYieldInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        baseCtx,
      );
      // Hub-wallet swap (withdraw): `inputToken` lives on the hub, not on `srcChainKey`
      // (which is the chain the user signs on). Validate it against the hub chain instead.
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
      // A withdraw can deliver BTC: if dstChain is Bitcoin and token is BTC, minOutputAmount
      // must stay above the 546-sat dust limit.
      if (isBitcoinChainKey(params.dstChainKey) && params.outputToken === 'BTC') {
        leverageYieldInvariant(
          params.minOutputAmount >= 546n,
          `Invalid minOutputAmount (params.minOutputAmount): ${params.minOutputAmount}`,
          { ...baseCtx, field: 'minOutputAmount' },
        );
      }
      const personalAddress = params.srcAddress;

      // Bitcoin TRADING mode: use trading wallet for hub wallet derivation (see getEffectiveWalletAddress)
      // NOTE: bitcoin is only enabled in non-raw execution mode == walletProvider is required
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey) && _params.raw === false) {
        leverageYieldInvariant(
          isBitcoinWalletProviderType(_params.walletProvider),
          `Invalid wallet provider for chain key: ${params.srcChainKey}`,
          baseCtx,
        );
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
      }

      // derive users hub wallet address
      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);

      // Hub-wallet swap (withdraw): the lsoda* input already sits in the user's hub wallet.
      // The user signs a `Connection.sendMessage` on their spoke chain (`srcChainKey`)
      // authorising the hub wallet to run the encoded [approve, createIntent] sequence
      // itself — no spoke-side AssetManager deposit. The `vaultSwap()` tail then relays the
      // message and notifies the solver exactly as for a normal spoke-sourced swap.
      if (hubWalletSwap) {
        const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
          { ...params, srcChainKey: hubChainKey, srcAddress: creatorHubWalletAddress },
          creatorHubWalletAddress,
          this.config,
          partnerFee,
        );

        const coreSendMessageParams = {
          srcChainKey: params.srcChainKey,
          // Personal address — NOT the resolved trading `walletAddress`. SpokeService.sendMessage
          // re-resolves the effective (Bitcoin trading) address itself; passing the already-resolved
          // trading address here would double-resolve it (getTradingWallet(tradingAddress) →
          // "Trading wallet not found"). The trading address is used only for the hub-wallet
          // derivation above (creatorHubWalletAddress). Mirrors MoneyMarketService borrow/withdraw.
          srcAddress: personalAddress as GetAddressType<K>,
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
            tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
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

        // on hub chain create intent directly
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

      // construct the intent data
      const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
        {
          ...params,
          srcAddress: walletAddress,
        },
        creatorHubWalletAddress,
        this.config,
        partnerFee,
      );

      const coreDepositParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
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
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          intent: { ...intent, feeAmount } as Intent & FeeAmount,
          relayData: { address: intent.creator, payload: data },
        },
      };
    } catch (error) {
      // leverageYieldInvariant() throws SodaxError<'VALIDATION_FAILED'> directly, so the
      // guard catches validation failures by code membership. Anything else (a hubProvider
      // rejection, deposit throw, etc.) gets wrapped as INTENT_CREATION_FAILED with the
      // original on cause.
      if (isLeverageYieldCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('leverageYield', error, baseCtx),
      };
    }
  }

  /**
   * Executes a full end-to-end leverage-yield vault swap (deposit or withdraw).
   * Leverage-yield copy of the swap domain's `swap()` orchestrator:
   * 1. Calls {@link LeverageYieldService.createVaultIntent} to submit the intent
   *    transaction on the source spoke chain.
   * 2. Verifies the spoke transaction landed on-chain.
   * 3. For non-hub source chains: submits the spoke tx to the relayer and waits for the
   *    relay packet to land on the hub (Sonic). Skipped when `srcChainKey` is the hub.
   * 4. Notifies the solver, triggering it to fill the intent.
   *
   * Spread a {@link LeverageYieldSwapPayload} from `deposit` / `withdraw` into this method
   * alongside the wallet provider: `vaultSwap({ ...payload, walletProvider })`.
   *
   * @returns A `Result<VaultSwapResponse, LeverageYieldSwapError>`. On success:
   *   - `solverExecutionResponse` — solver acknowledgement (`{ answer: 'OK', intent_hash }`).
   *   - `intent` — the on-chain intent object that was created.
   *   - `intentDeliveryInfo` — source/destination chain keys, tx hashes, and user addresses.
   *
   *   On failure `result.error` carries one of the create-intent codes plus
   *   `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`,
   *   `EXECUTION_FAILED`, `EXTERNAL_API_ERROR` or `UNKNOWN`.
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
            // LeverageYieldCreateIntentErrorCode ⊂ LeverageYieldSwapErrorCode by definition.
            return { ok: false, error: createIntentResult.error };
          }

          const created = createIntentResult.value;

          // `timeout` is a PER-ATTEMPT budget, not an end-to-end one: the backend attempt gets it, and if
          // that attempt fails the client-side relay fallback gets a fresh one. Sharing a single deadline
          // would leave the fallback whatever the backend had not spent, which is how a relay that needs
          // longer than the leftovers ends in RELAY_TIMEOUT. Resolved (not just defaulted) so a non-finite
          // caller value cannot reach either budget — see `resolveTimeoutMs`. Mirrors SwapService.swap.
          const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

          // Backend 2-step flow, the default: hand the broadcast intent tx to the leverage-yield API,
          // which relays + post-executes server-side. On ANY non-success we fall back to the
          // client-side relay so the vault swap still completes — safe because re-relay / re-post are
          // idempotent. That fallback is also what makes the ON default cheap for a keyless caller:
          // `POST /leverage-yield/submit-tx` declares an API-key scope, so against a deployment that
          // enforces keys every vault swap spends one rejected attempt here before completing
          // client-side. Set `leverageYield.useBackendSubmitTx: false` to skip it. Swap's submit-tx
          // declares the same scope and has defaulted on since it shipped.
          if (this.useBackendSubmitTx) {
            const submitted = await this.submitTx(_params, created, createSubmitTxAttempt(timeoutMs));
            if (submitted.ok) return submitted;
            this.config.logger.warn(
              '[leverageYield] backend submit-tx did not complete; falling back to the client-side relay',
              { error: submitted.error },
            );
          }

          return this.fallbackVaultSwapSteps(_params, created, timeoutMs);
        } catch (error) {
          // Narrow guard: preserve SodaxErrors whose code is in the vault-swap union; wrap
          // unknown codes (e.g. an accidental cross-feature code) as UNKNOWN.
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
   * Client-side vault-swap completion (the opt-out path, and the fallback): verify the broadcast
   * intent tx landed,
   * relay it to the hub (Sonic) — or use it directly when the source IS the hub — then notify the
   * solver via {@link LeverageYieldService.notifySolver} and build the {@link VaultSwapResponse}.
   * Extracted from `vaultSwap()` so the default backend 2-step path ({@link LeverageYieldService.submitTx})
   * can fall back to it on any non-success. Leverage-yield copy of `SwapService.fallbackSwapSteps`.
   */
  private async fallbackVaultSwapSteps<K extends SpokeChainKey>(
    _params: VaultSwapActionParams<K, false>,
    created: CreateVaultIntentResult<K, false>,
    timeoutMs: number,
  ): Promise<Result<VaultSwapResponse, LeverageYieldSwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'vaultSwap' satisfies LeverageYieldAction };
    const { tx: spokeTxHash, intent, relayData } = created;

    const verifyTxHashResult = await this.spoke.verifyTxHash({
      txHash: spokeTxHash,
      chainKey: srcChainKey,
    });
    if (!verifyTxHashResult.ok) {
      return { ok: false, error: verifyFailed('leverageYield', verifyTxHashResult.error, baseCtx) };
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
        // The caller's full `timeout`, starting HERE — whether this runs as the only path or as the
        // backend's fallback, so a stalled backend attempt cannot shorten the relay wait. The floor
        // covers a sub-floor caller `timeout`: `relayTxAndWaitPacket` SUBMITS before `timeout` bounds
        // anything, so a zero budget would strand an already-landed tx unrelayed.
        timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
      });
      if (!packet.ok) {
        return { ok: false, error: mapRelayFailure(packet.error, { feature: 'leverageYield', ...baseCtx }) };
      }
      dstIntentTxHash = packet.value.dst_tx_hash;
    }

    const postExecResult = await this.notifySolver({
      intent_tx_hash: dstIntentTxHash as `0x${string}`,
    });
    if (!postExecResult.ok) {
      // LeverageYieldPostExecutionErrorCode ⊂ LeverageYieldSwapErrorCode by definition.
      return { ok: false, error: postExecResult.error };
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
   * Backend 2-step vault-swap path (the default; opt out with `leverageYield.useBackendSubmitTx:
   * false`): hand the
   * broadcast intent tx to the leverage-yield API (`POST /leverage-yield/submit-tx`); the backend
   * relays + post-executes server-side. Polls `getSubmitTxStatus` until `solved`, then reconstructs
   * the same {@link VaultSwapResponse} the client-side path returns.
   *
   * Never throws — returns `{ ok: false }` on any non-success (submit `!ok`, a 200 the backend did not
   * accept, terminal `failed` / abandoned, or poll timeout) so `vaultSwap()` falls back to
   * {@link LeverageYieldService.fallbackVaultSwapSteps}. Falling back is safe: re-relaying / re-posting
   * an already-processed vault swap is idempotent (the relay dedups the `executed` packet and the solver
   * re-affirms the intent — no double-fill), and load-bearing rather than belt-and-braces: the backend
   * keeps processing after this attempt gives up, so the fallback's relay can race the backend's own.
   *
   * The attempt itself — POST, budget clamps, status poll — is {@link runBackendSubmitTx}, shared with
   * swaps and bridge. What is leverage-yield-specific and lives here: the request body (including the
   * `operation` discriminator), the `solved` terminal status, the mapping to a
   * {@link VaultSwapResponse}, and the leverage-yield error taxonomy.
   *
   * `attempt` bounds this attempt alone — the POST and every status request draw on it, and the
   * client-side fallback holds a separate fresh `timeout`.
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
          // `withdraw` sets `hubWalletSwap: true` (spends the hub-wallet lsoda*); a plain deposit doesn't.
          operation: _params.hubWalletSwap ? 'withdraw' : 'deposit',
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        // Per-action key wins over the instance one for both legs of the attempt — the submit POST
        // and its status polls. Undefined leaves the configured key in place; the same per-action
        // override `extras.partnerFee` already has, travelling per call.
        overrideConfig: { apiKey: _params.extras?.apiKey },
        // A vault deposit/withdraw IS a solver swap, so terminal success is `solved` — not bridge's
        // `executed`.
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
      // Any non-success — rejected POST, terminal `failed`, spent attempt — becomes the cause
      // vaultSwap() logs before falling back to the client-side relay.
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('leverageYield', outcome.cause, baseCtx) };
    } catch (error) {
      return { ok: false, error: unknownFailed('leverageYield', error, baseCtx) };
    }
  }

  /**
   * Notifies the solver that an intent landed on the hub, triggering it to fill.
   *
   * REQUIRED for anything that creates an intent, not an optimisation. An intent created on the hub
   * is invisible to the solver until this call puts it in the task pool, so an unnotified intent
   * simply expires. Leverage positions post their intents on-chain from the position contract, so
   * the caller that sent the transaction is the only one who can report the hash.
   * Leverage-yield copy of the swap domain's `postExecution` — emits only
   * `EXECUTION_FAILED` / `EXTERNAL_API_ERROR` / `UNKNOWN` (relay/verify codes appear only
   * on {@link LeverageYieldService.vaultSwap}, which owns the verify + relay steps).
   *
   * Called automatically by {@link LeverageYieldService.vaultSwap} after the relay packet
   * lands on the hub. Public so callers who created the intent via
   * {@link LeverageYieldService.createVaultIntent} and relayed it themselves can finish the
   * flow manually.
   *
   * @param request - `{ intent_tx_hash }` — the hub-chain (Sonic) tx hash where the intent
   *   was registered (the relay packet's `dst_tx_hash`, or the spoke tx hash for hub-sourced
   *   intents).
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

      // Defensive: SolverApiService is contractually typed to return SolverErrorResponse,
      // but a malformed upstream payload would otherwise surface as a cryptic
      // "Cannot read properties of undefined" caught below. Fall back to a synthetic detail
      // so the canonical SodaxError carries enough context for forensics.
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
      // Narrow guard: only preserve SodaxErrors whose code is in the post-execution union.
      if (isLeverageYieldPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('leverageYield', error, { phase: 'postExecution' }) };
    }
  }

  /**
   * Polls the solver for the execution status of an intent this service created.
   *
   * Pair with {@link LeverageYieldService.notifySolver}: `notifySolver` puts the intent in the
   * solver's task pool, this reports what became of it. `fill_tx_hash` is set only once
   * `status === SolverIntentStatusCode.SOLVED`.
   *
   * A `NOT_FOUND` status usually means the notification never landed rather than that the intent
   * does not exist — an intent created on the hub is invisible to the solver until it is told.
   *
   * Reports the solver verbatim. It does NOT reconcile a `NOT_FOUND` against the backend's durable
   * record the way {@link LeverageYieldService.getDetailedStatus} does — a restarted solver answers
   * `NOT_FOUND` for intents it already filled, and that read resolves it. Keeping this one
   * unreconciled is deliberate: it has shipped with this contract, and folding the reconcile in
   * would turn a `NOT_FOUND` behind an unreadable backend into an error for every existing caller.
   * Prefer `getDetailedStatus` when you hold the source tx hash.
   *
   * @param request - `{ intent_tx_hash }` — the hub-chain (Sonic) tx hash the intent was
   *   registered in. For a position that is the tx that called the factory or the position.
   */
  public async getIntentStatus(
    request: SolverIntentStatusRequest,
  ): Promise<Result<SolverIntentStatusResponse, LeverageYieldPostExecutionError>> {
    try {
      // Unbounded and unreconciled: a one-shot read a caller budgets however it likes, returning
      // exactly what the solver said. `getDetailedStatus` is the polled, reconciling sibling.
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

  /**
   * The raw solver read, in the solver's own vocabulary. Both public status surfaces start here; the
   * api key is the 5th argument, and leaving it out let a keyed partner notify and then fail to poll.
   */
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
   * {@link LeverageYieldService.solverStatus} plus the durable-record reconcile, for
   * {@link LeverageYieldService.getDetailedStatus}. Deliberately not shared with
   * {@link LeverageYieldService.getIntentStatus}: the reconcile turns a `NOT_FOUND` behind an
   * unreadable backend into an error, which is right for a polled read that would otherwise spend a
   * budget on an unverified miss, and wrong to impose on a surface that already ships without it.
   *
   * `timeoutMs` bounds the solver request alone. The reconcile carries its own
   * {@link RECONCILE_TIMEOUT_MS}, so a bounded call can cost both.
   */
  private async resolveSolverStatus(
    request: SolverIntentStatusRequest,
    timeoutMs?: number,
    apiKey?: string,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    const solverResult = await this.solverStatus(request, timeoutMs, apiKey);
    const forgotten = !solverResult.ok || solverResult.value.status === SolverIntentStatusCode.NOT_FOUND;
    if (!forgotten) return solverResult;

    // The solver keeps intent state in memory, so a restart makes it answer NOT_FOUND for intents it
    // already filled. The backend's record is durable, and a vault intent is in it: `createVaultIntent`
    // goes through the same `EvmSolverService.constructCreateIntentData` as a swap, so it lands on the
    // same hub Intents contract and the same `IntentCreated` / `IntentFilled` events feed the journal
    // this endpoint reads. A read that *completes* without terminal fill evidence leaves the solver's
    // answer standing; a read that could not complete proves nothing — see below.
    //
    // A fill event is not by itself proof of completion: an intent created with `allowPartialFill`
    // emits one per fill while input remains. Only a fill that consumed the remainder settles the
    // whole intent. Clamp rather than override, since a per-call timeout *replaces* the configured
    // one and would otherwise lengthen the request for a consumer who configured something stricter.
    const timeout = Math.min(RECONCILE_TIMEOUT_MS, this.backendApi.requestTimeoutMs);
    // The override keys this leg too — a third request, on the data API rather than the leverage-yield
    // one, and whether that deployment checks a key must not be assumed here. No `|| this.config.apiKey`
    // as on the solver leg: `BackendApiService` bakes the instance key into its headers, and an empty
    // string sends no header at all, so both fall back on their own.
    const intent = await this.backendApi.getIntentByTxHash(request.intent_tx_hash, { timeout, apiKey });
    const settled = intent.ok
      ? intent.value.events.filter(isFillEvent).find(fill => fill.intentState.remainingInput === '0')
      : undefined;
    if (settled) return { ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: settled.txHash } };

    // Same reading as `getDetailedStatus`: a record — or a 404, which is the backend saying it has
    // none — answers the question, so the solver's NOT_FOUND stands and a caller may budget it. A
    // 5xx, a transport failure or an unusable body does not: the fill may exist and simply be
    // unreadable right now. Reporting NOT_FOUND there lets a poller spend a miss it never verified.
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

    // Either the backend answered, or the solver's own error is the better diagnostic to return.
    return solverResult;
  }

  /**
   * Reads a vault swap's status from its source-chain transaction — the identifier a caller always
   * holds after `vaultSwap()`.
   *
   * **Routes; does not translate.** Returns the backend submit-tx record while it is in play,
   * otherwise the solver's answer via the hub tx hash resolved from the relay packet. The result is
   * tagged with `source` (discriminate on it) and carries that source's payload unmodified.
   *
   * `sodax.api.leverageYield.getSubmitTxStatus` cannot answer for every vault swap. Sometimes there
   * is no record — `useBackendSubmitTx: false`, or the submit was rejected. More often the record
   * exists but is stale: the backend path POSTs first and falls back to the client-side relay once
   * that stalls, so a fallback-completed vault swap leaves behind whatever state the backend last
   * reached, including a record it abandoned outright.
   *
   * **Any** unusable backend response routes to the solver — a 404, a transport or server error, or
   * a record the backend gave up on. A rejected API key is the exception: it is not a source with
   * nothing to say, it is a configuration problem only a corrected key resolves, so routing it on
   * would bury it behind a relay or solver error and leave a poller retrying a request that cannot
   * succeed. The same rule the swap and bridge siblings apply. It holds here even though
   * `GET /leverage-yield/submit-tx/status` declares no scope of its own: whether a key is checked
   * is a per-deployment setting, so this must not assume the read is unauthenticated.
   *
   * A point-in-time read; poll it yourself, or use dapp-kit's `useLeverageYieldDetailedStatus`.
   *
   * @param params - `srcChainKey` and `srcTxHash` of the source-chain vault-swap transaction.
   * @param config - Optional per-request override. Its `apiKey` reaches every keyed leg — the
   *   submit-tx record read, the solver read, and the durable-intent read a solver `NOT_FOUND` falls
   *   back to — so one override keys the whole call. The relay leg is unauthenticated and takes none.
   * @returns A `Result` containing a {@link DetailedLeverageYieldStatus}. Fails with `LOOKUP_FAILED`
   *   when no source can answer yet. Branch on `error.context.reason`:
   *   `DETAILED_STATUS_NOT_DELIVERED` is the ambiguous miss a caller should bound with a retry
   *   budget; anything else is a dependency failing right now, so keep retrying.
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

      // `success: false` is the wire contract's "no record found", whatever `data` carries — `ok`
      // only proves the request and schema succeeded.
      if (record.ok && record.value.success && !isBackendSubmitTxAbandoned(record.value.data)) {
        return { ok: true, value: { source: 'backend', data: record.value.data } };
      }

      // Surfaced directly, with its status lifted so `isAuthFailure` recognises the wrapped error.
      if (!record.ok && isSodaxError(record.error) && isAuthFailure(record.error)) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(record.error, params.srcChainKey, {
            status: record.error.context?.status,
          }),
        };
      }

      // Did the backend *answer*? A record — even `success: false`, even abandoned — and a 404 are
      // both definitive "nothing usable here". A 5xx or a transport failure is not: behind one we
      // cannot tell a vault swap that will never resolve from a live one whose record we simply
      // could not read. So a relay miss that follows an outage must stay an unbudgeted dependency
      // failure, or a backend outage would stop the caller polling something still progressing.
      const backendAnswered = record.ok || (isSodaxError(record.error) && record.error.context?.status === 404);

      const dstTxHash = await this.resolveHubTxHash(params, backendAnswered);
      if (!dstTxHash.ok) return dstTxHash;

      // `this.resolveSolverStatus`, not `SolverApiService.getStatus` — the durable-intent reconcile
      // on solver NOT_FOUND stays in one place. Bounded, because this read is polled.
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

  /**
   * The hub-chain tx hash the solver is keyed on. A hub-source vault swap has no relay leg — the
   * source tx *is* the hub tx. Otherwise the delivered relay packet carries it, so an undelivered
   * packet is simply "no hash yet".
   */
  private async resolveHubTxHash(
    key: DetailedLeverageYieldStatusKey,
    backendAnswered: boolean,
  ): Promise<Result<Hex, LeverageYieldDetailedStatusError>> {
    let hubTxHash: string = key.srcTxHash;

    if (!isHubChainKeyType(key.srcChainKey)) {
      const delivered = await resolveDeliveredPacket({
        srcChainKey: key.srcChainKey,
        srcTxHash: key.srcTxHash,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        backendAnswered,
      });
      if (!delivered.ok) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(delivered.cause, key.srcChainKey, {
            reason: delivered.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
          }),
        };
      }
      hubTxHash = delivered.packet.dst_tx_hash;
    }

    // Validate rather than cast — this hash reaches the solver next.
    if (isHex(hubTxHash)) return { ok: true, value: hubTxHash };
    return {
      ok: false,
      error: this.detailedStatusLookupFailed(
        new Error(`hub tx hash is not a hex string: ${hubTxHash}`),
        key.srcChainKey,
      ),
    };
  }

  /**
   * `reason` is set only for {@link DETAILED_STATUS_NOT_DELIVERED} — the miss a caller can bound
   * with a retry budget. Leaving it off marks a dependency that is failing right now, which a
   * caller should keep retrying rather than give up on. `status` is lifted for a rejected key so
   * `isAuthFailure` recognises the wrapped error; it reads `context.status` and does not walk the
   * cause chain.
   */
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

  /**
   * Approves the vault's underlying asset to the leverage vault on Sonic. For callers
   * interacting with the vault directly on the hub — the swap-style {@link
   * LeverageYieldService.deposit} flow handles its own approvals.
   */
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

      // Route through SpokeService rather than calling Erc20Service directly, so a stale allowance
      // on a USDT-class asset is reset before the approve instead of dead-ending.
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

  /**
   * Reads on-chain allowance of the vault's underlying asset for `owner → vault`. Returns
   * `true` when the allowance covers `amount`. Use before a direct
   * {@link LeverageYieldService.deposit}.
   */
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

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** ERC-4626 `asset()` of the vault — the sodaWEETH-style underlying. */
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

  /** Reads the vault's leveraged position snapshot via the non-standard `getPositionDetails`. */
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

  /**
   * Computes the steady-state APR of a leverage-yield vault from the AAVE supply/borrow
   * rates of its asset and borrowToken, scaled by the vault's target leverage. Matches the
   * convention used by leveraged-LSD vaults (Origami, Gearbox, etc.) — assumes constant
   * LTV at `targetLTV` and constant AAVE rates.
   *
   * Returns raw fields in RAY (1e27, AAVE's native rate scale) plus the leverage multiplier
   * in WAD (1e18). See {@link LeverageYieldApr} for the formula and caveats.
   */
  public async getApr(vault: Address): Promise<Result<LeverageYieldApr, LeverageYieldLookupError>> {
    try {
      // Read vault metadata in parallel — pool, both rate-bearing tokens, target LTV.
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

      // Now read the AAVE reserve rates for both tokens in parallel.
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

      // Leverage multiplier in WAD (1e18): targetLTV / (1 - targetLTV).
      // Guard against the pathological targetLTV ≥ 100% case — would imply infinite leverage.
      const BPS = 10_000n;
      const WAD = 1_000_000_000_000_000_000n; // 1e18, explicit so TS infers `bigint`
      leverageYieldInvariant(targetLtvBps < BPS, `targetLTV (${targetLtvBps}) must be < 100% (10_000 bps)`, {
        method: 'getApr',
        field: 'targetLtvBps',
      });
      const leverageMultiplierWad = (targetLtvBps * WAD) / (BPS - targetLtvBps);

      // netApr = supplyApr + leverage × (supplyApr - borrowApr). Use signed bigint math
      // so the negative-spread case (borrow > supply at high leverage) underflows correctly.
      // Multiply first to preserve precision, then divide by WAD to unwind the leverage scale.
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
   * Off-chain LSD staking-APR for the vault's underlying asset. Looks the vault up in the
   * registry, hits DefiLlama's per-pool chart endpoint for the configured `poolId`, and on
   * any fetch failure returns the registry's hardcoded `fallbackAprPct` with `stale: true`.
   *
   * Always resolves to `{ ok: true, ... }` for a known vault — the fallback path replaces
   * the error, since a missing LSD APR shouldn't break the parent call. Returns
   * `{ aprRay: 0n, stale: true, label: 'no LSD source' }` for vaults without an
   * `lsdSource` configured (non-LSD strategies); callers can treat that as "skip LSD".
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
        // Best-effort: a live-APR fetch failure must not break the parent call, so we fall
        // back to the registry's hardcoded rate — but surface it via the configured logger
        // so the stale value is observable rather than silently swallowed.
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

  /**
   * Combined view of {@link getApr} + {@link getLsdApr}: re-applies the vault's leverage
   * formula with the LSD's native staking yield folded into the supply side, exposing the
   * **effective** net APR that LSD-backed strategies actually earn. The AAVE-only
   * `netAprRay` is preserved on the return value for callers who want to display both.
   *
   *   effectiveSupply = supplyAprRay + lsdApr.aprRay
   *   effectiveNet    = effectiveSupply + leverage × (effectiveSupply − borrowAprRay)
   *
   * Fetches AAVE rates and the LSD APR in parallel for one round-trip's worth of latency.
   */
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

  /** Synchronously withdrawable assets for `owner` (clamped against leverage HF floor). */
  public async getMaxWithdraw(vault: Address, owner: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getMaxWithdraw(vault, owner, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getMaxWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Total underlying assets currently held by the vault (vault-asset units, 18 decimals) — TVL. */
  public async getTotalAssets(vault: Address): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.getTotalAssets(vault, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'getTotalAssets', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Shares minted for a given asset deposit. */
  public async previewDeposit(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewDeposit(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewDeposit', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Shares burned for a given asset withdrawal. */
  public async previewWithdraw(vault: Address, assets: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewWithdraw(vault, assets, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewWithdraw', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Assets received for a given share redemption. */
  public async previewRedeem(vault: Address, shares: bigint): Promise<Result<bigint, LeverageYieldLookupError>> {
    const inner = await Erc4626Service.previewRedeem(vault, shares, this.hubProvider.publicClient);
    if (!inner.ok) return { ok: false, error: lookupFailed('leverageYield', 'previewRedeem', inner.error) };
    return { ok: true, value: inner.value };
  }

  /** Vault shares held by `owner`. */
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

  /**
   * Convenience: resolves the user's hub wallet from `(srcChainKey, srcAddress)` and
   * returns its on-chain `maxWithdraw`, less {@link MAX_WITHDRAW_DUST_BUFFER}. The trim
   * keeps the value safe for an asset-denominated ERC-4626 `withdraw` — the raw
   * `maxWithdraw` can trip the round-up that asks for one more share than the user holds.
   */
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

  /**
   * Convenience: resolves the user's hub wallet from `(srcChainKey, srcAddress)` and
   * returns its on-chain share balance.
   */
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

  // ─── Leverage positions ────────────────────────────────────────────────

  /**
   * Resolves the `LeveragePositionFactory` address, or a validation error when it is missing.
   *
   * The deployed factory ships in `leverageYieldConfig`, so this only fails when an integrator
   * overrides it with an empty value — which is what a bad env var produces. Failing closed there is
   * deliberate: a placeholder address would post real intents at nothing.
   */
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

  /** Position clones owned by `owner`, in creation order. Empty when the owner has none. */
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

  /**
   * Positions belonging to a user, resolved by their spoke-side address rather than a hub address.
   *
   * Positions are owned by the user's hub wallet, so discovery goes through
   * `getUserHubWalletAddress` — which returns the wallet router for a Sonic user and the
   * cross-chain wallet for a spoke user, so the same call works on every chain. Prefer this over
   * `listPositions` in user-facing code; passing a raw EOA finds nothing.
   */
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

  /** Static descriptor of a position — owner, both legs, and the fixed eMode category. */
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
          // From the position, not from config: config can change and an open can override it, so
          // what a NEW position would carry is not what THIS one does.
          feeBps: Number(feeBps),
          feeReceiver,
        },
      };
    } catch (error) {
      if (isLeverageYieldLookupError(error)) return { ok: false, error };
      return { ok: false, error: lookupFailed('leverageYield', 'getPositionInfo', error) };
    }
  }

  /**
   * Live AAVE account snapshot for a position. Read from the pool, not the position: the
   * position contract keeps no accounting of its own, so collateral, debt and health factor
   * all come from `getUserAccountData`.
   *
   * The pool comes from `moneyMarket.lendingPool` config rather than the position's own
   * `pool()` getter — same address, one fewer round trip, and it keeps the deployment address
   * sourced from config like the rest of the SDK.
   */
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
   * The position's collateral holding, as an exact aToken balance.
   *
   * Needed to size a full exit. {@link LeverageYieldService.getPositionAccount} reports collateral
   * in the oracle's base currency at 8 decimals, which is fine to display but cannot name an amount:
   * dividing it back out by a price lands near the balance, and a `decreaseLeverage` asking for more
   * collateral than the position holds does not fail on submission — the hook's `transferFrom`
   * reverts at fill time, so the intent silently expires instead.
   *
   * Safe to act on a slightly stale read: aToken balances only grow, since interest accrues into
   * them, so a value from a few blocks ago is always still spendable. Selling it leaves interest
   * dust behind rather than coming up short.
   *
   * @param collateral The position's collateral reserve. Read from the position when omitted; pass
   *        it if you already hold a {@link LeveragePosition} to save the round trip.
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
   * The position's operation slot: which operation it recorded, and whether that intent is still
   * live on `Intents`.
   *
   * Both are needed, because the interesting state is when they disagree. `isLive` false with a
   * non-zero `kind` means the intent resolved — filled, expired, or cancelled by someone else — but
   * the position has not been told, so its grant is still open and any debt-side contribution is
   * still sitting there. That is what `needsSettle` flags, and `buildSettlePosition` clears. A live
   * intent instead blocks any second operation until it resolves.
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

  /** Deterministic clone address for the next position a given creator opens for `owner`. */
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

  // ─── Position transaction builders ─────────────────────────────────────
  //
  // Positions are driven by direct Sonic calls, not intents, so these return raw transactions
  // for the caller to sign with a hub wallet provider. The leverage and deleverage calls only
  // *post* an intent — a solver fills it afterwards, so poll `getPositionPendingState`
  // rather than treating the receipt as completion.

  /**
   * Opens a new position and requests leverage on it in the same transaction — the standard way
   * to open a leveraged position: one approve, then this.
   *
   * `initialAssets` of `collateral` is pulled from the signer, so the factory needs an allowance
   * first. Control is assigned to `owner`, which may differ from the signer — pass a user's hub
   * wallet address to have the existing cross-chain path drive the position.
   *
   * The leverage is still asynchronous: this posts the intent and a solver fills it afterwards,
   * so on confirmation the position is funded with the request outstanding, not yet levered. If
   * no solver fills it, `buildCancelPositionOperation` returns the deposit to the owner.
   */
  /**
   * Turns a {@link PositionOrigin} into the tuple the factory takes, and refuses the combinations the
   * contract would refuse anyway — better a rejected build than a transaction that reverts.
   */
  private resolveOrigin(
    origin: PositionOrigin,
    method: string,
  ): Result<{ chainId: bigint; address: Hex; asset: Address }, LeverageYieldLookupError> {
    // Unmapped keys come back undefined rather than throwing, and the failure then surfaces from
    // inside viem as "Cannot convert undefined to a BigInt" — say what is actually wrong instead.
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
        // The chain's own encoding, not a 0x-prefixed string. `originAddress` is `bytes` on-chain and
        // is handed to the AssetManager as the refund destination, so a Solana or Stellar address has
        // to arrive in the form that chain's spoke expects — prefixing `0x` would produce a refund
        // address that is merely well-formed hex. EVM addresses pass through unchanged.
        address: encodeAddress(origin.chainKey, origin.address),
        // Named on the hub as well, not just off it. The asset decides what a cancellation pays back,
        // and zeroing it here is why someone who funded with USSD was refunded `sodaUSSD`. Callers pass
        // the asset only when a wrap actually happened — when the reserve IS what was deposited there is
        // nothing to unwrap and `address(0)` is the correct answer.
        asset: (origin.asset ?? zeroAddress) as Address,
      },
    };
  }

  /**
   * Partner fee for a position, in the shape `PositionConfig` takes.
   *
   * Only the PERCENTAGE variant of `PartnerFee` maps: the contract stores basis points and derives
   * the amount per operation (`_feeFor`), so a fixed-amount fee has nowhere to go and is rejected
   * rather than silently dropped. Same precedence as the vault flows — per-call, then
   * `leverageYield.partnerFee`, then none.
   *
   * The fee is FIXED AT CREATION on-chain, so this is read when a position is created and never
   * again; changing the config later does not re-price positions already open.
   */
  /**
   * The fee a position created NOW would carry, in basis points, plus who receives it.
   *
   * Public because a caller cannot project a position correctly without it and cannot derive it:
   * the fee resolves from `leverageYield.partnerFee`, then the global fee, then none, and it is
   * FIXED AT CREATION on-chain. Feed `feeBps` to {@link projectLeverageLeg} — the hooks require
   * `inputAmount + fee`, so a leverage-up borrows the fee ON TOP of what the solver is paid. Leaving
   * it out understates LTV and overstates the ceiling, which is the Aave `'36'` failure at fill time
   * this module exists to prevent: 50 bp takes a debt-side ceiling from 9.88x to about 9.44x.
   *
   * Pass the same `override` here as to the open call, or omit it on both.
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
    // `LeveragePosition.initialize` rejects a half-configured fee: a rate with no receiver is
    // borrowed for and paid to nobody, a receiver with no rate is never paid.
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

  /** A hub transaction. Every builder below produces this shape and none of them sends value. */
  // Generic so a builder's declared return type applies its own brand. The cast is the single one
  // the pattern needs — a brand is type-only and erased at runtime — and keeping it here means no
  // builder carries one of its own.
  private hubTx<T extends EvmRawTransaction = EvmRawTransaction>(from: Address, to: Address, data: Hex): T {
    return { from, to, value: 0n, data } as T;
  }

  /**
   * The `PositionConfig` struct both factory entry points take, assembled from a resolved origin.
   *
   * Shared so the two create paths cannot drift: which side the funded reserve goes on is their only
   * real difference, and a field silently spelled differently in one of them would be a
   * mis-recorded refund destination rather than a compile error.
   */
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
   * Opens a levered position starting from the **debt** token, with no collateral of your own.
   *
   * Pulls `contribution` of `borrowToken` from the signer — not the collateral. On fill the hook
   * supplies the solver's collateral, adds the contribution, borrows `totalInput - contribution`,
   * and pays the solver the total, so a holder of the debt asset lands in a levered collateral
   * position having never owned collateral. Requires the deployment's implementation to have a
   * debt-side hook configured; otherwise the position reverts with `DebtSideHookUnavailable`.
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

  /** Borrows `borrowAmount` and swaps it into more collateral. `minCollateralOut` is the slippage floor. */
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
   * Gives up `collateralIn` of collateral to repay debt. `minDebtOut` is the slippage floor.
   *
   * CLOSING INTO THE DEBT TOKEN is this call with the position's collateral balance, less the fee a
   * non-zero `feeBps` gives up on top of the input (`balance x 10_000 / (10_000 + feeBps)`) — there is
   * no separate close entry point, because selling everything is the same operation as selling part.
   * Size it with {@link LeverageYieldService.getPositionCollateralBalance}, never off
   * `totalCollateralBase`, and quote the full amount so `minDebtOut` reflects what the solver will
   * actually pay for all of it.
   *
   * What that leaves behind is worth knowing. The solver delivers more debt token than is owed, so
   * the hook repays the debt and hands the surplus to the position, which is the owner's equity now
   * denominated in the debt asset. It sits in the position until someone calls
   * {@link LeverageYieldService.buildSettlePosition} — that sweep is what actually delivers it, and
   * it goes to the position's `owner` (the hub wallet), not to whoever signed. Exiting into the
   * *collateral* instead means repaying only the debt and then calling
   * {@link LeverageYieldService.buildPositionWithdraw}, which can pay out to any address.
   */
  public buildDecreaseLeverage(params: {
    from: Address;
    position: Address;
    collateralIn: bigint;
    minDebtOut: bigint;
    /**
     * Underlying a surplus is delivered in, straight to the owner's own address on their origin chain.
     * Only a full close produces a surplus, so this is ignored on a partial deleverage. Omit — or pass
     * the zero address — to leave any surplus in the position for `buildSettlePosition` to sweep, which
     * hands over the reserve rather than the token.
     */
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

  /**
   * Withdraws collateral out of the position. The pool rejects a withdrawal that would drop
   * the position below its liquidation threshold, so no client-side health check is applied
   * here — but note that bound is health factor 1, not a safety buffer above it.
   */
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
   * Clears an operation that has already resolved and returns anything the position is holding
   * loose to its owner.
   *
   * PERMISSIONLESS, and deliberately so: it only ever tightens state, so a stranded balance can be
   * pushed back by anyone rather than waiting on the owner to notice. That matters because an intent
   * can be cancelled by a third party once past its deadline, which leaves the position resolved but
   * un-swept if the hook's notification did not land.
   *
   * Reverts while the intent is still live — use {@link LeverageYieldService.buildCancelPositionOperation}
   * to end one that has not resolved yet.
   */
  public buildSettlePosition(params: { from: Address; position: Address }): PositionDirectCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({ abi: leveragePositionAbi, functionName: 'settle' }),
    );
  }

  /**
   * Cancels the in-flight operation and returns the deposit.
   *
   * Nothing is escrowed when an intent is posted, so cancelling recovers nothing by itself — but
   * a position carrying no debt withdraws its whole collateral balance back to the owner, which
   * is what a leveraged open whose intent never filled needs. With debt outstanding the
   * collateral stays put: the pool would reject the withdrawal on its health-factor check.
   */
  public buildCancelPositionOperation(params: { from: Address; position: Address }): PositionDirectCall {
    return this.hubTx(
      params.from,
      params.position,
      encodeFunctionData({ abi: leveragePositionAbi, functionName: 'cancel' }),
    );
  }

  // ─── Positions from any chain ──────────────────────────────────────────
  //
  // The builders above produce a transaction sent straight to the hub. That only works for a user
  // signing on the hub, and even there it has to be routed so `msg.sender` is their hub wallet —
  // a position's `onlyOwner` is that wallet, and an EOA cannot send as another address.
  //
  // These take over from there: the calls are encoded as a hub-wallet payload and carried by the
  // spoke transport, which routes them locally on the hub and relays them from anywhere else. So one
  // code path covers every chain, and the hub is not a special case.

  /**
   * Encodes position calls as a hub-wallet payload.
   *
   * Takes the raw transactions from the builders above and produces the `(address,uint256,bytes)[]`
   * payload the hub wallet executes. Public because that payload is the unit the transport takes:
   * pass it to `spoke.deposit` / `spoke.sendMessage` yourself when you want manual relay control,
   * or use {@link LeverageYieldService.openPosition} / {@link LeverageYieldService.operatePosition},
   * which do it for you.
   */
  public encodePositionCalls(txs: readonly EvmRawTransaction[]): Hex {
    return encodeContractCalls(
      txs.map(tx => ({ address: tx.to as Address, value: tx.value ?? 0n, data: tx.data }) satisfies EvmContractCall),
    );
  }

  /**
   * Resolves the hub reserve a spoke token funds, and the hub asset it arrives as.
   *
   * Three addresses per token and they are not interchangeable: `hubAsset` is what lands in the hub
   * wallet, `vault` is the 18-decimal money-market reserve a position actually uses, and the spoke
   * `address` is neither. Getting this wrong is silent — the wrong one is still a valid ERC-20.
   */
  private resolveFunding(
    srcChainKey: SpokeChainKey,
    token: string,
    method: string,
  ): Result<{ hubAsset: Address; vault: Address; decimals: number }, LeverageYieldLookupError> {
    // Two lookups, because on the hub the token a user holds IS the hub asset. The spoke-original
    // lookup is the right one off-hub, but on the hub it is both indirect and unreliable — the live
    // registry's Sonic sUSDS entry carries an Arbitrum address, which has no code on Sonic, so a
    // deposit keyed on it would revert. Falling back to the hub-asset lookup takes the address the
    // user actually holds at face value.
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

  /**
   * What a refund should pay back: the asset the user actually funded with, or `undefined` when that IS
   * the reserve and there is nothing to unwrap.
   *
   * A named asset makes `IntentRefund` unwrap before paying, on the hub as well as off it — so someone
   * who deposited USSD is refunded USSD rather than `sodaUSSD`.
   */
  private refundAsset(funding: { hubAsset: Address; vault: Address }): Address | undefined {
    return funding.hubAsset.toLowerCase() === funding.vault.toLowerCase() ? undefined : funding.hubAsset;
  }

  /**
   * Encodes the wrap of an arriving deposit into its money-market reserve, and returns the reserve
   * amount that produces.
   *
   * A hub asset that is already a soda vault token IS the reserve, so nothing is wrapped. Otherwise
   * the vault mints 18-decimal shares one-for-one with the asset, which is what
   * `translateIncomingDecimals` computes — the same conversion the asset manager applies to a spoke
   * deposit, rather than a second implementation of it. A reserve carrying a non-zero deposit fee
   * would mint fewer shares than this predicts and the factory's pull would revert; both reserves in
   * use today are fee-free.
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

  /**
   * Everything both opens do before they diverge: resolve the factory, the funding token's hub asset
   * and reserve, and the origin to refund to; predict the address the position will be created at;
   * and encode the wrap plus the transfer that funds it.
   *
   * Only the factory call itself differs between the collateral side and the debt side — which side
   * the funded reserve lands on, and the two amounts — so everything up to that point lives here
   * once. `calls` is returned ready to be appended to.
   */
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
    // Creator and owner are the same hub wallet — the factory requires it.
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
   * Hub-side payload for opening a position from the collateral side.
   *
   * Wrap the arriving deposit into its reserve, TRANSFER it to the address the position will be
   * created at, create the position and post its leverage intent — one batch, executed by the user's
   * hub wallet. The position's collateral is the reserve behind `params.token`; `borrowToken` is
   * borrowed against it.
   *
   * Nothing is ever approved to the factory: it holds no allowance and pulls from nobody, so funding
   * is a transfer to `predictPosition(creator, owner, nextPositionIdFor(owner))` and the clone supplies
   * whatever it finds. The id is per-owner, so an unrelated user creating a position cannot move the
   * address out from under this batch — and because the transfer and the create are in the same batch,
   * a stale prediction reverts both rather than stranding the tokens.
   *
   * The owner's OWN concurrent opens are the one thing that can still advance the id between building
   * this payload and executing it. On the hub that reverts atomically and nothing is lost; funded from
   * a spoke the deposit has already landed in the user's hub wallet when the batch reverts, and is
   * recovered with `sodax.recovery` (see RECOVERY.md). Do not open two positions for one owner at once.
   *
   * The origin recorded on the position is `srcChainKey` / `srcAddress` / the deposited hub asset,
   * so a leverage intent that never fills refunds to the user on the chain they funded from — not to
   * the position, and not to the hub wallet.
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

  /**
   * Hub-side payload for opening a position from the debt side.
   *
   * The mirror of {@link LeverageYieldService.buildOpenPositionData}: here the deposit is the
   * position's *debt* token, contributed rather than supplied, and `collateral` is the reserve the
   * position ends up long. The hook supplies the solver's collateral on fill and borrows only the
   * shortfall, so the position legitimately starts with no collateral of its own.
   */
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
            // The deposited token IS the debt side, so its reserve is the borrow token.
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

  /**
   * Whether the funding token is already approved for an open from `srcChainKey`.
   *
   * The spender differs by chain and neither choice is guessable: on the hub the deposit is pulled
   * by the user's own hub wallet, executing inside the routed batch; on an EVM spoke it is pulled by
   * that spoke's asset manager. Chains with no allowance concept report `true`, and Stellar reports
   * whether the trustline covers the amount.
   */
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

  /**
   * Approves the funding token for an open, against the spender that chain's deposit actually uses —
   * see {@link LeverageYieldService.isPositionFundingAllowanceValid} for which that is.
   *
   * WAITS FOR THE APPROVAL TO LAND before returning. `Erc20Service.approve` resolves with the hash the
   * moment it is broadcast, so a caller that immediately re-reads the allowance sees the value from
   * BEFORE the approval — a UI then keeps showing "approve" and the user signs a second, pointless
   * approval. Returning early from a helper whose whole purpose is "the allowance is now sufficient" is
   * a footgun, so the wait lives here rather than in each caller.
   */
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

      /**
       * Wait for it to land. `spoke.verifyTxHash` is NOT enough on its own: it waits for Solana, NEAR,
       * Stellar, Sui and Stacks, but on an EVM chain it falls through to `{ ok: true }` without
       * waiting — so on the hub, where this is used most, it returned instantly and the caller's next
       * allowance read still saw the pre-approval value. That was the second signature.
       *
       * An EVM wallet provider exposes the receipt wait directly, so use it there and fall back to
       * `verifyTxHash` for the chains it genuinely covers. Narrowed on the provider's own `chainType`
       * discriminant via `isEvmWalletProviderType` rather than sniffing for the method: duck-typing
       * would also match any future non-EVM provider that happens to grow one.
       */
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

  /**
   * Who pulls the deposit on an EVM source chain.
   *
   * On the hub the pull happens inside the routed batch, so the spender is the user's own hub wallet
   * rather than any protocol contract; on an EVM spoke it is that spoke's asset manager. Chains with
   * no ERC-20 allowance never reach here.
   */
  private async resolveFundingSpender(
    srcChainKey: HubChainKey | EvmSpokeOnlyChainKey,
    srcAddress: string,
  ): Promise<Address> {
    if (isHubChainKeyType(srcChainKey)) return await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);
    return this.config.getChainConfig(srcChainKey).addresses.assetManager;
  }

  /**
   * Opens a leveraged position, funded from any chain, in one signature.
   *
   * The deposit is carried to the user's hub wallet and the position is created from inside that
   * same batch, so there is no window in which the funds sit on the hub unattached to a position.
   * On the hub this routes locally; from a spoke it relays and this waits for the hub side to land.
   *
   * WHAT IS AND IS NOT DONE WHEN THIS RESOLVES: the position exists and its leverage intent is
   * posted. The leverage itself is not applied — a solver fills that intent afterwards. And an
   * intent is invisible to the solver until its hub transaction hash is reported, so pass the
   * returned `dstChainTxHash` to {@link LeverageYieldService.notifySolver}; an unreported intent
   * simply expires and the deposit comes back.
   *
   * Spoke tokens need the spoke asset manager approved first, the same as any other deposit.
   *
   * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN. Every path here has been exercised
   *              end to end on Sonic, the hub. From a spoke the inbound half is proven only by a fork
   *              replay of a real relayed message, and the OUTBOUND half — an exit or a cancellation
   *              delivering the underlying back to the spoke it came from — has never run on mainnet.
   *              Treat a non-hub `srcChainKey` as experimental until it has. Bitcoin is refused
   *              outright — see {@link BITCOIN_UNSUPPORTED_MESSAGE}.
   */
  public async openPosition<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, OpenPositionParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>> {
    return this.runPositionOpen(_params, 'openPosition', (owner, params) =>
      this.buildOpenPositionData({ ...params, owner }),
    );
  }

  /**
   * Opens a leveraged position from the **debt** token, funded from any chain.
   *
   * Same transport and the same asynchronous settlement as
   * {@link LeverageYieldService.openPosition} — see there for what is and is not done when this
   * resolves. The difference is only which side the user funds: here they hand over debt token and
   * end up long collateral they never held.
   *
   * Requires the deployed implementation to have a debt-side hook configured; without one the
   * position reverts `DebtSideHookUnavailable`.
   *
   * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN. Every path here has been exercised
   *              end to end on Sonic, the hub. From a spoke the inbound half is proven only by a fork
   *              replay of a real relayed message, and the OUTBOUND half — an exit or a cancellation
   *              delivering the underlying back to the spoke it came from — has never run on mainnet.
   *              Treat a non-hub `srcChainKey` as experimental until it has. Bitcoin is refused
   *              outright — see {@link BITCOIN_UNSUPPORTED_MESSAGE}.
   */
  public async openPositionFromDebtToken<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError | LeverageYieldLookupError>> {
    return this.runPositionOpen(_params, 'openPositionFromDebtToken', (owner, params) =>
      this.buildOpenPositionFromDebtTokenData({ ...params, owner }),
    );
  }

  /**
   * Shared body of the two open paths. They differ only in which factory call the payload ends with,
   * so everything around it — owner resolution, deposit, verify, relay — lives here rather than
   * being written twice and drifting.
   */
  /**
   * Instrumentation for both opens. Wrapping the shared runner rather than each entry point keeps
   * `openPosition` and `openPositionFromDebtToken` from drifting, and `action` is already threaded
   * through for the error context, so it doubles as the analytics action.
   *
   * `start` carries only the fields common to both param shapes — the funding side's token and
   * amount. The side-specific ones (`borrowToken`/`borrowAmount` vs `collateral`/`totalInput`) are
   * not on `PositionFundingParams`, and inventing a cast to reach them would be worse than omitting
   * them.
   */
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
      // Bitcoin is not supported: the position paths derive the hub wallet from the personal address,
      // where TRADING mode requires the effective (trading) one — so fail before any funds move.
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), BITCOIN_UNSUPPORTED_MESSAGE, {
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

      // The deposit lands in this wallet, the position is created from inside it, and it is what the
      // factory sees as `msg.sender` — so it is payer, creator and owner at once. There is no choice to
      // make here, which is the point: the factory rejects any other owner.
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const data = await buildData(hubWallet, params);
      if (!data.ok) return data;

      const txResult = await this.spoke.deposit({
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
   * Which address actually funds a position from `chainKey` — what a balance must be read against,
   * and what the deposit is built from.
   *
   * ONE ANSWER FOR BOTH, because two answers cost an open on mainnet: the balance was read from the
   * registry `address` while the deposit rewrote it to `hubAsset`, so for Sonic's native S the form
   * showed 42 S and the batch then called `wS.transferFrom(user, hubWallet, 5e18)` against a wS
   * balance of zero. The approval was correct; the revert surfaced as nothing but "External call
   * failed". Any integrator reading a balance for a position deposit needs this same answer.
   *
   * Three addresses hang off a registry entry and they are not interchangeable:
   *
   *   `address`   the spoke-side original; for a bridged entry it can name another chain entirely
   *   `hubAsset`  what the user holds ON THE HUB, and the vault's deposit input
   *   `vault`     the hub money-market reserve the position ends up in
   *
   * Off the hub the answer is always `address` — that is the chain the user is on. On the hub it is
   * `hubAsset`, EXCEPT for a native entry: `EvmSpokeService.deposit` keys on the chain's own
   * `nativeToken` to send `msg.value` rather than an ERC-20 `transferFrom`, and the native entry
   * carries exactly that sentinel as its `address`. Rewriting that to the wrapper asks for a token
   * the wallet does not hold.
   *
   * @returns The funding address, or `undefined` when the token is not supported on `chainKey`.
   */
  public resolvePositionFunding(chainKey: SpokeChainKey, token: XToken): Address | undefined {
    const address = resolvePositionFundingAddress(chainKey, this.hubProvider.chainConfig.chain.key, token);
    return address === '' ? undefined : (address as Address);
  }

  /**
   * Quotes one leg of a position operation: the borrowed side when levering up, the collateral when
   * levering down or exiting.
   *
   * Use this rather than {@link LeverageYieldService.getQuote} for a position. Both hit the same
   * endpoint, but this one names the hub reserves as the pair the intent actually swaps and quotes
   * GROSS — see `positionLegQuote.ts` for why either alone gets the floor wrong. Feed `quotedAmount`
   * to {@link projectLeverageLeg}.
   *
   * A refusal is not always a dead pair: {@link isNoRouteRefusal} is also what the solver answers
   * for a leg that is only too small, and telling the two apart means quoting again at a healthy
   * notional. That size is priced, so it is the caller's to choose.
   */
  public async getPositionLegQuote(params: {
    /** Hub reserve given up. */
    inputHubToken: Address;
    /** Hub reserve expected back. */
    outputHubToken: Address;
    /** Input amount in `inputHubToken`'s units. */
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
      // Explicit, not omitted: omitting it applies the configured leverage-yield fee.
      partnerFee: { address: zeroAddress, percentage: 0 },
    });
    if (!quote.ok) return quote;
    return { ok: true, value: { quotedAmount: quote.value.quoted_amount } };
  }

  /**
   * Opens a leveraged position AND reports the intent it posts. Prefer this to
   * {@link LeverageYieldService.openPosition} / {@link LeverageYieldService.openPositionFromDebtToken}.
   *
   * Those two only post the intent. Reporting it is a separate call that must not be skipped — an
   * unreported intent expires unfilled, so the owner is left funded with leverage that never arrives
   * and nothing said so. Pairing them here is the difference between an API that works and one that
   * works only if you read the docs.
   *
   * `side` picks which asset funds the open: `'collateral'` supplies the deposit and borrows against
   * it, `'debt'` hands the deposit to the solver and ends up long collateral never held.
   *
   * RESOLVING MEANS THE INTENT IS LIVE, not that the position is open, and a failed notification is
   * still `ok: true` — see {@link LeveragePositionIntentResult}.
   *
   * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN — see `operatePosition`.
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
   * Runs position calls that POST A SOLVER INTENT — `addLeverage` and `decreaseLeverage` — and
   * reports it. Prefer this to {@link LeverageYieldService.operatePosition} for those two.
   *
   * USE {@link LeverageYieldService.runLeveragePositionOperation} FOR `withdraw`, `settle` AND
   * `cancel`. Those are synchronous on the hub and need no notification, and the split is not
   * cosmetic: sending a leverage change through the route-only path leaves an intent nothing will
   * fill, and it expires without a word. The other direction is merely noisy.
   *
   * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN — see `operatePosition`.
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
   * Runs position calls that do NOT post an intent — `withdraw`, `settle` and `cancel` — as the
   * owning hub wallet. They are synchronous on the hub, so resolving means the work is done.
   *
   * Still routed, never sent directly: the position's `onlyOwner` is the hub wallet, so a builder's
   * transaction sent from the signer reverts `NotOwner`. Use
   * {@link LeverageYieldService.submitLeveragePositionIntent} for `addLeverage` and
   * `decreaseLeverage`, which this deliberately does not report.
   *
   * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN, and this path carries the worst of
   *              it: an exit or cancellation delivering the underlying back to the spoke it came from
   *              has never run on mainnet.
   */
  public async runLeveragePositionOperation<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, PositionOperationParams<K, PositionDirectCall>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    return this.operatePosition(_params);
  }

  /** Bound once so the notify half can be handed around without losing `this`. */
  private readonly notifyIntent: PositionIntentNotifier = request => this.notifySolver(request);

  /**
   * Runs position calls as the user's hub wallet, from any chain.
   *
   * The write counterpart to the read hooks: add or decrease leverage, withdraw, settle, cancel. No
   * funds move, so this is a bare message rather than a deposit — on the hub it routes locally, from
   * a spoke it relays and this waits for the hub side to land.
   *
   * The leverage calls only *post* an intent, so a resolved promise means the intent is live, not
   * that leverage moved. Report the returned `dstChainTxHash` to
   * {@link LeverageYieldService.notifySolver} for those two; `withdraw`, `settle` and `cancel` are
   * synchronous on the hub and need no notification.
   *
   * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN. Every path here has been exercised
   *              end to end on Sonic, the hub. From a spoke the inbound half is proven only by a fork
   *              replay of a real relayed message, and the OUTBOUND half — an exit or a cancellation
   *              delivering the underlying back to the spoke it came from — has never run on mainnet.
   *              Treat a non-hub `srcChainKey` as experimental until it has. Bitcoin is refused
   *              outright — see {@link BITCOIN_UNSUPPORTED_MESSAGE}.
   */
  public async operatePosition<K extends SpokeChainKey>(
    _params: SpokeExecActionParams<K, false, PositionOperationParams<K>>,
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    return this.config.analytics.trackResult(
      'leverageYield',
      'operatePosition',
      () => this.executePositionOperation(_params),
      {
        // The calls themselves are not emitted — they are arbitrary hub calldata. The count is
        // enough to tell a batched adjust from a single write.
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
      // Bitcoin is not supported: the position paths derive the hub wallet from the personal address,
      // where TRADING mode requires the effective (trading) one — so fail before any funds move.
      leverageYieldInvariant(!isBitcoinChainKeyType(params.srcChainKey), BITCOIN_UNSUPPORTED_MESSAGE, {
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

      const txResult = await this.spoke.sendMessage({
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

  /**
   * Verifies a submitted source transaction and, off the hub, relays it and waits for the hub side.
   *
   * Shared by both write paths because the tail is identical whether funds moved or not. The hub
   * short-circuit is not an optimisation: a hub transaction has already executed the calls, so there
   * is nothing to relay, and both hashes are the same transaction.
   */
  private async settleHubWalletMessage<K extends SpokeChainKey>(
    srcTxHash: TxReturnType<K, false>,
    relayData: RelayExtraData,
    baseCtx: { srcChainKey: K; action: LeverageYieldAction },
    opts: { timeout: number },
  ): Promise<Result<TxHashPair, LeverageYieldSwapError>> {
    const verify = await this.spoke.verifyTxHash({ txHash: srcTxHash, chainKey: baseCtx.srcChainKey });
    if (!verify.ok) return { ok: false, error: verifyFailed('leverageYield', verify.error, baseCtx) };

    if (isHubChainKeyType(baseCtx.srcChainKey)) {
      /**
       * WAIT FOR IT, and check it succeeded. `verifyTxHash` above does not: on an EVM chain it
       * returns `{ ok: true }` without waiting, so returning here on its word reported a merely
       * BROADCAST transaction as a landed one. A caller then notified the solver about an intent
       * that might not exist yet, or treated a reverted operation as complete. The same gap was
       * already patched in `approvePositionFunding`; this is the other half of it.
       *
       * Waited on the hub's own public client rather than a wallet provider: the hub transaction is
       * on Sonic whoever signed it, and the relay branch below needs no equivalent because the
       * packet it waits for cannot exist unless the hub side landed.
       */
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
