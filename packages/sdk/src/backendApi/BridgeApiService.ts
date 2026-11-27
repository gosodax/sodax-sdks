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

/** `IBridgeApiV2` with `Result<T>` returns (never throws) and a trailing `RequestOverrideConfig`. */
type ResultifiedBridgeApiV2 = {
  [K in keyof IBridgeApiV2]: IBridgeApiV2[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R>>
    : never;
};

/** Maps SDK-domain bridge params onto the wire DTO; typed structurally to avoid a `backendApi → bridge` import cycle. */
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

export type BridgeApiServiceOptions = {
  /** Trim a legacy `/be` suffix off per-call `baseURL` overrides; `false` when the config sets `basePath` explicitly. */
  trimLegacyOverrides?: boolean;
};

/** `Result<T>` adapter over `@sodax/bridge-api` (`/bridge/*`); a gateway sibling of `/be`, not moved by `swapsApiConfig`. */
export class BridgeApiService implements ResultifiedBridgeApiV2 {
  private readonly config: BaseApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;
  private readonly trimsLegacyOverrides: boolean;

  constructor(config: BaseApiConfig, logger: SodaxLogger = consoleLogger, options: BridgeApiServiceOptions = {}) {
    this.config = config;
    // Merged rather than spread so two casings of one header name cannot both survive.
    this.headers = mergeHeaders(config.headers);
    this.logger = logger;
    this.trimsLegacyOverrides = options.trimLegacyOverrides ?? true;
  }

  /** Built per call so `setHeaders` and per-call overrides apply; `timeout` falls back to the default ceiling. */
  private buildClient(overrideConfig?: RequestOverrideConfig): BridgeApi {
    // Legacy `/be`-suffixed overrides must not nest `/bridge/*` under the data API's mount.
    const override = overrideConfig?.baseURL;
    const baseUrl = override
      ? this.trimsLegacyOverrides
        ? stripLegacyBackendMount(override)
        : override
      : this.config.baseURL;
    const timeout = overrideConfig?.timeout ?? this.config.timeout ?? DEFAULT_BACKEND_API_TIMEOUT;
    // Precedence: override `x-api-key` header > per-call `apiKey` > configured key.
    const headers = mergeHeaders(this.headers, apiKeyHeader(overrideConfig?.apiKey), overrideConfig?.headers);
    return new BridgeApi({ baseUrl, headers, timeout });
  }

  /** Only a RESPONSE-shape validation failure is tagged `invalid_response_shape`; request-side ones are caller bugs. */
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

  public async getTokens(config?: RequestOverrideConfig): Promise<Result<GetBridgeTokensResponseV2>> {
    return this.toResult('/bridge/tokens', c => c.getTokens(), config);
  }

  /** `chainKey` is a SpokeChainKey (e.g. `0xa4b1.arbitrum`, `solana`). */
  public async getTokensByChain(
    chainKey: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetBridgeTokensByChainResponseV2>> {
    return this.toResult(`/bridge/tokens/${chainKey}`, c => c.getTokensByChain(chainKey), config);
  }

  public async checkAllowance(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeAllowanceCheckResponseV2>> {
    return this.toResult('/bridge/allowance/check', c => c.checkAllowance(body), config);
  }

  /** Broadcast and mine `resetTx` first when present. */
  public async approve(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeApproveResponseV2>> {
    return this.toResult('/bridge/approve', c => c.approve(body), config);
  }

  /** Returns `{ tx, relayData }` with no intent struct. */
  public async createBridgeIntent(
    body: CreateBridgeIntentParamsV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<CreateBridgeIntentResponseV2>> {
    return this.toResult('/bridge/intents', c => c.createBridgeIntent(body), config);
  }

  /** Carries the FULL `relayData { address, payload }` envelope. Idempotent on `(txHash, srcChainKey)`. */
  public async submitTx(
    body: BridgeSubmitTxRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeSubmitTxResponseV2>> {
    return this.toResult('/bridge/submit-tx', c => c.submitTx(body), config);
  }

  public async getSubmitTxStatus(
    query: BridgeSubmitTxStatusQueryV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeSubmitTxStatusResponseV2>> {
    return this.toResult('/bridge/submit-tx/status', c => c.getSubmitTxStatus(query), config);
  }

  /** Prefer the client-side `sodax.bridge.getFee` (no round-trip); this mirrors `/bridge/fee` for API-only consumers. */
  public async getFee(body: BridgeFeeRequestV2, config?: RequestOverrideConfig): Promise<Result<BridgeFeeResponseV2>> {
    return this.toResult('/bridge/fee', c => c.getFee(body), config);
  }

  /** Computable client-side via `sodax.bridge.getBridgeableAmount`; this mirrors `/bridge/bridgeable-amount`. */
  public async getBridgeableAmount(
    body: BridgeQuoteRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeableAmountResponseV2>> {
    return this.toResult('/bridge/bridgeable-amount', c => c.getBridgeableAmount(body), config);
  }

  /** Computable client-side via `sodax.bridge.isBridgeable`; this mirrors `/bridge/bridgeable/check`. */
  public async isBridgeable(
    body: BridgeQuoteRequestV2,
    config?: RequestOverrideConfig,
  ): Promise<Result<BridgeableCheckResponseV2>> {
    return this.toResult('/bridge/bridgeable/check', c => c.isBridgeable(body), config);
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
