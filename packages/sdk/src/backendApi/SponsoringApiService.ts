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

export type SponsoringApiServiceOptions = {
  /**
   * Sent only to `inheritedApiKeyBaseURLs`; not baked into headers, since a per-request `baseURL` would carry it
   * off-gateway. Outranked by the slice `apiKey` and by headers.
   */
  inheritedApiKey?: string;
  /** Roots the inherited key may be sent to — the packaged sponsoring default and the shared gateway. */
  inheritedApiKeyBaseURLs?: readonly string[];
};

/** Uncached client; transport errors use `feature: 'backend'` (only the orchestrator uses `'sponsoring'`). */
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

  /** Evaluated per call because a `RequestOverrideConfig.baseURL` retargets the request. */
  private inheritedKeyFor(baseURL: string): string | undefined {
    if (!this.inheritedApiKey) return undefined;
    return this.inheritedApiKeyBaseURLs.includes(trimTrailingSlashes(baseURL)) ? this.inheritedApiKey : undefined;
  }

  /** HTTP failures stay on `error.cause` for sponsor-error classification. */
  private async request<S extends v.GenericSchema>(
    endpoint: string,
    config: RequestConfig,
    schema: S,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      // Inherited key sits lowest, under the slice key, headers and per-request overrides.
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
      // `makeRequest` already logged this failure.
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

  /** An `alreadyActive` response is also successful. */
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
