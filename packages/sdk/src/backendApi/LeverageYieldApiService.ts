// packages/sdk/src/backendApi/LeverageYieldApiService.ts

import * as v from 'valibot';
import type {
  AllowanceCheckResponseV2,
  ApproveResponseV2,
  BaseApiConfig,
  CancelIntentRequestV2,
  CancelIntentResponseV2,
  CreateDepositIntentParamsV2,
  CreateIntentResponseV2,
  CreateWithdrawIntentParamsV2,
  DeadlineQueryV2,
  DeadlineResponseV2,
  FeeAmount,
  FeeQueryV2,
  FeeResponseV2,
  GasEstimateRequestV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetLeverageVaultResponseV2,
  GetLeverageVaultsResponseV2,
  ILeverageYieldApiV2,
  IntentExtraDataRequestV2,
  IntentExtraDataResponseV2,
  IntentHashRequestV2,
  IntentHashResponseV2,
  IntentPacketRequestV2,
  IntentPacketResponseV2,
  IntentRequestV2,
  IntentStateV2,
  LeverageYieldAprV2,
  LeverageYieldDepositQuoteRequestV2,
  LeverageYieldEffectiveAprV2,
  LeverageYieldLsdAprV2,
  LeverageYieldPositionV2,
  LeverageYieldWithdrawQuoteRequestV2,
  MaxWithdrawResponseV2,
  PreviewDepositResponseV2,
  PreviewRedeemResponseV2,
  PreviewWithdrawResponseV2,
  QuoteQueryV2,
  QuoteResponseV2,
  Result,
  ShareBalanceResponseV2,
  SodaxLogger,
  StatusRequestV2,
  StatusResponseV2,
  SubmitIntentRequestV2,
  SubmitIntentResponseV2,
  LeverageYieldSubmitTxRequestV2,
  SubmitTxResponseV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
  VaultAssetResponseV2,
  VaultAssetsQueryV2,
  VaultOwnerQueryV2,
  VaultQueryV2,
  VaultSharesQueryV2,
  VaultTotalAssetsResponseV2,
} from '@sodax/types';

import {
  assignHeaders,
  makeRequest,
  toExternalApiError,
  toInvalidResponseShapeError,
  toJsonBody,
  type RequestConfig,
  type RequestOverrideConfig,
} from './api-utils.js';
import { normalizeOverrideBaseURL } from './apiConfig.js';
import * as schemas from './leverageYieldApiSchemas.js';
import { rawTxSchemaForChainKey } from './leverageYieldApiSchemas.js';
import type { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/**
 * {@link ILeverageYieldApiV2} with every method's return wrapped in `Result<T>` and an
 * optional trailing `RequestOverrideConfig`. `LeverageYieldApiService` implements this
 * (rather than `ILeverageYieldApiV2` directly) because it never throws — it returns
 * `{ ok: false }` on failure instead of `Promise<T>` rejection. Mirrors
 * `ResultifiedSwapsApiV2`; keeps the class in lockstep with the canonical interface.
 */
type ResultifiedLeverageYieldApiV2 = {
  [K in keyof ILeverageYieldApiV2]: ILeverageYieldApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

/**
 * HTTP client for the backend **Leverage Yield API** (`/leverage-yield/*`).
 *
 * The leverage-yield counterpart to {@link import('./SwapsApiService.js').SwapsApiService}:
 * one method per route of {@link ILeverageYieldApiV2}, each response validated at runtime
 * with a valibot schema (see `leverageYieldApiSchemas.ts`). A leverage-yield deposit/withdraw
 * IS an intent-based swap, so the intent-relay/gas/fee/submit-tx methods share the swaps wire
 * shapes and schemas; the vault registry, vault reads, and separate deposit/withdraw
 * create-intent (and quote) endpoints are leverage-yield-specific.
 *
 * All public methods return `Promise<Result<T>>` — they never throw. On network failure,
 * timeout, non-2xx HTTP response, or response-shape validation failure, the returned Result
 * has `ok: false` with a canonical `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`,
 * `context.api: 'leverageYield'`); the underlying failure is preserved on `error.cause`.
 *
 * Per-call request overrides (base URL, timeout, headers, API key) can be passed as the optional
 * last argument to any method via `RequestOverrideConfig`.
 *
 * The Leverage Yield API hangs off the shared gateway root as `/leverage-yield/*` — a sibling of the
 * data API's `/be` mount, not a child of it, so `resolveLeverageYieldApiConfig` returns a flat
 * {@link BaseApiConfig} with no `basePath`. There is deliberately no `leverageYieldApiConfig` slice:
 * retarget it via `baseURL` / `baseApiConfig`, or per call.
 *
 * Reachable on the Sodax facade as `sodax.api.leverageYield`.
 */
/** Construction options for {@link LeverageYieldApiService}. */
export type LeverageYieldApiServiceOptions = {
  /**
   * Whether a legacy `/be` suffix is trimmed off a per-call `baseURL` override. Defaults to `true`, the
   * migration behaviour. `BackendApiService` passes `false` when the `ApiConfig` states a `basePath`
   * explicitly: that marks a config written against the current contract, whose base URLs are deliberate
   * roots, so a trailing `/be` is a real path segment rather than the data API's mount.
   */
  trimLegacyOverrides?: boolean;
};

export class LeverageYieldApiService implements ResultifiedLeverageYieldApiV2 {
  // Fully-resolved API config supplied by the caller (BackendApiService resolves the ApiConfig
  // union via `resolveBaseApiConfig`); leverage-yield endpoints are sub-paths under the base URL.
  private readonly config: BaseApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;
  /** See {@link LeverageYieldApiServiceOptions.trimLegacyOverrides}. */
  private readonly trimsLegacyOverrides: boolean;

  constructor(
    config: BaseApiConfig,
    logger: SodaxLogger = consoleLogger,
    options: LeverageYieldApiServiceOptions = {},
  ) {
    this.config = config;
    this.headers = { ...config.headers };
    this.logger = logger;
    this.trimsLegacyOverrides = options.trimLegacyOverrides ?? true;
  }

  /**
   * Issues a single HTTP request, validates the JSON body against `schema`, and wraps the
   * result in `Result<T>`. Mirrors `SwapsApiService.request`; every public method delegates here.
   */
  private async request<S extends v.GenericSchema>(
    endpoint: string,
    config: RequestConfig,
    schema: S,
    overrideConfig?: RequestOverrideConfig,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const raw = await makeRequest<unknown>({
        endpoint,
        config: { baseURL: this.config.baseURL, timeout: this.config.timeout, headers: this.headers, ...config },
        // Normalized like a configured base URL: the override is the gateway root, so a legacy
        // `/be`-suffixed value must not nest `/leverage-yield/*` under the data API's mount — unless the
        // config opted out of the legacy trim, in which case the per-call value is left as given.
        overrideConfig: this.trimsLegacyOverrides ? normalizeOverrideBaseURL(overrideConfig) : overrideConfig,
        logger: this.logger,
        serviceLabel: 'LeverageYieldApiService',
      });

      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        // Backend returned a 2xx body that doesn't match the v2 contract — an upstream-API problem.
        return {
          ok: false,
          error: toInvalidResponseShapeError({
            api: 'leverageYield',
            feature: 'backend',
            endpoint,
            issues: v.flatten(parsed.issues),
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      // Network failure, timeout, or non-2xx HTTP status thrown by makeRequest. Preserves the
      // underlying error as `cause` and lifts its status so `isAuthFailure` recognizes a 401/403.
      return { ok: false, error: toExternalApiError({ api: 'leverageYield', feature: 'backend', endpoint, error }) };
    }
  }

  /**
   * Drop the SDK-only display field `feeAmount` before an intent reaches the strict wire serializer.
   * `sodax.leverageYield.createVaultIntent` returns `Intent & FeeAmount`, which is structurally
   * assignable to the wire `IntentRequestV2` and so gets passed straight into the intent-carrying
   * endpoints; the lenient JSON serializer would send the extra bigint wholesale. Mirrors
   * `SwapsApiService.toWireIntent`; a no-op for an already-clean `IntentRequestV2`.
   */
  private static toWireIntent(intent: IntentRequestV2): IntentRequestV2 {
    const { feeAmount: _feeAmount, ...rest }: IntentRequestV2 & Partial<FeeAmount> = intent;
    return rest;
  }

  /** Append `params` to `base` as a query string, returning `base` unchanged when `params` is empty. */
  private withQuery(base: string, params: Record<string, string>): string {
    const queryString = new URLSearchParams(params).toString();
    return queryString.length > 0 ? `${base}?${queryString}` : base;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Vault registry
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Fetch the registry of deployed leverage-yield vaults.
   *
   * @returns `Result<GetLeverageVaultsResponseV2>` — array of vault descriptors.
   */
  public async getVaults(config?: RequestOverrideConfig): Promise<Result<GetLeverageVaultsResponseV2>> {
    return this.request('/leverage-yield/vaults', { method: 'GET' }, schemas.GetLeverageVaultsResponseSchema, config);
  }

  /**
   * Fetch a single vault descriptor by its lsoda* share-token name (e.g. `lsodaWEETH`).
   *
   * @returns `Result<GetLeverageVaultResponseV2>` — the vault descriptor.
   */
  public async getVault(name: string, config?: RequestOverrideConfig): Promise<Result<GetLeverageVaultResponseV2>> {
    return this.request(
      `/leverage-yield/vaults/${name}`,
      { method: 'GET' },
      schemas.GetLeverageVaultResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Vault reads
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Get the vault's underlying hub asset (Sodax vault-token wrapper).
   *
   * @returns `Result<VaultAssetResponseV2>` — `{ asset }`.
   */
  public async getAsset(query: VaultQueryV2, config?: RequestOverrideConfig): Promise<Result<VaultAssetResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/asset', { vault: query.vault }),
      { method: 'GET' },
      schemas.VaultAssetResponseSchema,
      config,
    );
  }

  /**
   * Get a leveraged-position snapshot for the vault.
   *
   * @returns `Result<LeverageYieldPositionV2>` — `{ collateral, debt, ltv, healthFactor, idleAsset }` (decimal strings).
   */
  public async getPosition(
    query: VaultQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<LeverageYieldPositionV2>> {
    return this.request(
      this.withQuery('/leverage-yield/position', { vault: query.vault }),
      { method: 'GET' },
      schemas.LeverageYieldPositionSchema,
      config,
    );
  }

  /**
   * Get the AAVE-only steady-state APR for the vault (goes negative when the LSD yield is the alpha).
   *
   * @returns `Result<LeverageYieldAprV2>` — RAY-denominated rates as decimal strings.
   */
  public async getApr(query: VaultQueryV2, config?: RequestOverrideConfig): Promise<Result<LeverageYieldAprV2>> {
    return this.request(
      this.withQuery('/leverage-yield/apr', { vault: query.vault }),
      { method: 'GET' },
      schemas.LeverageYieldAprSchema,
      config,
    );
  }

  /**
   * Get the honest combined AAVE + LSD effective APR for the vault.
   *
   * @returns `Result<LeverageYieldEffectiveAprV2>` — includes `effectiveNetAprRay` (the headline number).
   */
  public async getEffectiveApr(
    query: VaultQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<LeverageYieldEffectiveAprV2>> {
    return this.request(
      this.withQuery('/leverage-yield/apr/effective', { vault: query.vault }),
      { method: 'GET' },
      schemas.LeverageYieldEffectiveAprSchema,
      config,
    );
  }

  /**
   * Get the off-chain LSD staking-APR snapshot for the vault's underlying asset.
   *
   * @returns `Result<LeverageYieldLsdAprV2>` — `{ aprRay, label, stale }`.
   */
  public async getLsdApr(query: VaultQueryV2, config?: RequestOverrideConfig): Promise<Result<LeverageYieldLsdAprV2>> {
    return this.request(
      this.withQuery('/leverage-yield/apr/lsd', { vault: query.vault }),
      { method: 'GET' },
      schemas.LeverageYieldLsdAprSchema,
      config,
    );
  }

  /**
   * Get the total assets managed by the vault.
   *
   * @returns `Result<VaultTotalAssetsResponseV2>` — `{ totalAssets }` (decimal string).
   */
  public async getTotalAssets(
    query: VaultQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<VaultTotalAssetsResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/total-assets', { vault: query.vault }),
      { method: 'GET' },
      schemas.VaultTotalAssetsResponseSchema,
      config,
    );
  }

  /**
   * Preview the shares minted for depositing `assets` into the vault (ERC-4626 `previewDeposit`).
   *
   * @returns `Result<PreviewDepositResponseV2>` — `{ shares }` (decimal string).
   */
  public async previewDeposit(
    query: VaultAssetsQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<PreviewDepositResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/preview/deposit', { vault: query.vault, assets: query.assets }),
      { method: 'GET' },
      schemas.PreviewDepositResponseSchema,
      config,
    );
  }

  /**
   * Preview the shares burned to withdraw `assets` from the vault (ERC-4626 `previewWithdraw`).
   *
   * @returns `Result<PreviewWithdrawResponseV2>` — `{ shares }` (decimal string).
   */
  public async previewWithdraw(
    query: VaultAssetsQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<PreviewWithdrawResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/preview/withdraw', { vault: query.vault, assets: query.assets }),
      { method: 'GET' },
      schemas.PreviewWithdrawResponseSchema,
      config,
    );
  }

  /**
   * Preview the assets returned for redeeming `shares` from the vault (ERC-4626 `previewRedeem`).
   *
   * @returns `Result<PreviewRedeemResponseV2>` — `{ assets }` (decimal string).
   */
  public async previewRedeem(
    query: VaultSharesQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<PreviewRedeemResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/preview/redeem', { vault: query.vault, shares: query.shares }),
      { method: 'GET' },
      schemas.PreviewRedeemResponseSchema,
      config,
    );
  }

  /**
   * Get an owner's vault share (lsoda*) balance.
   *
   * @returns `Result<ShareBalanceResponseV2>` — `{ balance }` (decimal string).
   */
  public async getShareBalance(
    query: VaultOwnerQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<ShareBalanceResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/share-balance', { vault: query.vault, owner: query.owner }),
      { method: 'GET' },
      schemas.ShareBalanceResponseSchema,
      config,
    );
  }

  /**
   * Get an owner's RAW ERC-4626 `maxWithdraw` — NOT dust-trimmed, unlike the SDK-local
   * `sodax.leverageYield.getMaxWithdrawForUser`. Apply a margin before using it as a withdraw amount.
   *
   * @returns `Result<MaxWithdrawResponseV2>` — `{ maxWithdraw }` (decimal string).
   */
  public async getMaxWithdraw(
    query: VaultOwnerQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<MaxWithdrawResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/max-withdraw', { vault: query.vault, owner: query.owner }),
      { method: 'GET' },
      schemas.MaxWithdrawResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Quote · deadline
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Quote a swap-style deposit: any solver-supported `tokenSrc` → the vault's lsoda* shares.
   * Pass `query.includeTxData = true` to also build the unsigned create-intent tx (`srcAddress`
   * required in the body then).
   *
   * @returns `Result<QuoteResponseV2>` — `quotedAmount` (shares) and optional `txData`.
   */
  public async getDepositQuote(
    body: LeverageYieldDepositQuoteRequestV2,
    query?: QuoteQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<QuoteResponseV2>> {
    const endpoint = query?.includeTxData
      ? '/leverage-yield/quote/deposit?includeTxData=true'
      : '/leverage-yield/quote/deposit';
    const txSchema = rawTxSchemaForChainKey(body.tokenSrcChainKey);
    return this.request(
      endpoint,
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeQuoteResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Quote a swap-style withdraw: the vault's lsoda* shares → any solver-supported `tokenDst`.
   * Pass `query.includeTxData = true` to also build the unsigned tx (signed on `srcChainKey`;
   * `srcAddress`/`dstAddress` required in the body then).
   *
   * @returns `Result<QuoteResponseV2>` — `quotedAmount` (output token) and optional `txData`.
   */
  public async getWithdrawQuote(
    body: LeverageYieldWithdrawQuoteRequestV2,
    query?: QuoteQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<QuoteResponseV2>> {
    const endpoint = query?.includeTxData
      ? '/leverage-yield/quote/withdraw?includeTxData=true'
      : '/leverage-yield/quote/withdraw';
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      endpoint,
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeQuoteResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Compute a deposit/withdraw deadline (hub timestamp + `offsetSeconds`, default 300s).
   *
   * @returns `Result<DeadlineResponseV2>` — unix-seconds deadline (decimal string).
   */
  public async getDeadline(
    query?: DeadlineQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<DeadlineResponseV2>> {
    const params: Record<string, string> = {};
    if (query?.offsetSeconds !== undefined) params.offsetSeconds = String(query.offsetSeconds);
    return this.request(
      this.withQuery('/leverage-yield/deadline', params),
      { method: 'GET' },
      schemas.DeadlineResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Deposit allowance · approve · create intent (deposit / withdraw)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Check whether the deposit input-token allowance is already sufficient for the intent.
   * (Withdraw needs no spoke allowance — it spends lsoda* from the hub wallet.)
   *
   * @returns `Result<AllowanceCheckResponseV2>` — `{ valid }`.
   */
  public async checkAllowance(
    body: CreateDepositIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<AllowanceCheckResponseV2>> {
    return this.request(
      '/leverage-yield/allowance/check',
      { method: 'POST', body: toJsonBody(body) },
      schemas.AllowanceCheckResponseSchema,
      config,
    );
  }

  /**
   * Build an unsigned token-approval transaction for the deposit input token.
   *
   * @returns `Result<ApproveResponseV2>` — `{ tx, resetTx? }` (chain-specific unsigned txs); mine `resetTx` first when present.
   */
  public async approve(
    body: CreateDepositIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<ApproveResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/leverage-yield/approve',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeApproveResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Build an unsigned deposit create-intent transaction (any token → lsoda* shares).
   *
   * @returns `Result<CreateIntentResponseV2>` — `{ tx, intent, relayData }`.
   */
  public async createDepositIntent(
    body: CreateDepositIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateIntentResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/leverage-yield/intents/deposit',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeCreateIntentResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Build an unsigned withdraw create-intent transaction (lsoda* shares → any token). The backend
   * sets `hubWalletSwap` internally so the swap spends the lsoda* held in the user's hub wallet.
   *
   * @returns `Result<CreateIntentResponseV2>` — `{ tx, intent, relayData }`.
   */
  public async createWithdrawIntent(
    body: CreateWithdrawIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateIntentResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/leverage-yield/intents/withdraw',
      { method: 'POST', body: toJsonBody(body) },
      schemas.makeCreateIntentResponseSchema(txSchema),
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Intent lifecycle: submit · status · cancel · hash · packet · extra-data
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Submit the broadcast intent tx to the relay.
   *
   * @returns `Result<SubmitIntentResponseV2>` — `{ result }` (opaque relay response).
   */
  public async submitIntent(
    body: SubmitIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitIntentResponseV2>> {
    return this.request(
      '/leverage-yield/intents/submit',
      { method: 'POST', body: toJsonBody(body) },
      schemas.SubmitIntentResponseSchema,
      config,
    );
  }

  /**
   * Poll the solver for intent execution status.
   *
   * @returns `Result<StatusResponseV2>` — `{ status, fillTxHash? }`.
   */
  public async getStatus(body: StatusRequestV2, config?: RequestOverrideConfig): Promise<Result<StatusResponseV2>> {
    return this.request(
      '/leverage-yield/intents/status',
      { method: 'POST', body: toJsonBody(body) },
      schemas.StatusResponseSchema,
      config,
    );
  }

  /**
   * Build an unsigned cancel-intent transaction. The `intent` field carries `bigint` numerics —
   * {@link toJsonBody} serializes them to decimal strings.
   *
   * @returns `Result<CancelIntentResponseV2>` — `{ tx }`.
   */
  public async cancelIntent(
    body: CancelIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CancelIntentResponseV2>> {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return this.request(
      '/leverage-yield/intents/cancel',
      { method: 'POST', body: toJsonBody({ ...body, intent: LeverageYieldApiService.toWireIntent(body.intent) }) },
      schemas.makeCancelIntentResponseSchema(txSchema),
      config,
    );
  }

  /**
   * Compute the keccak256 hash of an Intent struct. The `intent` field carries `bigint` numerics.
   *
   * @returns `Result<IntentHashResponseV2>` — `{ hash }`.
   */
  public async getIntentHash(
    body: IntentHashRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentHashResponseV2>> {
    return this.request(
      '/leverage-yield/intents/hash',
      { method: 'POST', body: toJsonBody({ ...body, intent: LeverageYieldApiService.toWireIntent(body.intent) }) },
      schemas.IntentHashResponseSchema,
      config,
    );
  }

  /**
   * Long-poll the relayer until the fill packet lands on the destination chain.
   *
   * @returns `Result<IntentPacketResponseV2>` — delivered packet data.
   */
  public async getSolvedIntentPacket(
    body: IntentPacketRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentPacketResponseV2>> {
    return this.request(
      '/leverage-yield/intents/packet',
      { method: 'POST', body: toJsonBody(body) },
      schemas.IntentPacketResponseSchema,
      config,
    );
  }

  /**
   * Recover the relay extra data needed by `/leverage-yield/intents/submit`. Provide EITHER
   * `txHash` OR `intent` (whose `bigint` numerics {@link toJsonBody} serializes).
   *
   * @returns `Result<IntentExtraDataResponseV2>` — `{ address, payload }`.
   */
  public async getIntentSubmitTxExtraData(
    body: IntentExtraDataRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentExtraDataResponseV2>> {
    const normalized = body.intent ? { ...body, intent: LeverageYieldApiService.toWireIntent(body.intent) } : body;
    return this.request(
      '/leverage-yield/intents/extra-data',
      { method: 'POST', body: toJsonBody(normalized) },
      schemas.RelayExtraDataResponseSchema,
      config,
    );
  }

  /**
   * Get the on-chain fill state for an intent by its hub-chain tx hash.
   *
   * @returns `Result<IntentStateV2>` — `{ exists, remainingInput, receivedOutput, pendingPayment }`.
   */
  public async getFilledIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentStateV2>> {
    return this.request(
      `/leverage-yield/intents/${txHash}/fill`,
      { method: 'GET' },
      schemas.IntentStateResponseSchema,
      config,
    );
  }

  /**
   * Look up an Intent struct by its hub-chain creation tx hash.
   *
   * @returns `Result<GetIntentResponseV2>` — the decoded intent (bigint fields as decimal strings).
   */
  public async getIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<GetIntentResponseV2>> {
    return this.request(`/leverage-yield/intents/${txHash}`, { method: 'GET' }, schemas.IntentResponseSchema, config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Gas · fees
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Estimate gas for a raw transaction on a spoke chain.
   *
   * @returns `Result<GasEstimateResponseV2>` — `{ gas }` (chain-specific shape).
   */
  public async estimateGas(
    body: GasEstimateRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<GasEstimateResponseV2>> {
    return this.request(
      '/leverage-yield/gas/estimate',
      { method: 'POST', body: toJsonBody(body) },
      schemas.GasEstimateResponseSchema,
      config,
    );
  }

  /**
   * Compute the partner fee for a given input amount.
   *
   * @returns `Result<FeeResponseV2>` — `{ fee }` (decimal string).
   */
  public async getPartnerFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/fees/partner', { amount: query.amount }),
      { method: 'GET' },
      schemas.FeeResponseSchema,
      config,
    );
  }

  /**
   * Compute the protocol (solver) fee for a given input amount.
   *
   * @returns `Result<FeeResponseV2>` — `{ fee }` (decimal string).
   */
  public async getSolverFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/fees/solver', { amount: query.amount }),
      { method: 'GET' },
      schemas.FeeResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Submit-tx state machine
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Submit a vault-swap transaction to be processed (relay, post-execution, etc.). The `intent`
   * field carries `bigint` numerics — {@link toJsonBody} serializes them. Idempotent on
   * `(txHash, srcChainKey)`.
   *
   * @returns `Result<SubmitTxResponseV2>` — `{ success, data: { status, message } }`.
   */
  public async submitTx(
    body: LeverageYieldSubmitTxRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxResponseV2>> {
    return this.request(
      '/leverage-yield/submit-tx',
      { method: 'POST', body: toJsonBody({ ...body, intent: LeverageYieldApiService.toWireIntent(body.intent) }) },
      schemas.SubmitTxResponseSchema,
      config,
    );
  }

  /**
   * Get the processing status of a submitted vault-swap transaction by `(txHash, srcChainKey)`.
   *
   * @returns `Result<SubmitTxStatusResponseV2>` — `{ success, data }` (processing state).
   */
  public async getSubmitTxStatus(
    query: SubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxStatusResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/submit-tx/status', { txHash: query.txHash, srcChainKey: query.srcChainKey }),
      { method: 'GET' },
      schemas.SubmitTxStatusResponseSchema,
      config,
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Utilities (parity with SwapsApiService)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Merge additional headers into the service's default header set. Existing keys are
   * overwritten; keys absent from `headers` are preserved.
   */
  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
  }

  /** Return the base URL the service is currently pointing at. */
  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /**
   * Return the effective per-request timeout (ms).
   *
   * Callers bounding a request tighter than this need it as the CEILING, because a
   * `RequestOverrideConfig.timeout` REPLACES the service value rather than lowering it: an override
   * derived from a caller budget alone would raise the bound whenever that budget is the larger of the
   * two. `SubmitTxAttempt.requestTimeout` clamps against both (`min(budget left in the attempt, this)`).
   */
  public getTimeout(): number {
    return this.config.timeout;
  }
}
