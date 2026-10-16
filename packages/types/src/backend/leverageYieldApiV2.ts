// Backend Leverage Yield API v2 — request/response contract types.
//
// One type per request/response of every endpoint of the backend
// `leverage-yield-api` controller. This is the leverage-yield counterpart to the
// Swaps API v2 contract in `./backendApiV2.ts`, and follows the same conventions:
// - Outbound (response) types are pure JSON — every bigint-derived value (amounts,
//   deadlines, APR rays, share balances, position figures) is a decimal `string`,
//   because JSON cannot represent `bigint` (the one typed exception is the unsigned
//   `tx` on the create-intent/approve responses, reused from the swaps contract).
// - Inbound (request) types mirror the server's parsed DTOs: the Intent struct
//   (`IntentRequestV2`) carries `bigint`; the other request numeric fields
//   (amounts/deadlines) are decimal `string`.
// - `Hex` / `Address` / `Hash` / `SpokeChainKey` are plain `string` everywhere.
//
// Leverage-yield deposits and withdrawals ARE intent-based swaps (the vault's lsoda*
// share token is treated as a solver-tradeable token — see `LeverageYieldService`),
// so the entire intent-relay lifecycle — the Intent struct, relay extra-data,
// submit-tx, status, cancel, hash, packet, gas estimate, and fee shapes — is
// IDENTICAL to the swaps contract. Rather than re-declare those wire shapes and risk
// drift, this file REUSES them from `./backendApiV2.ts` and defines ONLY the
// leverage-yield-specific pieces: the vault registry/read shapes and the
// deposit/withdraw create-intent (and quote) bodies. This mirrors how the Config API
// v2 section reuses the canonical config types instead of re-declaring a parallel tree.

import type {
  AllowanceCheckResponseV2,
  ApproveResponseV2,
  CancelIntentRequestV2,
  CancelIntentResponseV2,
  CreateIntentResponseV2,
  DeadlineQueryV2,
  DeadlineResponseV2,
  FeeQueryV2,
  FeeResponseV2,
  GasEstimateRequestV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  IntentExtraDataRequestV2,
  IntentExtraDataResponseV2,
  IntentHashRequestV2,
  IntentHashResponseV2,
  IntentPacketRequestV2,
  IntentPacketResponseV2,
  IntentStateV2,
  PartnerFeeV2,
  QuoteQueryV2,
  QuoteResponseV2,
  QuoteTypeV2,
  StatusRequestV2,
  StatusResponseV2,
  SubmitIntentRequestV2,
  SubmitIntentResponseV2,
  SubmitTxRequestV2,
  SubmitTxResponseV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
} from './backendApiV2.js';

// ──────────────────────────────────────────────────────────────────────
// Vault registry — GET /leverage-yield/vaults · GET /leverage-yield/vaults/:name
// ──────────────────────────────────────────────────────────────────────

/**
 * JSON-safe mirror of the SDK `LeverageYieldLsdSource` — the off-chain LSD staking-APR source
 * on a vault descriptor. Plain primitives (no branded addresses), matching the swaps-domain
 * `SwapTokenV2` projection style rather than reusing the branded config type.
 */
export interface LsdSourceV2 {
  /** DefiLlama pool ID (UUID) for the LSD's staking pool. */
  poolId: string;
  /** Hardcoded APR (percentage, e.g. `3.2` for 3.2%) used when the DefiLlama fetch errors. */
  fallbackAprPct: number;
  /** Human label for UI display, e.g. `'Lido (stETH)'`. */
  label: string;
}

/**
 * A deployed leverage-yield vault descriptor (`LeverageYieldVault` projected to JSON primitives —
 * addresses as plain `string`, mirroring {@link LsdSourceV2}). Static descriptor for vault
 * discovery and UI display.
 */
export interface LeverageVaultV2 {
  /** Stable lookup key — the leverage-vault share-token symbol (e.g. `lsodaWEETH`). */
  name: string;
  /** Deployed `LeverageYieldVault` proxy address on the Sonic hub. */
  vault: string;
  /** The vault's underlying asset on the hub (a Sodax vault-token wrapper, e.g. sodaWEETH). */
  asset: string;
  /** The token the vault borrows against `asset` collateral (a Sodax vault-token wrapper, e.g. sodaETH). */
  borrowToken: string;
  /** LSD staking-APR source for the underlying asset; omitted for non-LSD vaults. */
  lsdSource?: LsdSourceV2;
}

/** GET /leverage-yield/vaults — the registry of deployed leverage-yield vaults. */
export type GetLeverageVaultsResponseV2 = readonly LeverageVaultV2[];

/** GET /leverage-yield/vaults/:name — a single vault descriptor by its lsoda* share-token name. */
export type GetLeverageVaultResponseV2 = LeverageVaultV2;

// ──────────────────────────────────────────────────────────────────────
// Shared read query shapes
// ──────────────────────────────────────────────────────────────────────

/** Query identifying a single vault by its hub proxy address. Used by the read endpoints below. */
export interface VaultQueryV2 {
  /** Hub-side `LeverageYieldVault` proxy address (its address doubles as the lsoda* token). */
  vault: string;
}

/** Query identifying a vault plus an owner address. Used by share-balance / max-withdraw. */
export interface VaultOwnerQueryV2 extends VaultQueryV2 {
  /** Owner (hub wallet) address whose vault shares are inspected. */
  owner: string;
}

/** Query identifying a vault plus an `assets` amount (vault-asset units, decimal string). */
export interface VaultAssetsQueryV2 extends VaultQueryV2 {
  /** Amount of the vault's underlying asset in smallest unit (18 decimals, decimal string). */
  assets: string;
}

/** Query identifying a vault plus a `shares` amount (lsoda* units, decimal string). */
export interface VaultSharesQueryV2 extends VaultQueryV2 {
  /** Amount of vault shares (lsoda*) in smallest unit (18 decimals, decimal string). */
  shares: string;
}

// ──────────────────────────────────────────────────────────────────────
// Vault reads — asset / position / APR / totals / previews / balances
// ──────────────────────────────────────────────────────────────────────

/** GET /leverage-yield/asset — the vault's underlying hub asset (Sodax vault-token wrapper). */
export interface VaultAssetResponseV2 {
  /** Underlying asset address on the hub (e.g. sodaWEETH). */
  asset: string;
}

/**
 * GET /leverage-yield/position — leveraged-position snapshot. JSON-safe mirror of the SDK
 * `LeverageYieldPosition`; every bigint field is a decimal `string`.
 */
export interface LeverageYieldPositionV2 {
  /** Collateral supplied to the AAVE pool, in vault-asset units (18 decimals, decimal string). */
  collateral: string;
  /** Variable debt borrowed against the collateral, in vault-asset units (18 decimals, decimal string). */
  debt: string;
  /** Current loan-to-value in basis points (out of `10000`; e.g. `"8500"` = 85%). */
  ltv: string;
  /** AAVE health factor in WAD (1e18); below `"1000000000000000000"` implies liquidation risk (decimal string). */
  healthFactor: string;
  /** Asset held by the vault but not yet supplied to the pool, in vault-asset units (18 decimals, decimal string). */
  idleAsset: string;
}

/**
 * GET /leverage-yield/apr — AAVE-only steady-state APR. JSON-safe mirror of the SDK
 * `LeverageYieldApr`; every rate is in RAY (1e27 = 100%) as a decimal `string`.
 */
export interface LeverageYieldAprV2 {
  /** AAVE supply rate of the vault's `asset`, in RAY (decimal string). */
  supplyAprRay: string;
  /** AAVE variable borrow rate of the vault's `borrowToken`, in RAY (decimal string). */
  borrowAprRay: string;
  /** Target LTV in basis points, as read from `vault.targetLTV()` (decimal string). */
  targetLtvBps: string;
  /** Leverage multiplier ×1e18 (divide by 1e18 for the decimal form; decimal string). */
  leverageMultiplierWad: string;
  /** Net APR earned by a depositor at `targetLtvBps`, in RAY. Can be negative (decimal string). */
  netAprRay: string;
}

/**
 * GET /leverage-yield/apr/lsd — off-chain LSD staking-APR snapshot. JSON-safe mirror of the
 * SDK `LeverageYieldLsdApr` (`aprRay` bigint → decimal string).
 */
export interface LeverageYieldLsdAprV2 {
  /** LSD staking APR in RAY (1e27 = 100%). `"0"` when the vault has no configured LSD source (decimal string). */
  aprRay: string;
  /** Human-readable provider label, e.g. `'Lido (stETH)'` (suffixed with `(fallback)` on error). */
  label: string;
  /** `true` when the value came from the hardcoded fallback rather than a live fetch — UIs should mark it an estimate. */
  stale: boolean;
}

/**
 * GET /leverage-yield/apr/effective — combined AAVE + LSD APR view. JSON-safe mirror of the
 * SDK `LeverageYieldEffectiveApr`: extends {@link LeverageYieldAprV2} with the LSD staking
 * yield folded into the supply side. `effectiveNetAprRay` is the honest headline number.
 */
export interface LeverageYieldEffectiveAprV2 extends LeverageYieldAprV2 {
  /** LSD staking APR snapshot used to compute the effective rates. */
  lsdApr: LeverageYieldLsdAprV2;
  /** `supplyAprRay + lsdApr.aprRay`, in RAY — the yield the supply side actually earns (decimal string). */
  effectiveSupplyAprRay: string;
  /** `effectiveSupplyAprRay + leverage × (effectiveSupplyAprRay − borrowAprRay)`, in RAY. The headline number (decimal string). */
  effectiveNetAprRay: string;
}

/** GET /leverage-yield/total-assets — total assets managed by the vault. */
export interface VaultTotalAssetsResponseV2 {
  /** Total vault assets in smallest unit (18 decimals, decimal string). */
  totalAssets: string;
}

/** GET /leverage-yield/preview/deposit — shares minted for a given `assets` deposit (ERC-4626 `previewDeposit`). */
export interface PreviewDepositResponseV2 {
  /** Vault shares (lsoda*) that would be minted, in smallest unit (18 decimals, decimal string). */
  shares: string;
}

/** GET /leverage-yield/preview/withdraw — shares burned to withdraw a given `assets` amount (ERC-4626 `previewWithdraw`). */
export interface PreviewWithdrawResponseV2 {
  /** Vault shares (lsoda*) that would be burned, in smallest unit (18 decimals, decimal string). */
  shares: string;
}

/** GET /leverage-yield/preview/redeem — assets returned for redeeming a given `shares` amount (ERC-4626 `previewRedeem`). */
export interface PreviewRedeemResponseV2 {
  /** Underlying asset returned, in smallest unit (18 decimals, decimal string). */
  assets: string;
}

/** GET /leverage-yield/share-balance — an owner's vault share (lsoda*) balance. */
export interface ShareBalanceResponseV2 {
  /** Vault shares (lsoda*) held by the owner, in smallest unit (18 decimals, decimal string). */
  balance: string;
}

/**
 * GET /leverage-yield/max-withdraw — an owner's RAW ERC-4626 `maxWithdraw`, NOT dust-trimmed. Fed straight
 * into an asset-denominated withdraw it can trip the vault's share round-up and revert, so a "MAX" flow
 * should apply its own margin (the SDK-local `getMaxWithdrawForUser` subtracts `MAX_WITHDRAW_DUST_BUFFER`
 * for exactly that reason).
 */
export interface MaxWithdrawResponseV2 {
  /** Maximum withdrawable underlying asset, in smallest unit (18 decimals, decimal string). Raw, no dust margin. */
  maxWithdraw: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /leverage-yield/quote/deposit · POST /leverage-yield/quote/withdraw
// ──────────────────────────────────────────────────────────────────────

/**
 * POST /leverage-yield/quote/deposit — request body. Quotes a swap-style deposit: any
 * solver-supported `tokenSrc` on `tokenSrcChainKey` → the vault's lsoda* share token,
 * returning the expected shares in {@link QuoteResponseV2.quotedAmount}.
 */
export interface LeverageYieldDepositQuoteRequestV2 {
  /** Hub-side `LeverageYieldVault` proxy address (target vault). */
  vault: string;
  /** Source token address the user pays in, on the source spoke chain. */
  tokenSrc: string;
  /** Source spoke chain key (SODAX SpokeChainKey). */
  tokenSrcChainKey: string;
  /** Input amount in smallest unit of the source token (decimal string). */
  amount: string;
  /** Quote type (only `exact_input` is supported). */
  quoteType: QuoteTypeV2;
  /** Per-request partner-fee override; defaults to the backend's configured leverage-yield fee. */
  partnerFee?: PartnerFeeV2;
  /** Source address — required only when `includeTxData=true`; ignored otherwise. */
  srcAddress?: string;
}

/**
 * POST /leverage-yield/quote/withdraw — request body. Quotes a swap-style withdraw: the
 * vault's lsoda* shares → any solver-supported `tokenDst` on `tokenDstChainKey`, returning
 * the expected output in {@link QuoteResponseV2.quotedAmount}.
 *
 * Deliberately carries no `partnerFee`, unlike the deposit quote: the backend applies its configured
 * leverage-yield fee to withdraws (deducted from the lsoda* input) and rejects unknown body fields, so
 * a per-request override is not part of the wire contract.
 */
export interface LeverageYieldWithdrawQuoteRequestV2 {
  /** Hub-side `LeverageYieldVault` proxy address (source vault). */
  vault: string;
  /** Spoke chain the user signs the withdraw from — drives hub-wallet derivation and the `includeTxData` tx shape (SODAX SpokeChainKey). */
  srcChainKey: string;
  /** Destination token address the user receives, on the destination spoke chain. */
  tokenDst: string;
  /** Destination spoke chain key (SODAX SpokeChainKey). */
  tokenDstChainKey: string;
  /** Amount of vault shares (lsoda*) to withdraw, in smallest unit (18 decimals, decimal string). */
  amount: string;
  /** Quote type (only `exact_input` is supported). */
  quoteType: QuoteTypeV2;
  /** Source address — required only when `includeTxData=true`; ignored otherwise. */
  srcAddress?: string;
  /** Recipient address on `tokenDstChainKey` — required only when `includeTxData=true`; ignored otherwise. */
  dstAddress?: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /leverage-yield/allowance/check · POST /leverage-yield/approve
// POST /leverage-yield/intents/deposit
// (all three share the CreateDepositIntentParamsV2 request body, mirroring swaps)
// ──────────────────────────────────────────────────────────────────────

/**
 * Shared request body for `/leverage-yield/allowance/check`, `/leverage-yield/approve`, and
 * `/leverage-yield/intents/deposit`. Builds a swap-style deposit: any solver-supported
 * `inputToken` on `srcChainKey` → the vault's lsoda* share token, delivered to the user's
 * hub wallet on Sonic. JSON-safe mirror of the SDK `LeverageYieldSwapDepositParams`.
 */
export interface CreateDepositIntentParamsV2 {
  /** Hub-side `LeverageYieldVault` proxy address (its address doubles as the lsoda* token). */
  vault: string;
  /** Source spoke chain the user holds `inputToken` on and signs from (SODAX SpokeChainKey). */
  srcChainKey: string;
  /** User's address on `srcChainKey` (chain-specific format). */
  srcAddress: string;
  /** Spoke-side token the user pays in. */
  inputToken: string;
  /** Amount of `inputToken` to swap, in smallest unit of the input token (decimal string). */
  inputAmount: string;
  /** Minimum acceptable lsoda* output in smallest unit (18 decimals, decimal string). Slippage already applied. */
  minOutputAmount: string;
  /** Unix timestamp (seconds) at which the intent expires; `"0"` for no expiry. Defaults to hub block time + 5 min (decimal string). */
  deadline?: string;
  /** Solver address (EVM hub address). Defaults to the zero address for "any solver". */
  solver?: string;
  /** Per-intent partner-fee override; defaults to the effective leverage-yield/swap fee. */
  partnerFee?: PartnerFeeV2;
}

/**
 * POST /leverage-yield/intents/withdraw — request body. Builds a swap-style withdraw: the
 * vault's lsoda* shares (held in the user's hub wallet) → any solver-supported `outputToken`
 * on `dstChainKey`. The backend sets `hubWalletSwap` internally so the swap spends the lsoda*
 * held in the user's hub wallet. JSON-safe mirror of the SDK `LeverageYieldSwapWithdrawParams`
 * minus its `partnerFee`: the backend applies its configured leverage-yield fee to withdraws
 * (deducted from the lsoda* input) and rejects unknown body fields, so there is no per-intent
 * override on the wire.
 */
export interface CreateWithdrawIntentParamsV2 {
  /** Hub-side `LeverageYieldVault` proxy address (its address doubles as the lsoda* token). */
  vault: string;
  /** Spoke chain the user signs the withdraw from — drives hub-wallet derivation (SODAX SpokeChainKey). */
  srcChainKey: string;
  /** User's address on `srcChainKey` (chain-specific format). */
  srcAddress: string;
  /** Destination spoke chain where the solver delivers the swapped-back token (SODAX SpokeChainKey). */
  dstChainKey: string;
  /** Output spoke-side token address on `dstChainKey`. */
  outputToken: string;
  /** Amount of lsoda* shares to swap, in smallest unit (18 decimals, decimal string). */
  inputAmount: string;
  /** Minimum acceptable output in smallest unit of the output token (decimal string). Slippage already applied. */
  minOutputAmount: string;
  /** Recipient on `dstChainKey` (chain-specific format). Defaults to `srcAddress`. */
  recipient?: string;
  /** Unix timestamp (seconds) at which the intent expires; `"0"` for no expiry. Defaults to hub block time + 5 min (decimal string). */
  deadline?: string;
  /** Solver address (EVM hub address). Defaults to the zero address for "any solver". */
  solver?: string;
}

// ──────────────────────────────────────────────────────────────────────
// Aggregating client interface — one method per endpoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Client-side surface for the backend Leverage Yield API v2 — for typed HTTP clients
 * (fetch wrappers / SDK adapters). Each method describes one endpoint as the client sees
 * it: all methods are async and all field types are the post-serialization wire shapes above
 * (bigint → decimal `string`).
 *
 * The intent-lifecycle, gas, fee, and submit-tx methods reuse the swaps wire types verbatim
 * because a leverage-yield deposit/withdraw IS an intent-based swap (see the file header). The
 * leverage-yield-specific surface is the vault registry, the vault reads, and the separate
 * deposit/withdraw create-intent (and quote) endpoints.
 *
 * As with `ISwapsApiV2`, the backend `LeverageYieldController` `implements` this — declaring every
 * handler `async` and typed with the wire-shaped DTOs — so a request or response shape cannot drift
 * from this contract without failing the backend build.
 */
export interface ILeverageYieldApiV2 {
  // ── Vault registry ──
  /** GET /leverage-yield/vaults */
  getVaults(): Promise<GetLeverageVaultsResponseV2>;
  /** GET /leverage-yield/vaults/:name */
  getVault(name: string): Promise<GetLeverageVaultResponseV2>;

  // ── Vault reads ──
  /** GET /leverage-yield/asset */
  getAsset(query: VaultQueryV2): Promise<VaultAssetResponseV2>;
  /** GET /leverage-yield/position */
  getPosition(query: VaultQueryV2): Promise<LeverageYieldPositionV2>;
  /** GET /leverage-yield/apr */
  getApr(query: VaultQueryV2): Promise<LeverageYieldAprV2>;
  /** GET /leverage-yield/apr/effective */
  getEffectiveApr(query: VaultQueryV2): Promise<LeverageYieldEffectiveAprV2>;
  /** GET /leverage-yield/apr/lsd */
  getLsdApr(query: VaultQueryV2): Promise<LeverageYieldLsdAprV2>;
  /** GET /leverage-yield/total-assets */
  getTotalAssets(query: VaultQueryV2): Promise<VaultTotalAssetsResponseV2>;
  /** GET /leverage-yield/preview/deposit */
  previewDeposit(query: VaultAssetsQueryV2): Promise<PreviewDepositResponseV2>;
  /** GET /leverage-yield/preview/withdraw */
  previewWithdraw(query: VaultAssetsQueryV2): Promise<PreviewWithdrawResponseV2>;
  /** GET /leverage-yield/preview/redeem */
  previewRedeem(query: VaultSharesQueryV2): Promise<PreviewRedeemResponseV2>;
  /** GET /leverage-yield/share-balance */
  getShareBalance(query: VaultOwnerQueryV2): Promise<ShareBalanceResponseV2>;
  /** GET /leverage-yield/max-withdraw */
  getMaxWithdraw(query: VaultOwnerQueryV2): Promise<MaxWithdrawResponseV2>;

  // ── Quote ──
  /** POST /leverage-yield/quote/deposit */
  getDepositQuote(body: LeverageYieldDepositQuoteRequestV2, query?: QuoteQueryV2): Promise<QuoteResponseV2>;
  /** POST /leverage-yield/quote/withdraw */
  getWithdrawQuote(body: LeverageYieldWithdrawQuoteRequestV2, query?: QuoteQueryV2): Promise<QuoteResponseV2>;

  // ── Deadline ──
  /** GET /leverage-yield/deadline */
  getDeadline(query?: DeadlineQueryV2): Promise<DeadlineResponseV2>;

  // ── Deposit allowance / approve (spoke-side input token, mirrors swaps) ──
  /** POST /leverage-yield/allowance/check */
  checkAllowance(body: CreateDepositIntentParamsV2): Promise<AllowanceCheckResponseV2>;
  /** POST /leverage-yield/approve */
  approve(body: CreateDepositIntentParamsV2): Promise<ApproveResponseV2>;

  // ── Create intent (separate deposit / withdraw) ──
  /** POST /leverage-yield/intents/deposit */
  createDepositIntent(body: CreateDepositIntentParamsV2): Promise<CreateIntentResponseV2>;
  /** POST /leverage-yield/intents/withdraw */
  createWithdrawIntent(body: CreateWithdrawIntentParamsV2): Promise<CreateIntentResponseV2>;

  // ── Intent lifecycle (reused swaps wire types) ──
  /** POST /leverage-yield/intents/submit */
  submitIntent(body: SubmitIntentRequestV2): Promise<SubmitIntentResponseV2>;
  /** POST /leverage-yield/intents/status */
  getStatus(body: StatusRequestV2): Promise<StatusResponseV2>;
  /** POST /leverage-yield/intents/cancel */
  cancelIntent(body: CancelIntentRequestV2): Promise<CancelIntentResponseV2>;
  /** POST /leverage-yield/intents/hash */
  getIntentHash(body: IntentHashRequestV2): Promise<IntentHashResponseV2>;
  /** POST /leverage-yield/intents/packet */
  getSolvedIntentPacket(body: IntentPacketRequestV2): Promise<IntentPacketResponseV2>;
  /** POST /leverage-yield/intents/extra-data */
  getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2): Promise<IntentExtraDataResponseV2>;
  /** GET /leverage-yield/intents/:txHash/fill */
  getFilledIntent(txHash: string): Promise<IntentStateV2>;
  /** GET /leverage-yield/intents/:txHash */
  getIntent(txHash: string): Promise<GetIntentResponseV2>;

  // ── Gas & fees (reused swaps wire types) ──
  /** POST /leverage-yield/gas/estimate */
  estimateGas(body: GasEstimateRequestV2): Promise<GasEstimateResponseV2>;
  /** GET /leverage-yield/fees/partner */
  getPartnerFee(query: FeeQueryV2): Promise<FeeResponseV2>;
  /** GET /leverage-yield/fees/solver */
  getSolverFee(query: FeeQueryV2): Promise<FeeResponseV2>;

  // ── Backend submit-tx flow (reused swaps wire types) ──
  /** POST /leverage-yield/submit-tx */
  submitTx(body: LeverageYieldSubmitTxRequestV2): Promise<SubmitTxResponseV2>;
  /** GET /leverage-yield/submit-tx/status */
  getSubmitTxStatus(query: SubmitTxStatusQueryV2): Promise<SubmitTxStatusResponseV2>;
}

/** Which vault operation a leverage-yield submit-tx represents. */
export type LeverageYieldSubmitTxOperation = 'deposit' | 'withdraw';

/**
 * Leverage-yield submit-tx request body. Extends the shared swaps {@link SubmitTxRequestV2} with the
 * required `operation` discriminator the backend needs to record the queued row as a vault
 * `deposit`/`withdraw` (mapped server-side to the row-level `leverage_deposit`/`leverage_withdraw`).
 */
export interface LeverageYieldSubmitTxRequestV2 extends SubmitTxRequestV2 {
  operation: LeverageYieldSubmitTxOperation;
}
