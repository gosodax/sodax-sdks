// packages/sdk/src/backendApi/SwapsApiService.ts

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

/**
 * {@link ISwapsApiV2} with every method's return wrapped in `Result<T>` and an
 * optional trailing `RequestOverrideConfig`. `SwapsApiService` implements this
 * (rather than `ISwapsApiV2` directly) because it never throws — like
 * `BackendApiService`, it returns `{ ok: false }` on failure instead of
 * `Promise<T>` rejection. The mapped type keeps the class in lockstep with the
 * canonical interface: every endpoint is covered with its exact payload types.
 */
type ResultifiedSwapsApiV2 = {
  [K in keyof ISwapsApiV2]: ISwapsApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

/**
 * HTTP client for the backend **Swaps API** (`/swaps/*`).
 *
 * A thin adapter over the standalone `@sodax/swaps-api` package (the single source of the wire
 * client — request building, per-chain `tx` validation/transform, response schemas, HTTP + retry).
 * This service adds the SDK conventions on top: `Result<T>` (it never throws), a `SodaxLogger`,
 * `SwapsApiConfig`/`ApiConfig` resolution, and per-call `RequestOverrideConfig`.
 *
 * All public methods return `Promise<Result<T>>`. On network failure, timeout, non-2xx HTTP
 * response, or response-shape validation failure, the returned Result has `ok: false` with a
 * canonical `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`, `context.api: 'swaps'`,
 * `context.endpoint`); the underlying `SwapsApiError` is preserved on `error.cause`.
 *
 * Per-call request overrides (base URL, timeout, headers, API key) can be passed as the optional
 * last argument to any method via `RequestOverrideConfig`.
 *
 * Reachable on the Sodax facade as `sodax.api.swaps`.
 */
/** Construction options for {@link SwapsApiService}. */
export type SwapsApiServiceOptions = {
  /**
   * Whether a legacy `/be` suffix is trimmed off a per-call `baseURL` override. Defaults to `true`, the
   * migration behaviour. `BackendApiService` passes `false` when the `ApiConfig` states a `basePath`
   * explicitly: that marks a config written against the current contract, whose base URLs are deliberate
   * roots, so a trailing `/be` is a real path segment rather than the data API's mount.
   */
  trimLegacyOverrides?: boolean;
};

export class SwapsApiService implements ResultifiedSwapsApiV2 {
  // Fully-resolved swaps-API config supplied by the caller (BackendApiService resolves the
  // `ApiConfig` union via `resolveSwapsApiConfig`); this service does not resolve the union.
  private readonly config: SwapsApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;
  /** See {@link SwapsApiServiceOptions.trimLegacyOverrides}. */
  private readonly trimsLegacyOverrides: boolean;

  constructor(config: SwapsApiConfig, logger: SodaxLogger = consoleLogger, options: SwapsApiServiceOptions = {}) {
    this.config = config;
    // The config-level key arrives pre-baked in `headers` (see `withApiKey`); merged rather than spread
    // so two casings of one name cannot both survive — see `mergeHeaders`.
    this.headers = mergeHeaders(config.headers);
    this.logger = logger;
    this.trimsLegacyOverrides = options.trimLegacyOverrides ?? true;
  }

  /**
   * Build a `@sodax/swaps-api` client for a single call. Maps the SDK's `SwapsApiConfig`
   * (`baseURL`/`timeout`/`headers`) to the package's config (`baseUrl`/`timeout`/`headers`), layering
   * the optional per-call `RequestOverrideConfig` on top (override wins per field; headers merge).
   * `timeout` falls back to the backend-API default so a config that omits it still gets a ceiling
   * rather than an unbounded request. Constructed per call so `setHeaders` mutations and per-call
   * overrides both take effect without caching stale state.
   */
  private buildClient(overrideConfig?: RequestOverrideConfig): SwapsApi {
    // A per-call override is normalized exactly like a configured base URL: it is the gateway root, so a
    // legacy `/be`-suffixed value must not nest `/swaps/*` under the data API's mount. `this.config.baseURL`
    // was already normalized during resolution — including the opt-out, which is why the same decision
    // has to reach this path too.
    const override = overrideConfig?.baseURL;
    const baseUrl = override
      ? this.trimsLegacyOverrides
        ? stripLegacyBackendMount(override)
        : override
      : this.config.baseURL;
    const timeout = overrideConfig?.timeout ?? this.config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
    // A per-call `apiKey` wins over the service's configured key (already expanded into
    // `this.headers`); an explicit override `x-api-key` header wins over both.
    const headers = mergeHeaders(this.headers, apiKeyHeader(overrideConfig?.apiKey), overrideConfig?.headers);
    return new SwapsApi({ baseUrl, headers, timeout });
  }

  /**
   * Run one delegated `SwapsApi` call and wrap it in `Result<T>`. A thrown `SwapsApiError`
   * (network/timeout/HTTP/parse/validation) becomes `{ ok: false }` with a canonical
   * `SodaxError<'EXTERNAL_API_ERROR'>`; the original error is kept as `cause`, and its
   * `code`/`status`/`issues` are projected into `context` so consumers can discriminate failure
   * kinds without unwrapping `cause`. Only a RESPONSE-shape validation failure is tagged
   * `reason: 'invalid_response_shape'` — a request-side validation error is a caller bug, not a
   * backend fault.
   */
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
        // Surface the wire code (TIMEOUT_ERROR / NETWORK_ERROR / HTTP_ERROR / PARSE_ERROR /
        // VALIDATION_ERROR) so consumers can branch without reaching into `cause`.
        context.code = error.code;
        // `issues` is present only for RESPONSE-shape validation failures (set in http.ts). A
        // request-side VALIDATION_ERROR (serializeIntentRequest / rejectBigint) carries none, so
        // only the former is tagged as a backend response-shape problem.
        if (error.code === 'VALIDATION_ERROR' && error.context.issues !== undefined) {
          context.reason = 'invalid_response_shape';
          // swaps-api stores the thrown ValiError here; flatten it to the same `v.flatten(issues)`
          // shape BackendApiService emits so both backend clients report identical `context.issues`,
          // and so the detail survives SodaxError.toJSON (which reduces a raw Error to name+message).
          const issues = error.context.issues;
          context.issues = issues instanceof v.ValiError ? v.flatten(issues.issues) : issues;
        }
        if (error.context.status !== undefined) context.status = error.context.status;
        // The apiguard's 401/403 are terminal config problems only the consumer can fix (issue #389):
        // point at the fix instead of leaving a bare status. The key itself is never logged.
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

  /**
   * Drop the SDK-only display field `feeAmount` before an intent reaches the strict wire serializer.
   * `sodax.swaps.createIntent` returns `Intent & FeeAmount`, which is structurally assignable to the
   * wire `IntentRequestV2` and so gets passed straight into the intent-carrying endpoints; the extra
   * bigint would trip `serializeIntentRequest`. This is a no-op for an already-clean `IntentRequestV2`.
   */
  private static toWireIntent(intent: IntentRequestV2): IntentRequestV2 {
    const { feeAmount: _feeAmount, ...rest }: IntentRequestV2 & Partial<FeeAmount> = intent;
    return rest;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tokens
  // ──────────────────────────────────────────────────────────────────────

  /** Fetch all supported swap tokens grouped by SpokeChainKey. */
  public async getTokens(config?: RequestOverrideConfig): Promise<Result<GetSwapTokensResponseV2>> {
    return this.toResult('/swaps/tokens', c => c.getTokens(), config);
  }

  /** Fetch supported swap tokens for a single SpokeChainKey. */
  public async getTokensByChain(
    chainKey: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetSwapTokensByChainResponseV2>> {
    return this.toResult(`/swaps/tokens/${chainKey}`, c => c.getTokensByChain(chainKey), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Quote · deadline
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Get a solver quote for a cross-chain swap. Pass `query.includeTxData = true` to also build an
   * unsigned create-intent transaction (`txData`); in that case `srcAddress`/`dstAddress` are required.
   */
  public async getQuote(
    body: QuoteRequestV2,
    query?: QuoteQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<QuoteResponseV2>> {
    return this.toResult('/swaps/quote', c => c.getQuote(body, query), config);
  }

  /** Compute a swap deadline (hub timestamp + `offsetSeconds`, default 300s). */
  public async getDeadline(
    query?: DeadlineQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<DeadlineResponseV2>> {
    return this.toResult('/swaps/deadline', c => c.getDeadline(query), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Allowance · approve · create intent
  // ──────────────────────────────────────────────────────────────────────

  /** Check whether the source token allowance is already sufficient for the intent. */
  public async checkAllowance(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<AllowanceCheckResponseV2>> {
    return this.toResult('/swaps/allowance/check', c => c.checkAllowance(body), config);
  }

  /** Build an unsigned token-approval transaction for the source token. */
  public async approve(body: CreateIntentParamsV2, config?: RequestOverrideConfig): Promise<Result<ApproveResponseV2>> {
    return this.toResult('/swaps/approve', c => c.approve(body), config);
  }

  /** Build an unsigned create-intent transaction. */
  public async createIntent(
    body: CreateIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateIntentResponseV2>> {
    return this.toResult('/swaps/intents', c => c.createIntent(body), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Intent lifecycle: submit · status · cancel · hash · packet · extra-data
  // ──────────────────────────────────────────────────────────────────────

  /** Submit the broadcast intent tx to the relay. */
  public async submitIntent(
    body: SubmitIntentRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitIntentResponseV2>> {
    return this.toResult('/swaps/intents/submit', c => c.submitIntent(body), config);
  }

  /** Poll the solver for intent execution status. */
  public async getStatus(body: StatusRequestV2, config?: RequestOverrideConfig): Promise<Result<StatusResponseV2>> {
    return this.toResult('/swaps/intents/status', c => c.getStatus(body), config);
  }

  /** Build an unsigned cancel-intent transaction (the `intent` bigint numerics serialize to strings). */
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

  /** Compute the keccak256 hash of an Intent struct (bigint numerics serialize to strings). */
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

  /** Long-poll the relayer until the fill packet lands on the destination chain. */
  public async getSolvedIntentPacket(
    body: IntentPacketRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentPacketResponseV2>> {
    return this.toResult('/swaps/intents/packet', c => c.getSolvedIntentPacket(body), config);
  }

  /** Recover the relay extra data needed by `/swaps/intents/submit` (provide EITHER `txHash` OR `intent`). */
  public async getIntentSubmitTxExtraData(
    body: IntentExtraDataRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<IntentExtraDataResponseV2>> {
    const normalized = body.intent ? { ...body, intent: SwapsApiService.toWireIntent(body.intent) } : body;
    return this.toResult('/swaps/intents/extra-data', c => c.getIntentSubmitTxExtraData(normalized), config);
  }

  /** Get the on-chain fill state for an intent by its hub-chain tx hash. */
  public async getFilledIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentStateV2>> {
    return this.toResult(`/swaps/intents/${txHash}/fill`, c => c.getFilledIntent(txHash), config);
  }

  /** Look up an Intent struct by its hub-chain creation tx hash. */
  public async getIntent(txHash: string, config?: RequestOverrideConfig): Promise<Result<GetIntentResponseV2>> {
    return this.toResult(`/swaps/intents/${txHash}`, c => c.getIntent(txHash), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Limit orders · gas · fees
  // ──────────────────────────────────────────────────────────────────────

  /** Build an unsigned create-limit-order-intent transaction (create-intent with optional `deadline`). */
  public async createLimitOrderIntent(
    body: CreateLimitOrderParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateLimitOrderResponseV2>> {
    return this.toResult('/swaps/limit-orders', c => c.createLimitOrderIntent(body), config);
  }

  /** Estimate gas for a raw transaction on a spoke chain (bigint `tx` numerics serialize to strings). */
  public async estimateGas(
    body: GasEstimateRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<GasEstimateResponseV2>> {
    return this.toResult('/swaps/gas/estimate', c => c.estimateGas(body), config);
  }

  /** Compute the partner fee for a given input amount. */
  public async getPartnerFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.toResult('/swaps/fees/partner', c => c.getPartnerFee(query), config);
  }

  /** Compute the protocol (solver) fee for a given input amount. */
  public async getSolverFee(query: FeeQueryV2, config?: RequestOverrideConfig): Promise<Result<FeeResponseV2>> {
    return this.toResult('/swaps/fees/solver', c => c.getSolverFee(query), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Submit-tx state machine
  // ──────────────────────────────────────────────────────────────────────

  /** Submit a swap transaction to be processed (relay, post-execution, etc.). Idempotent on `(txHash, srcChainKey)`.
   *  Response is immediate after successful submission. Use getSubmitTxStatus to poll the status of the submission.
   */
  public async submitTx(body: SubmitTxRequestV2, config?: RequestOverrideConfig): Promise<Result<SubmitTxResponseV2>> {
    return this.toResult(
      '/swaps/submit-tx',
      c => c.submitTx({ ...body, intent: SwapsApiService.toWireIntent(body.intent) }),
      config,
    );
  }

  /** Get the processing status of a submitted swap transaction by `(txHash, srcChainKey)`. */
  public async getSubmitTxStatus(
    query: SubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<SubmitTxStatusResponseV2>> {
    return this.toResult('/swaps/submit-tx/status', c => c.getSubmitTxStatus(query), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Utilities (parity with BackendApiService)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Merge additional headers into the service's default header set. Existing
   * keys are overwritten; keys absent from `headers` are preserved. Applied to
   * every subsequent call (the delegated client is rebuilt per call).
   */
  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
  }

  /** Return the base URL the service is currently pointing at. */
  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /**
   * Return the effective per-request timeout (ms) — the same value {@link buildClient} resolves, so
   * `SwapsApiConfig.timeout` being optional never leaks an `undefined` ceiling.
   *
   * Callers bounding a request tighter than this need it as the CEILING, because a
   * `RequestOverrideConfig.timeout` REPLACES the service value rather than lowering it: an override
   * derived from a caller budget alone would raise the bound whenever that budget is the larger of the
   * two. `SubmitTxAttempt.requestTimeout` clamps against both (`min(budget left in the attempt, this)`).
   */
  public getTimeout(): number {
    return this.config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
  }
}
