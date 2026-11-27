// Backend Leverage Yield API v2 wire contract. Deposits/withdrawals ARE intent swaps, so lifecycle shapes are reused
// from `./backendApiV2.ts`; responses carry bigints as decimal strings, request `IntentRequestV2` carries `bigint`.

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

/** JSON-safe mirror of the SDK `LeverageYieldLsdSource` (plain primitives, no branded types). */
export interface LsdSourceV2 {
  /** DefiLlama pool ID (UUID). */
  poolId: string;
  /** APR as a percentage (e.g. `3.2` for 3.2%), used when the DefiLlama fetch errors. */
  fallbackAprPct: number;
  label: string;
}

/** `LeverageYieldVault` projected to JSON primitives; static descriptor for discovery and UI. */
export interface LeverageVaultV2 {
  /** The lsoda* share-token symbol (e.g. `lsodaWEETH`). */
  name: string;
  /** `LeverageYieldVault` proxy address on the Sonic hub. */
  vault: string;
  /** Sodax vault-token wrapper on the hub (e.g. sodaWEETH). */
  asset: string;
  /** Sodax vault-token wrapper borrowed against `asset` (e.g. sodaETH). */
  borrowToken: string;
  /** Omitted for non-LSD vaults. */
  lsdSource?: LsdSourceV2;
}

export type GetLeverageVaultsResponseV2 = readonly LeverageVaultV2[];

export type GetLeverageVaultResponseV2 = LeverageVaultV2;

export interface VaultQueryV2 {
  /** Hub `LeverageYieldVault` proxy address; it doubles as the lsoda* token. */
  vault: string;
}

export interface VaultOwnerQueryV2 extends VaultQueryV2 {
  /** Hub wallet address. */
  owner: string;
}

export interface VaultAssetsQueryV2 extends VaultQueryV2 {
  /** Underlying asset amount, 18 decimals (decimal string). */
  assets: string;
}

export interface VaultSharesQueryV2 extends VaultQueryV2 {
  /** lsoda* share amount, 18 decimals (decimal string). */
  shares: string;
}

export interface VaultAssetResponseV2 {
  asset: string;
}

/** JSON-safe mirror of the SDK `LeverageYieldPosition`; amounts are vault-asset units, 18 decimals. */
export interface LeverageYieldPositionV2 {
  collateral: string;
  debt: string;
  /** Basis points (`"8500"` = 85%). */
  ltv: string;
  /** WAD (1e18); below 1e18 implies liquidation risk. */
  healthFactor: string;
  /** Asset held by the vault but not yet supplied to the pool. */
  idleAsset: string;
}

/** AAVE-only steady-state APR; every rate is RAY (1e27 = 100%) as a decimal string. */
export interface LeverageYieldAprV2 {
  supplyAprRay: string;
  borrowAprRay: string;
  /** Basis points, from `vault.targetLTV()`. */
  targetLtvBps: string;
  /** Leverage multiplier ×1e18. */
  leverageMultiplierWad: string;
  /** Can be negative. */
  netAprRay: string;
}

export interface LeverageYieldLsdAprV2 {
  /** RAY (1e27 = 100%); `"0"` when the vault has no LSD source. */
  aprRay: string;
  /** Suffixed with `(fallback)` on fetch error. */
  label: string;
  /** Value came from the hardcoded fallback; UIs should mark it an estimate. */
  stale: boolean;
}

/** AAVE + LSD APR; `effectiveNetAprRay` is the honest headline number. */
export interface LeverageYieldEffectiveAprV2 extends LeverageYieldAprV2 {
  lsdApr: LeverageYieldLsdAprV2;
  /** `supplyAprRay + lsdApr.aprRay`, in RAY. */
  effectiveSupplyAprRay: string;
  /** `effectiveSupplyAprRay + leverage × (effectiveSupplyAprRay − borrowAprRay)`, in RAY. */
  effectiveNetAprRay: string;
}

export interface VaultTotalAssetsResponseV2 {
  /** 18 decimals (decimal string). */
  totalAssets: string;
}

/** ERC-4626 `previewDeposit`. */
export interface PreviewDepositResponseV2 {
  /** lsoda* shares minted, 18 decimals. */
  shares: string;
}

/** ERC-4626 `previewWithdraw`. */
export interface PreviewWithdrawResponseV2 {
  /** lsoda* shares burned, 18 decimals. */
  shares: string;
}

/** ERC-4626 `previewRedeem`. */
export interface PreviewRedeemResponseV2 {
  /** 18 decimals. */
  assets: string;
}

export interface ShareBalanceResponseV2 {
  /** lsoda* shares, 18 decimals. */
  balance: string;
}

/** Raw ERC-4626 `maxWithdraw`, NOT dust-trimmed: withdrawing it can revert on share round-up, so MAX flows need
 * a margin (as `getMaxWithdrawForUser` does with `MAX_WITHDRAW_DUST_BUFFER`). */
export interface MaxWithdrawResponseV2 {
  /** 18 decimals. */
  maxWithdraw: string;
}

/** Quotes `tokenSrc` → the vault's lsoda* shares; expected shares come back in `quotedAmount`. */
export interface LeverageYieldDepositQuoteRequestV2 {
  vault: string;
  tokenSrc: string;
  tokenSrcChainKey: string;
  /** Smallest unit of the source token. */
  amount: string;
  /** Only `exact_input` is supported. */
  quoteType: QuoteTypeV2;
  /** Defaults to the backend's configured leverage-yield fee. */
  partnerFee?: PartnerFeeV2;
  /** Required only when `includeTxData=true`. */
  srcAddress?: string;
}

/** Quotes lsoda* shares → `tokenDst`. No `partnerFee`: the backend applies its configured fee to withdraws
 * (deducted from the lsoda* input) and rejects unknown body fields. */
export interface LeverageYieldWithdrawQuoteRequestV2 {
  vault: string;
  /** Drives hub-wallet derivation and the `includeTxData` tx shape. */
  srcChainKey: string;
  tokenDst: string;
  tokenDstChainKey: string;
  /** lsoda* shares, 18 decimals. */
  amount: string;
  /** Only `exact_input` is supported. */
  quoteType: QuoteTypeV2;
  /** Required only when `includeTxData=true`. */
  srcAddress?: string;
  /** Required only when `includeTxData=true`. */
  dstAddress?: string;
}

/** Shared body for allowance/check, approve and intents/deposit; lsoda* is delivered to the user's hub wallet. */
export interface CreateDepositIntentParamsV2 {
  /** Hub proxy address; it doubles as the lsoda* token. */
  vault: string;
  srcChainKey: string;
  srcAddress: string;
  inputToken: string;
  /** Smallest unit of the input token. */
  inputAmount: string;
  /** lsoda* output, 18 decimals, slippage already applied. */
  minOutputAmount: string;
  /** Unix seconds; `"0"` for no expiry. Defaults to hub block time + 5 min. */
  deadline?: string;
  /** Defaults to the zero address ("any solver"). */
  solver?: string;
  /** Defaults to the effective leverage-yield/swap fee. */
  partnerFee?: PartnerFeeV2;
}

/** Swaps lsoda* held in the hub wallet (backend sets `hubWalletSwap`). No `partnerFee`: the backend applies its
 * configured fee to withdraws and rejects unknown body fields. */
export interface CreateWithdrawIntentParamsV2 {
  /** Hub proxy address; it doubles as the lsoda* token. */
  vault: string;
  /** Drives hub-wallet derivation. */
  srcChainKey: string;
  srcAddress: string;
  dstChainKey: string;
  outputToken: string;
  /** lsoda* shares, 18 decimals. */
  inputAmount: string;
  /** Smallest unit of the output token, slippage already applied. */
  minOutputAmount: string;
  /** Defaults to `srcAddress`. */
  recipient?: string;
  /** Unix seconds; `"0"` for no expiry. Defaults to hub block time + 5 min. */
  deadline?: string;
  /** Defaults to the zero address ("any solver"). */
  solver?: string;
}

/** Backend `LeverageYieldController` `implements` this, so a wire shape cannot drift without failing its build. */
export interface ILeverageYieldApiV2 {
  /** GET /leverage-yield/vaults */
  getVaults(): Promise<GetLeverageVaultsResponseV2>;
  /** GET /leverage-yield/vaults/:name */
  getVault(name: string): Promise<GetLeverageVaultResponseV2>;

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

  /** POST /leverage-yield/quote/deposit */
  getDepositQuote(body: LeverageYieldDepositQuoteRequestV2, query?: QuoteQueryV2): Promise<QuoteResponseV2>;
  /** POST /leverage-yield/quote/withdraw */
  getWithdrawQuote(body: LeverageYieldWithdrawQuoteRequestV2, query?: QuoteQueryV2): Promise<QuoteResponseV2>;

  /** GET /leverage-yield/deadline */
  getDeadline(query?: DeadlineQueryV2): Promise<DeadlineResponseV2>;

  /** POST /leverage-yield/allowance/check */
  checkAllowance(body: CreateDepositIntentParamsV2): Promise<AllowanceCheckResponseV2>;
  /** POST /leverage-yield/approve */
  approve(body: CreateDepositIntentParamsV2): Promise<ApproveResponseV2>;

  /** POST /leverage-yield/intents/deposit */
  createDepositIntent(body: CreateDepositIntentParamsV2): Promise<CreateIntentResponseV2>;
  /** POST /leverage-yield/intents/withdraw */
  createWithdrawIntent(body: CreateWithdrawIntentParamsV2): Promise<CreateIntentResponseV2>;

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

  /** POST /leverage-yield/gas/estimate */
  estimateGas(body: GasEstimateRequestV2): Promise<GasEstimateResponseV2>;
  /** GET /leverage-yield/fees/partner */
  getPartnerFee(query: FeeQueryV2): Promise<FeeResponseV2>;
  /** GET /leverage-yield/fees/solver */
  getSolverFee(query: FeeQueryV2): Promise<FeeResponseV2>;

  /** POST /leverage-yield/submit-tx */
  submitTx(body: LeverageYieldSubmitTxRequestV2): Promise<SubmitTxResponseV2>;
  /** GET /leverage-yield/submit-tx/status */
  getSubmitTxStatus(query: SubmitTxStatusQueryV2): Promise<SubmitTxStatusResponseV2>;
}

export type LeverageYieldSubmitTxOperation = 'deposit' | 'withdraw';

/** `operation` is stored server-side as `leverage_deposit`/`leverage_withdraw` on the queued row. */
export interface LeverageYieldSubmitTxRequestV2 extends SubmitTxRequestV2 {
  operation: LeverageYieldSubmitTxOperation;
}
