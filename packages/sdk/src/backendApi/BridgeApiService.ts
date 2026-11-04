// packages/sdk/src/backendApi/BridgeApiService.ts

import { BridgeApi, BridgeApiError } from '@sodax/bridge-api';
import type {
  BaseApiConfig,
  BitcoinBoundExtrasV2,
  PartnerFeeV2,
  BridgeAllowanceCheckResponseV2,
  BridgeApproveResponseV2,
  BridgeFeeRequestV2,
  BridgeFeeResponseV2,
  BridgeQuoteRequestV2,
  BridgeableAmountResponseV2,
  BridgeableCheckResponseV2,
  BridgeSubmitTxRequestV2,
  BridgeSubmitTxResponseV2,
  BridgeSubmitTxStatusQueryV2,
  BridgeSubmitTxStatusResponseV2,
  CreateBridgeIntentParamsV2,
  CreateBridgeIntentResponseV2,
  GetBridgeTokensByChainResponseV2,
  GetBridgeTokensResponseV2,
  IBridgeApiV2,
  Result,
  SodaxLogger,
} from '@sodax/types';
import { DEFAULT_BACKEND_API_TIMEOUT } from '@sodax/types';
import * as v from 'valibot';

import { apiKeyHeader, assignHeaders, mergeHeaders, type RequestOverrideConfig } from './api-utils.js';
import { stripLegacyBackendMount } from './apiConfig.js';
import { SodaxError } from '../errors/SodaxError.js';
import { isAuthStatus } from '../errors/guards.js';
import { consoleLogger } from '../shared/logger.js';

/**
 * {@link IBridgeApiV2} with every method's return wrapped in `Result<T>` and an
 * optional trailing `RequestOverrideConfig`. `BridgeApiService` implements this
 * (rather than `IBridgeApiV2` directly) because it never throws — like
 * `SwapsApiService`, it returns `{ ok: false }` on failure instead of
 * `Promise<T>` rejection. The mapped type keeps the class in lockstep with the
 * canonical interface: every endpoint is covered with its exact payload types.
 */
type ResultifiedBridgeApiV2 = {
  [K in keyof IBridgeApiV2]: IBridgeApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

/**
 * Map the SDK-domain bridge params (`CreateBridgeIntentParams`) onto the wire DTO
 * {@link CreateBridgeIntentParamsV2} (swaps naming). The input is typed structurally rather
 * than imported from `../bridge/BridgeService.js` to keep `backendApi` free of a
 * `backendApi → bridge` import cycle.
 *
 * @param params - SDK-domain params (`srcToken`/`dstToken`/`amount`/`recipient`).
 * @param extras - Optional `srcPublicKey` / Bitcoin `bound` extras.
 */
export function toCreateBridgeIntentParamsV2(
  params: {
    srcChainKey: string;
    dstChainKey: string;
    srcToken: string;
    dstToken: string;
    amount: bigint;
    srcAddress: string;
    recipient: string;
  },
  extras?: { srcPublicKey?: string; bound?: BitcoinBoundExtrasV2; partnerFee?: PartnerFeeV2 },
): CreateBridgeIntentParamsV2 {
  return {
    srcChainKey: params.srcChainKey,
    dstChainKey: params.dstChainKey,
    inputToken: params.srcToken,
    outputToken: params.dstToken,
    inputAmount: params.amount.toString(),
    srcAddress: params.srcAddress,
    dstAddress: params.recipient,
    ...(extras?.srcPublicKey !== undefined ? { srcPublicKey: extras.srcPublicKey } : {}),
    ...(extras?.bound !== undefined ? { bound: extras.bound } : {}),
    ...(extras?.partnerFee !== undefined ? { partnerFee: extras.partnerFee } : {}),
  };
}

/**
 * HTTP client for the backend **Bridge API** (`/bridge/*`).
 *
 * A thin adapter over the standalone `@sodax/bridge-api` package (the single source of the wire
 * client — request building, per-chain `tx` validation/transform, response schemas, HTTP + retry).
 * This service adds the SDK conventions on top: `Result<T>` (it never throws), a `SodaxLogger`,
 * config resolution, and per-call `RequestOverrideConfig`.
 *
 * All public methods return `Promise<Result<T>>`. On network failure, timeout, non-2xx HTTP
 * response, or response-shape validation failure, the returned Result has `ok: false` with a
 * canonical `SodaxError<'EXTERNAL_API_ERROR'>` (`feature: 'backend'`, `context.api: 'bridge'`,
 * `context.endpoint`); the underlying `BridgeApiError` is preserved on `error.cause`.
 *
 * Per-call request overrides (base URL, timeout, headers, API key) can be passed as the
 * optional last argument to any method via `RequestOverrideConfig`.
 *
 * The Bridge API hangs off the shared gateway root as `/bridge/*` — a sibling of the data API's `/be`
 * mount, not a child of it, so `resolveBridgeApiConfig` returns a flat {@link BaseApiConfig} with no
 * `basePath`. It defaults to the same host as the swaps client but is not configured with it:
 * a `swapsApiConfig` slice does not move the bridge routes; set `baseURL` / `baseApiConfig` instead.
 *
 * Reachable on the Sodax facade as `sodax.api.bridge`.
 */
/** Construction options for {@link BridgeApiService}. */
export type BridgeApiServiceOptions = {
  /**
   * Whether a legacy `/be` suffix is trimmed off a per-call `baseURL` override. Defaults to `true`, the
   * migration behaviour. `BackendApiService` passes `false` when the `ApiConfig` states a `basePath`
   * explicitly: that marks a config written against the current contract, whose base URLs are deliberate
   * roots, so a trailing `/be` is a real path segment rather than the data API's mount.
   */
  trimLegacyOverrides?: boolean;
};

export class BridgeApiService implements ResultifiedBridgeApiV2 {
  // Fully-resolved bridge-API config supplied by the caller (BackendApiService resolves the
  // `ApiConfig` union via `resolveBridgeApiConfig`); this service does not resolve the union.
  private readonly config: BaseApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;
  /** See {@link BridgeApiServiceOptions.trimLegacyOverrides}. */
  private readonly trimsLegacyOverrides: boolean;

  constructor(config: BaseApiConfig, logger: SodaxLogger = consoleLogger, options: BridgeApiServiceOptions = {}) {
    this.config = config;
    // The config-level key arrives pre-baked in `headers` (see `withApiKey`); merged rather than
    // spread so two casings of one name cannot both survive — see `mergeHeaders`.
    this.headers = mergeHeaders(config.headers);
    this.logger = logger;
    this.trimsLegacyOverrides = options.trimLegacyOverrides ?? true;
  }

  /**
   * Build a `@sodax/bridge-api` client for a single call. Maps the SDK's {@link BaseApiConfig}
   * (`baseURL`/`timeout`/`headers`) to the package's config (`baseUrl`/`timeout`/`headers`), layering
   * the optional per-call `RequestOverrideConfig` on top (override wins per field; headers merge).
   * `timeout` falls back to the backend-API default so a config that omits it still gets a ceiling
   * rather than an unbounded request. Constructed per call so `setHeaders` mutations and per-call
   * overrides both take effect without caching stale state.
   */
  private buildClient(overrideConfig?: RequestOverrideConfig): BridgeApi {
    // A per-call override is normalized exactly like a configured base URL: it is the gateway root, so a
    // legacy `/be`-suffixed value must not nest `/bridge/*` under the data API's mount. `this.config.baseURL`
    // was already normalized during resolution — including the opt-out, which is why the same decision
    // has to reach this path too.
    const override = overrideConfig?.baseURL;
    const baseUrl = override
      ? this.trimsLegacyOverrides
        ? stripLegacyBackendMount(override)
        : override
      : this.config.baseURL;
    const timeout = overrideConfig?.timeout ?? this.config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
    // A per-call `apiKey` wins over the service's configured key (already expanded into `this.headers`);
    // an explicit override `x-api-key` header wins over both.
    const headers = mergeHeaders(this.headers, apiKeyHeader(overrideConfig?.apiKey), overrideConfig?.headers);
    return new BridgeApi({ baseUrl, headers, timeout });
  }

  /**
   * Run one delegated `BridgeApi` call and wrap it in `Result<T>`. A thrown `BridgeApiError`
   * (network/timeout/HTTP/parse/validation) becomes `{ ok: false }` with a canonical
   * `SodaxError<'EXTERNAL_API_ERROR'>`; the original error is kept as `cause`, and its
   * `code`/`status`/`issues` are projected into `context` so consumers can discriminate failure
   * kinds without unwrapping `cause`. Only a RESPONSE-shape validation failure is tagged
   * `reason: 'invalid_response_shape'` — a request-side validation error is a caller bug, not a
   * backend fault.
   */
  private async toResult<T>(
    endpoint: string,
    call: (client: BridgeApi) => Promise<T>,
    overrideConfig?: RequestOverrideConfig,
  ): Promise<Result<T, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const value = await call(this.buildClient(overrideConfig));
      return { ok: true, value };
    } catch (error) {
      const context: Record<string, unknown> = { api: 'bridge', endpoint };
      if (error instanceof BridgeApiError) {
        // Surface the wire code (TIMEOUT_ERROR / NETWORK_ERROR / HTTP_ERROR / PARSE_ERROR /
        // VALIDATION_ERROR) so consumers can branch without reaching into `cause`.
        context.code = error.code;
        // `issues` is present only for RESPONSE-shape validation failures (set in http.ts). A
        // request-side VALIDATION_ERROR (rejectBigint) carries none, so only the former is tagged
        // as a backend response-shape problem.
        if (error.code === 'VALIDATION_ERROR' && error.context.issues !== undefined) {
          context.reason = 'invalid_response_shape';
          // bridge-api stores the thrown ValiError here; flatten it to the same `v.flatten(issues)`
          // shape BackendApiService emits so both backend clients report identical `context.issues`,
          // and so the detail survives SodaxError.toJSON (which reduces a raw Error to name+message).
          const issues = error.context.issues;
          context.issues = issues instanceof v.ValiError ? v.flatten(issues.issues) : issues;
        }
        if (error.context.status !== undefined) context.status = error.context.status;
        // The apiguard's 401/403 are terminal config problems only the consumer can fix: point at the fix
        // instead of leaving a bare status. The key itself is never logged.
        if (isAuthStatus(error.context.status)) {
          this.logger.warn(
            `[BridgeApiService] ${endpoint} was rejected by the bridge API key guard (${error.context.status}). Configure a valid partner API key — new Sodax({ apiKey }) — see docs/CONFIGURE_SDK.md.`,
          );
        }
      }
      this.logger.error(`[BridgeApiService] Request to ${endpoint} failed`, error);
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

  // ──────────────────────────────────────────────────────────────────────
  // Tokens
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Fetch all supported bridge tokens grouped by SpokeChainKey.
   *
   * @returns `Result<GetBridgeTokensResponseV2>` — map of chain key → token list.
   */
  public async getTokens(config?: RequestOverrideConfig): Promise<Result<GetBridgeTokensResponseV2>> {
    return this.toResult('/bridge/tokens', c => c.getTokens(), config);
  }

  /**
   * Fetch supported bridge tokens for a single SpokeChainKey.
   *
   * @param chainKey - SODAX SpokeChainKey (e.g. `0xa4b1.arbitrum`, `solana`).
   * @returns `Result<GetBridgeTokensByChainResponseV2>` — token list for the chain.
   */
  public async getTokensByChain(
    chainKey: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetBridgeTokensByChainResponseV2>> {
    return this.toResult(`/bridge/tokens/${chainKey}`, c => c.getTokensByChain(chainKey), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Allowance · approve · create intent
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Check whether the source token allowance is already sufficient for the bridge.
   *
   * @returns `Result<BridgeAllowanceCheckResponseV2>` — `{ valid }`.
   */
  public async checkAllowance(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeAllowanceCheckResponseV2>> {
    return this.toResult('/bridge/allowance/check', c => c.checkAllowance(body), config);
  }

  /**
   * Build an unsigned token-approval transaction for the source token.
   *
   * @returns `Result<BridgeApproveResponseV2>` — `{ tx, resetTx? }` (chain-specific unsigned txs);
   * broadcast and mine `resetTx` first when it is present.
   */
  public async approve(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeApproveResponseV2>> {
    return this.toResult('/bridge/approve', c => c.approve(body), config);
  }

  /**
   * Build an unsigned spoke-deposit (create-bridge-intent) transaction.
   *
   * @returns `Result<CreateBridgeIntentResponseV2>` — `{ tx, relayData }` (no intent struct).
   */
  public async createBridgeIntent(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateBridgeIntentResponseV2>> {
    return this.toResult('/bridge/intents', c => c.createBridgeIntent(body), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Submit-tx state machine
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Submit a broadcast bridge (spoke-deposit) transaction to be processed (relayed).
   * Carries the FULL `relayData { address, payload }` envelope. Idempotent on `(txHash, srcChainKey)`.
   *
   * @returns `Result<BridgeSubmitTxResponseV2>` — `{ success, data: { status, message } }`.
   */
  public async submitTx(
    body: BridgeSubmitTxRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeSubmitTxResponseV2>> {
    return this.toResult('/bridge/submit-tx', c => c.submitTx(body), config);
  }

  /**
   * Get the processing status of a submitted bridge transaction by `(txHash, srcChainKey)`.
   *
   * @returns `Result<BridgeSubmitTxStatusResponseV2>` — `{ success, data }` (processing state).
   */
  public async getSubmitTxStatus(
    query: BridgeSubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeSubmitTxStatusResponseV2>> {
    return this.toResult('/bridge/submit-tx/status', c => c.getSubmitTxStatus(query), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Fee · bridgeable quote (read-only; mirror the SDK-core client-side methods)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Bridge partner fee for an input amount (per-request `partnerFee` override, else the configured default).
   * NOTE: this is a pure client-side computation
   * in the SDK core (`sodax.bridge.getFee`) — prefer that (no round-trip); this HTTP variant exists for
   * parity with the backend `/bridge/fee` endpoint (for consumers using only `sodax.api.bridge`).
   *
   * @returns `Result<BridgeFeeResponseV2>` — `{ fee }` (decimal string).
   */
  public async getFee(body: BridgeFeeRequestV2, config?: RequestOverrideConfig): Promise<Result<BridgeFeeResponseV2>> {
    return this.toResult('/bridge/fee', c => c.getFee(body), config);
  }

  /**
   * Deposit capacity / withdrawal liquidity for a (from, to) token pair. Computable client-side in the
   * SDK core (`sodax.bridge.getBridgeableAmount`); this HTTP variant mirrors `/bridge/bridgeable-amount`.
   *
   * @returns `Result<BridgeableAmountResponseV2>` — `{ limit }`.
   */
  public async getBridgeableAmount(
    body: BridgeQuoteRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeableAmountResponseV2>> {
    return this.toResult('/bridge/bridgeable-amount', c => c.getBridgeableAmount(body), config);
  }

  /**
   * Whether a (from, to) token pair is bridgeable. Computable client-side in the SDK core
   * (`sodax.bridge.isBridgeable`); this HTTP variant mirrors `/bridge/bridgeable/check`.
   *
   * @returns `Result<BridgeableCheckResponseV2>` — `{ bridgeable }`.
   */
  public async isBridgeable(
    body: BridgeQuoteRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeableCheckResponseV2>> {
    return this.toResult('/bridge/bridgeable/check', c => c.isBridgeable(body), config);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Utilities (parity with SwapsApiService)
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
