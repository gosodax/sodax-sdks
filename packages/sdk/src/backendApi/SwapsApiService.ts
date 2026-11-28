import type {
  AllowanceCheckResponseV2,
  SwapsApiConfig,
  ApproveResponseV2,
  CancelIntentRequestV2,
  CancelIntentResponseV2,
  CreateIntentParamsV2,
  CreateIntentResponseV2,
  CreateLimitOrderParamsV2,
  CreateLimitOrderResponseV2,
  DeadlineQueryV2,
  DeadlineResponseV2,
  FeeAmount,
  FeeQueryV2,
  FeeResponseV2,
  GasEstimateRequestV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetSwapTokensByChainResponseV2,
  GetSwapTokensResponseV2,
  IntentExtraDataRequestV2,
  IntentExtraDataResponseV2,
  IntentHashRequestV2,
  IntentHashResponseV2,
  IntentPacketRequestV2,
  IntentPacketResponseV2,
  IntentRequestV2,
  IntentStateV2,
  ISwapsApiV2,
  QuoteQueryV2,
  QuoteRequestV2,
  QuoteResponseV2,
  Result,
  StatusRequestV2,
  StatusResponseV2,
  SubmitIntentRequestV2,
  SubmitIntentResponseV2,
  SubmitTxRequestV2,
  SubmitTxResponseV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResponseV2,
  SodaxLogger,
} from '@sodax/types';
import { DEFAULT_BACKEND_API_TIMEOUT } from '@sodax/types';
import { stripLegacyBackendMount } from './apiConfig.js';
import { SwapsApi, SwapsApiError } from '@sodax/swaps-api';
import * as v from 'valibot';

import { apiKeyHeader, assignHeaders, mergeHeaders, type RequestOverrideConfig } from './api-utils.js';
import { SodaxError } from '../errors/SodaxError.js';
import { isAuthStatus } from '../errors/guards.js';
import { consoleLogger } from '../shared/logger.js';

/** `ISwapsApiV2` with `Result<T>` returns (never throws) and a trailing `RequestOverrideConfig`. */
type ResultifiedSwapsApiV2 = {
  [K in keyof ISwapsApiV2]: ISwapsApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

export type SwapsApiServiceOptions = {
  /** Trim a legacy `/be` suffix off per-call `baseURL` overrides; `false` when the config sets `basePath` explicitly. */
  trimLegacyOverrides?: boolean;
};

/** `Result<T>` adapter over the standalone `@sodax/swaps-api` wire client (`/swaps/*`). */
export class SwapsApiService implements ResultifiedSwapsApiV2 {
  private readonly config: SwapsApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;
  private readonly trimsLegacyOverrides: boolean;

  constructor(config: SwapsApiConfig, logger: SodaxLogger = consoleLogger, options: SwapsApiServiceOptions = {}) {
    this.config = config;
    // Merged rather than spread so two casings of one header name cannot both survive.
    this.headers = mergeHeaders(config.headers);
    this.logger = logger;
    this.trimsLegacyOverrides = options.trimLegacyOverrides ?? true;
  }

  /** Built per call so `setHeaders` and per-call overrides apply; `timeout` falls back to the default ceiling. */
  private buildClient(overrideConfig?: RequestOverrideConfig): SwapsApi {
    // Legacy `/be`-suffixed overrides must not nest `/swaps/*` under the data API's mount.
    const override = overrideConfig?.baseURL;
    const baseUrl = override
      ? this.trimsLegacyOverrides
        ? stripLegacyBackendMount(override)
        : override
      : this.config.baseURL;
    const timeout = overrideConfig?.timeout ?? this.config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
    // Precedence: override `x-api-key` header > per-call `apiKey` > configured key.
    const headers = mergeHeaders(this.headers, apiKeyHeader(overrideConfig?.apiKey), overrideConfig?.headers);
    return new SwapsApi({ baseUrl, headers, timeout });
  }

  /** Only a RESPONSE-shape validation failure is tagged `invalid_response_shape`; request-side ones are caller bugs. */
  private async toResult<T>(
    endpoint: string,
    call: (client: SwapsApi) => Promise<T>,
    overrideConfig?: RequestOverrideConfig,
  ): Promise<Result<T, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const value = await call(this.buildClient(overrideConfig));
      return { ok: true, value };
    } catch (error) {
      const context: Record<string, unknown> = { api: 'swaps', endpoint };
      if (error instanceof SwapsApiError) {
        context.code = error.code;
        // `issues` is set only for RESPONSE-shape failures; request-side VALIDATION_ERRORs carry none.
        if (error.code === 'VALIDATION_ERROR' && error.context.issues !== undefined) {
          context.reason = 'invalid_response_shape';
          // Flatten like BackendApiService does, so detail survives `SodaxError.toJSON`.
          const issues = error.context.issues;
          context.issues = issues instanceof v.ValiError ? v.flatten(issues.issues) : issues;
        }
        if (error.context.status !== undefined) context.status = error.context.status;
        // 401/403 from the apiguard are config problems only the consumer can fix; never log the key.
        if (isAuthStatus(error.context.status)) {
          this.logger.warn(
            `[SwapsApiService] ${endpoint} was rejected by the swaps API key guard (${error.context.status}). Configure a valid partner API key — new Sodax({ apiKey }) — see docs/CONFIGURE_SDK.md.`,
          );
        }
      }
      this.logger.error(`[SwapsApiService] Request to ${endpoint} failed`, error);
      return {
        ok: false,
        error: new SodaxError(
          'EXTERNAL_API_ERROR',
          error instanceof Error ? error.message : `Request to ${endpoint} failed`,
          { feature: 'backend', cause: error, context },
        ),
      };
    }
  }

  /** Drop the SDK-only bigint `feeAmount` (from `Intent & FeeAmount`), which would trip `serializeIntentRequest`. */
  private static toWireIntent(intent: IntentRequestV2): IntentRequestV2 {
    const { feeAmount: _feeAmount, ...rest }: IntentRequestV2 & Partial<FeeAmount> = intent;
    return rest;
  }

  public async getTokens(config?: RequestOverrideConfig): Promise<Result<GetSwapTokensResponseV2>> {
    return this.toResult('/swaps/tokens', c => c.getTokens(), config);
  }

  public async getTokensByChain(
    chainKey: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetSwapTokensByChainResponseV2>> {
    return this.toResult(`/swaps/tokens/${chainKey}`, c => c.getTokensByChain(chainKey), config);
  }

  /** `query.includeTxData` also builds the unsigned create-intent tx and then requires `srcAddress`/`dstAddress`. */
  public async getQuote(
    body: QuoteRequestV2,
    query?: QuoteQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<QuoteResponseV2>> {
    return this.toResult('/swaps/quote', c => c.getQuote(body, query), config);
  }

  /** Deadline = hub timestamp + `offsetSeconds` (default 300s). */
  public async getDeadline(
    query?: DeadlineQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<DeadlineResponseV2>> {
    return this.toResult('/swaps/deadline', c => c.getDeadline(query), config);
  }

  public async checkAllowance(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<AllowanceCheckResponseV2>> {
    return this.toResult('/swaps/allowance/check', c => c.checkAllowance(body), config);
  }

  public async approve(body: CreateIntentParamsV2, config?: RequestOverrideConfig): Promise<Result<ApproveResponseV2>> {
    return this.toResult('/swaps/approve', c => c.approve(body), config);
  }

  public async createIntent(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateIntentResponseV2>> {
    return this.toResult('/swaps/intents', c => c.createIntent(body), config);
  }

  public async submitIntent(
    body: SubmitIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitIntentResponseV2>> {
    return this.toResult('/swaps/intents/submit', c => c.submitIntent(body), config);
  }

  public async getStatus(body: StatusRequestV2, config?: RequestOverrideConfig): Promise<Result<StatusResponseV2>> {
    return this.toResult('/swaps/intents/status', c => c.getStatus(body), config);
  }

  public async cancelIntent(
    body: CancelIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CancelIntentResponseV2>> {
    return this.toResult(
      '/swaps/intents/cancel',
      c => c.cancelIntent({ ...body, intent: SwapsApiService.toWireIntent(body.intent) }),
      config,
    );
  }

  public async getIntentHash(
    body: IntentHashRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentHashResponseV2>> {
    return this.toResult(
      '/swaps/intents/hash',
      c => c.getIntentHash({ ...body, intent: SwapsApiService.toWireIntent(body.intent) }),
      config,
    );
  }

  /** Long-polls the relayer until the fill packet lands on the destination chain. */
  public async getSolvedIntentPacket(
    body: IntentPacketRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentPacketResponseV2>> {
    return this.toResult('/swaps/intents/packet', c => c.getSolvedIntentPacket(body), config);
  }

  /** Provide EITHER `txHash` OR `intent`. */
  public async getIntentSubmitTxExtraData(
    body: IntentExtraDataRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentExtraDataResponseV2>> {
    const normalized = body.intent ? { ...body, intent: SwapsApiService.toWireIntent(body.intent) } : body;
    return this.toResult('/swaps/intents/extra-data', c => c.getIntentSubmitTxExtraData(normalized), config);
  }

  public async getFilledIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentStateV2>> {
    return this.toResult(`/swaps/intents/${txHash}/fill`, c => c.getFilledIntent(txHash), config);
  }

  public async getIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<GetIntentResponseV2>> {
    return this.toResult(`/swaps/intents/${txHash}`, c => c.getIntent(txHash), config);
  }

  /** Create-intent with an optional `deadline`. */
  public async createLimitOrderIntent(
    body: CreateLimitOrderParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateLimitOrderResponseV2>> {
    return this.toResult('/swaps/limit-orders', c => c.createLimitOrderIntent(body), config);
  }

  public async estimateGas(
    body: GasEstimateRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<GasEstimateResponseV2>> {
    return this.toResult('/swaps/gas/estimate', c => c.estimateGas(body), config);
  }

  public async getPartnerFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.toResult('/swaps/fees/partner', c => c.getPartnerFee(query), config);
  }

  /** Maximum protocol (solver) fee; the actual fee depends on the solver's route. */
  public async getSolverFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.toResult('/swaps/fees/solver', c => c.getSolverFee(query), config);
  }

  /** Idempotent on `(txHash, srcChainKey)`; returns on submission, poll `getSubmitTxStatus` for progress. */
  public async submitTx(body: SubmitTxRequestV2, config?: RequestOverrideConfig): Promise<Result<SubmitTxResponseV2>> {
    return this.toResult(
      '/swaps/submit-tx',
      c => c.submitTx({ ...body, intent: SwapsApiService.toWireIntent(body.intent) }),
      config,
    );
  }

  public async getSubmitTxStatus(
    query: SubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxStatusResponseV2>> {
    return this.toResult('/swaps/submit-tx/status', c => c.getSubmitTxStatus(query), config);
  }

  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
  }

  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /** A `RequestOverrideConfig.timeout` replaces (not caps) this, so callers clamp to it as a ceiling. */
  public getTimeout(): number {
    return this.config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
  }
}
