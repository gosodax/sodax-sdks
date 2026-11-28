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

/** `ILeverageYieldApiV2` with `Result<T>` returns (never throws) and a trailing `RequestOverrideConfig`. */
type ResultifiedLeverageYieldApiV2 = {
  [K in keyof ILeverageYieldApiV2]: ILeverageYieldApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

export type LeverageYieldApiServiceOptions = {
  /** Trim a legacy `/be` suffix off per-call `baseURL` overrides; `false` when the config sets `basePath` explicitly. */
  trimLegacyOverrides?: boolean;
};

/** Client for `/leverage-yield/*`, a gateway sibling of the data API's `/be` mount (no `basePath`, no config slice). */
export class LeverageYieldApiService implements ResultifiedLeverageYieldApiV2 {
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
        // Legacy `/be`-suffixed overrides must not nest `/leverage-yield/*` under the data API's mount.
        overrideConfig: this.trimsLegacyOverrides ? normalizeOverrideBaseURL(overrideConfig) : overrideConfig,
        logger: this.logger,
        serviceLabel: 'LeverageYieldApiService',
      });

      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
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
      return { ok: false, error: toExternalApiError({ api: 'leverageYield', feature: 'backend', endpoint, error }) };
    }
  }

  /** Drop the SDK-only bigint `feeAmount` (from `Intent & FeeAmount`) that the lenient serializer would otherwise send. */
  private static toWireIntent(intent: IntentRequestV2): IntentRequestV2 {
    const { feeAmount: _feeAmount, ...rest }: IntentRequestV2 & Partial<FeeAmount> = intent;
    return rest;
  }

  private withQuery(base: string, params: Record<string, string>): string {
    const queryString = new URLSearchParams(params).toString();
    return queryString.length > 0 ? `${base}?${queryString}` : base;
  }

  public async getVaults(config?: RequestOverrideConfig): Promise<Result<GetLeverageVaultsResponseV2>> {
    return this.request('/leverage-yield/vaults', { method: 'GET' }, schemas.GetLeverageVaultsResponseSchema, config);
  }

  /** `name` is the lsoda* share-token name (e.g. `lsodaWEETH`). */
  public async getVault(name: string, config?: RequestOverrideConfig): Promise<Result<GetLeverageVaultResponseV2>> {
    return this.request(
      `/leverage-yield/vaults/${name}`,
      { method: 'GET' },
      schemas.GetLeverageVaultResponseSchema,
      config,
    );
  }

  public async getAsset(query: VaultQueryV2, config?: RequestOverrideConfig): Promise<Result<VaultAssetResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/asset', { vault: query.vault }),
      { method: 'GET' },
      schemas.VaultAssetResponseSchema,
      config,
    );
  }

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

  /** AAVE-only steady-state APR; goes negative when the LSD yield is the alpha. Rates are RAY decimal strings. */
  public async getApr(query: VaultQueryV2, config?: RequestOverrideConfig): Promise<Result<LeverageYieldAprV2>> {
    return this.request(
      this.withQuery('/leverage-yield/apr', { vault: query.vault }),
      { method: 'GET' },
      schemas.LeverageYieldAprSchema,
      config,
    );
  }

  /** Combined AAVE + LSD APR; `effectiveNetAprRay` is the headline number. */
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

  public async getLsdApr(query: VaultQueryV2, config?: RequestOverrideConfig): Promise<Result<LeverageYieldLsdAprV2>> {
    return this.request(
      this.withQuery('/leverage-yield/apr/lsd', { vault: query.vault }),
      { method: 'GET' },
      schemas.LeverageYieldLsdAprSchema,
      config,
    );
  }

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

  /** RAW ERC-4626 `maxWithdraw`, not dust-trimmed like `sodax.leverageYield.getMaxWithdrawForUser`: apply a margin. */
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

  /** `query.includeTxData` also builds the unsigned create-intent tx and then requires `srcAddress` in the body. */
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

  /** `query.includeTxData` also builds the unsigned tx (signed on `srcChainKey`), requiring `srcAddress`/`dstAddress`. */
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

  /** Deadline = hub timestamp + `offsetSeconds` (default 300s), as unix seconds. */
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

  /** Deposit only: withdraw needs no spoke allowance (it spends lsoda* from the hub wallet). */
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

  /** Mine `resetTx` first when present. */
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

  /** The backend sets `hubWalletSwap` so the swap spends the lsoda* held in the user's hub wallet. */
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

  public async getStatus(body: StatusRequestV2, config?: RequestOverrideConfig): Promise<Result<StatusResponseV2>> {
    return this.request(
      '/leverage-yield/intents/status',
      { method: 'POST', body: toJsonBody(body) },
      schemas.StatusResponseSchema,
      config,
    );
  }

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

  /** Long-polls the relayer until the fill packet lands on the destination chain. */
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

  /** Provide EITHER `txHash` OR `intent`. */
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

  public async getFilledIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentStateV2>> {
    return this.request(
      `/leverage-yield/intents/${txHash}/fill`,
      { method: 'GET' },
      schemas.IntentStateResponseSchema,
      config,
    );
  }

  public async getIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<GetIntentResponseV2>> {
    return this.request(`/leverage-yield/intents/${txHash}`, { method: 'GET' }, schemas.IntentResponseSchema, config);
  }

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

  public async getPartnerFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/fees/partner', { amount: query.amount }),
      { method: 'GET' },
      schemas.FeeResponseSchema,
      config,
    );
  }

  /** Maximum protocol (solver) fee; the actual fee depends on the solver's route. */
  public async getSolverFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.request(
      this.withQuery('/leverage-yield/fees/solver', { amount: query.amount }),
      { method: 'GET' },
      schemas.FeeResponseSchema,
      config,
    );
  }

  /** Idempotent on `(txHash, srcChainKey)`. */
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

  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
  }

  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /** A `RequestOverrideConfig.timeout` replaces (not caps) this, so callers clamp to it as a ceiling. */
  public getTimeout(): number {
    return this.config.timeout;
  }
}
