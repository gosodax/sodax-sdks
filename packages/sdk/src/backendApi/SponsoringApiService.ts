import type {
  IStellarSponsoringApi,
  Result,
  SodaxLogger,
  StellarSponsoredAccountRequest,
  StellarSponsoredAccountResponse,
  StellarSponsorConfig,
  SponsoringApiConfig,
} from '@sodax/types';
import { SPONSORING_API_STELLAR_BASE_PATH } from '@sodax/types';

import * as v from 'valibot';
import {
  apiKeyHeader,
  assignHeaders,
  makeRequest,
  mergeHeaders,
  resolveRequestConfig,
  toExternalApiError,
  toInvalidResponseShapeError,
  trimTrailingSlashes,
  type RequestConfig,
  type RequestOverrideConfig,
} from './api-utils.js';
import * as schemas from './sponsoringApiSchemas.js';
import type { SodaxError } from '../errors/SodaxError.js';
import { consoleLogger } from '../shared/logger.js';

/** Result-wrapped {@link IStellarSponsoringApi} with per-request overrides. */
type ResultifiedSponsoringApi = {
  [K in keyof IStellarSponsoringApi]: IStellarSponsoringApi[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: [...A, config?: RequestOverrideConfig]) => Promise<Result<R, SodaxError<'EXTERNAL_API_ERROR'>>>
    : never;
};

/** Construction options for {@link SponsoringApiService}. */
export type SponsoringApiServiceOptions = {
  /**
   * The instance-wide `new Sodax({ apiKey })`, which sponsoring inherits only when its effective
   * target is one of `inheritedApiKeyBaseURLs`. Deliberately not baked into the headers: a per-request
   * `baseURL` retargets the call while keeping the default headers, which would carry the credential
   * off-gateway. Outranked by the configured slice key (`SponsoringApiConfig.apiKey`) and by headers.
   */
  inheritedApiKey?: string;
  /** Roots the inherited key may be sent to — the packaged sponsoring default and the shared gateway. */
  inheritedApiKeyBaseURLs?: readonly string[];
};

/**
 * Uncached HTTP client for the sponsoring API. Stellar orchestration and
 * config caching belong to `SponsoringService`.
 *
 * Transport errors use `feature: 'backend'`; only the user-facing orchestrator
 * uses `feature: 'sponsoring'`.
 */
export class SponsoringApiService implements ResultifiedSponsoringApi {
  private readonly config: SponsoringApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;
  private readonly inheritedApiKey: string | undefined;
  private readonly inheritedApiKeyBaseURLs: readonly string[];

  constructor(
    config: SponsoringApiConfig,
    logger: SodaxLogger = consoleLogger,
    options: SponsoringApiServiceOptions = {},
  ) {
    this.config = config;
    // Explicit headers may override the `apiKey` convenience option, whatever casing they use.
    this.headers = mergeHeaders(apiKeyHeader(config.apiKey), config.headers);
    this.logger = logger;
    this.inheritedApiKey = options.inheritedApiKey;
    this.inheritedApiKeyBaseURLs = (options.inheritedApiKeyBaseURLs ?? []).map(trimTrailingSlashes);
  }

  /**
   * The inherited instance key, but only for a request whose effective target is an allowed root.
   * Evaluated per call because a `RequestOverrideConfig.baseURL` retargets the request.
   */
  private inheritedKeyFor(baseURL: string): string | undefined {
    if (!this.inheritedApiKey) return undefined;
    return this.inheritedApiKeyBaseURLs.includes(trimTrailingSlashes(baseURL)) ? this.inheritedApiKey : undefined;
  }

  /**
   * Validate a response while preserving HTTP failures on `error.cause` for
   * sponsor-error classification.
   */
  private async request<S extends v.GenericSchema>(
    endpoint: string,
    config: RequestConfig,
    schema: S,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      // The inherited key sits LOWEST, under the configured slice key and headers; `resolveRequestConfig`
      // then layers the per-request `apiKey` and headers on top.
      const inherited = apiKeyHeader(this.inheritedKeyFor(config.baseURL || this.config.baseURL));
      const raw = await makeRequest<unknown>({
        endpoint,
        config: resolveRequestConfig(config, { ...this.config, headers: mergeHeaders(inherited, this.headers) }),
        logger: this.logger,
        serviceLabel: 'SponsoringApiService',
      });
      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: toInvalidResponseShapeError({
            api: 'sponsoring',
            feature: 'backend',
            endpoint,
            issues: v.flatten(parsed.issues),
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      // `makeRequest` already logged this failure under the same service label — don't double-log.
      return { ok: false, error: toExternalApiError({ api: 'sponsoring', feature: 'backend', endpoint, error }) };
    }
  }

  /** Fetch build parameters, including the rotatable sponsor account. */
  public async getStellarSponsorConfig(
    config?: RequestOverrideConfig,
  ): Promise<Result<StellarSponsorConfig, SodaxError<'EXTERNAL_API_ERROR'>>> {
    return this.request(
      `${SPONSORING_API_STELLAR_BASE_PATH}/config`,
      { ...config, method: 'GET' },
      schemas.StellarSponsorConfigSchema,
    );
  }

  /**
   * Submit a client-signed transaction for sponsor co-signing. An
   * `alreadyActive` response is also successful.
   */
  public async createStellarSponsoredAccount(
    body: StellarSponsoredAccountRequest,
    config?: RequestOverrideConfig,
  ): Promise<Result<StellarSponsoredAccountResponse, SodaxError<'EXTERNAL_API_ERROR'>>> {
    return this.request(
      `${SPONSORING_API_STELLAR_BASE_PATH}/accounts`,
      // The endpoint rejects extra fields.
      { ...config, method: 'POST', body: JSON.stringify({ data: body.data }) },
      schemas.StellarSponsoredAccountResponseSchema,
    );
  }

  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
  }

  public getBaseURL(): string {
    return this.config.baseURL;
  }
}
