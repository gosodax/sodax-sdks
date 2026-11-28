import type {
  Address,
  GetAllConfigApiResponse,
  GetChainsApiResponse,
  GetMoneyMarketReserveAssetsApiResponse,
  GetMoneyMarketTokensApiResponse,
  GetMoneyMarketTokensByChainIdApiResponse,
  GetRelayChainIdMapApiResponse,
  GetSpokeChainConfigApiResponse,
  GetSwapTokensApiResponse,
  GetSwapTokensByChainIdApiResponse,
  IConfigApiV1,
  Result,
  SpokeChainKey,
  ApiConfig,
  SodaxLogger,
} from '@sodax/types';
import { BACKEND_API_BASE_PATH, DEFAULT_API_BASE_URL, DEFAULT_SPONSORING_API_ENDPOINT } from '@sodax/types';
import { consoleLogger } from '../shared/logger.js';

import * as v from 'valibot';
import {
  assignHeaders,
  makeRequest,
  resolveRequestConfig,
  toExternalApiError,
  toInvalidResponseShapeError,
  withApiKey,
  type RequestConfig,
  type RequestOverrideConfig,
} from './api-utils.js';
import { SwapsApiService } from './SwapsApiService.js';
import { SponsoringApiService } from './SponsoringApiService.js';
import { BridgeApiService } from './BridgeApiService.js';
import { LeverageYieldApiService } from './LeverageYieldApiService.js';
import {
  hasExplicitBasePath,
  hasLegacyBackendBaseURL,
  isMissingVersionPrefix,
  stripLegacyBackendMount,
  resolveBaseApiConfig,
  resolveBridgeApiConfig,
  resolveLeverageYieldApiConfig,
  resolveSponsoringApiConfig,
  resolveSwapsApiConfig,
  type ResolvedBackendApiConfig,
} from './apiConfig.js';
import * as schemas from './backendApiSchemas.js';
import type { SodaxError } from '../errors/SodaxError.js';

export interface IntentResponse {
  intentHash: string;
  txHash: string;
  logIndex: number;
  chainId: number;
  blockNumber: number;
  open: boolean;
  intent: {
    intentId: string;
    creator: string;
    inputToken: string;
    outputToken: string;
    inputAmount: string;
    minOutputAmount: string;
    deadline: string;
    allowPartialFill: boolean;
    srcChain: number;
    dstChain: number;
    srcAddress: string;
    dstAddress: string;
    solver: string;
    data: string;
  };
  events: unknown[];
}

export interface UserIntentsResponse {
  total: number;
  offset: number;
  limit: number;
  items: IntentResponse[];
}

export interface OrderbookResponse {
  total: number;
  data: Array<{
    intentState: {
      exists: boolean;
      remainingInput: string;
      receivedOutput: string;
      pendingPayment: boolean;
    };
    intentData: {
      intentId: string;
      creator: string;
      inputToken: string;
      outputToken: string;
      inputAmount: string;
      minOutputAmount: string;
      deadline: string;
      allowPartialFill: boolean;
      srcChain: number;
      dstChain: number;
      srcAddress: string;
      dstAddress: string;
      solver: string;
      data: string;
      intentHash: string;
      txHash: string;
      blockNumber: number;
    };
  }>;
}

export interface MoneyMarketPosition {
  userAddress: string;
  positions: Array<{
    reserveAddress: string;
    aTokenAddress: string;
    variableDebtTokenAddress: string;
    aTokenBalance: string;
    variableDebtTokenBalance: string;
    blockNumber: number;
  }>;
}

/** All numeric values are decimal strings to avoid `bigint` serialisation issues. */
export interface MoneyMarketAsset {
  reserveAddress: string;
  aTokenAddress: string;
  totalATokenBalance: string;
  variableDebtTokenAddress: string;
  totalVariableDebtTokenBalance: string;
  liquidityRate: string;
  symbol: string;
  totalSuppliers: number;
  totalBorrowers: number;
  variableBorrowRate: string;
  stableBorrowRate: string;
  liquidityIndex: string;
  variableBorrowIndex: string;
  blockNumber: number;
}

export interface MoneyMarketAssetBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}

export interface MoneyMarketAssetSuppliers {
  suppliers: string[];
  total: number;
  offset: number;
  limit: number;
}

export interface MoneyMarketBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}

/** Bucket sizes 60s / 300s / 3600s / 86400s. */
export type OracleCandleInterval = (typeof schemas.ORACLE_CANDLE_INTERVALS)[number];

export interface OracleMarketInterval {
  /** Typed `string`, not `OracleCandleInterval`, so new backend intervals survive; check against `ORACLE_CANDLE_INTERVALS`. */
  key: string;
  label: string;
  seconds: number;
}

export interface OracleMarketsResponse {
  quote: string;
  intervals: OracleMarketInterval[];
  symbols: string[];
}

/** `timestamp` is bucket START in UNIX seconds; prices are USD decimal strings.
 * `final === false` marks the still-forming bucket; absent or `true` means closed. */
export interface OracleCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  final?: boolean;
}

/** Candles are oldest-first; no volume field. */
export interface OracleCandlesResponse {
  symbol: string;
  quote: string;
  interval: OracleCandleInterval;
  candles: OracleCandle[];
}

export type BackendApiServiceOptions = {
  /** Sent as `x-api-key`; sponsoring receives it only when its target is an allowed root. */
  apiKey?: string;
};

/** HTTP client for the SODAX backend API. All methods return `Result<T>` and never throw. */
export class BackendApiService implements IConfigApiV1 {
  public readonly swaps: SwapsApiService;
  public readonly sponsoring: SponsoringApiService;
  public readonly bridge: BridgeApiService;
  public readonly leverageYield: LeverageYieldApiService;

  // `baseURL` is the gateway root; `basePath` is this service's own mount below it.
  private readonly config: ResolvedBackendApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;

  /** A `RequestOverrideConfig.timeout` replaces (not caps) this, so clamp to it for a shorter per-call budget. */
  public get requestTimeoutMs(): number {
    return this.config.timeout;
  }
  /** An explicit `basePath` means complete roots, so per-call `baseURL` overrides are left untrimmed. */
  private readonly trimsLegacyOverrides: boolean;

  constructor(config: ApiConfig, logger: SodaxLogger = consoleLogger, options: BackendApiServiceOptions = {}) {
    this.config = withApiKey(resolveBaseApiConfig(config), options.apiKey);
    this.headers = { ...this.config.headers };
    this.logger = logger;
    this.trimsLegacyOverrides = !hasExplicitBasePath(config);
    // Resolve every slice up front so the diagnostics below inspect what each service will actually request.
    const swapsConfig = resolveSwapsApiConfig(config);
    const sponsoringConfig = resolveSponsoringApiConfig(config);
    const bridgeConfig = resolveBridgeApiConfig(config);
    const leverageYieldConfig = resolveLeverageYieldApiConfig(config);

    const shortRoots = (
      [
        ['backendApi', this.config.baseURL],
        ['api.swaps', swapsConfig.baseURL],
        ['api.bridge', bridgeConfig.baseURL],
        ['api.sponsoring', sponsoringConfig.baseURL],
      ] as const
    ).filter(([, baseURL]) => isMissingVersionPrefix(baseURL));
    if (shortRoots.length > 0) {
      const named = shortRoots.map(([service, baseURL]) => `${service} ("${baseURL}")`).join(', ');
      this.logger.warn(
        `[BackendApiService] api.baseURL is missing the gateway's version prefix for ${named}: every route resolves one segment short. Use "${DEFAULT_API_BASE_URL}" — the prefix is deployment-owned, so it belongs in baseURL, and only the data API has a basePath to compensate.`,
      );
    }
    if (hasLegacyBackendBaseURL(config)) {
      this.logger.warn(
        `[BackendApiService] api.baseURL should be the gateway root, not the backend data API's mount: trimmed "${BACKEND_API_BASE_PATH}" to "${this.config.baseURL}". Drop the suffix — the SDK appends it, and sibling services (/swaps, /bridge) must not sit under it.`,
      );
    }
    const overrideOptions = { trimLegacyOverrides: this.trimsLegacyOverrides };
    // The config-level key is baked into every gateway service's headers; configured headers win.
    this.swaps = new SwapsApiService(withApiKey(swapsConfig, options.apiKey), this.logger, overrideOptions);
    // Sponsoring routes independently; its inherited key stays un-baked and is gated per request (see `inheritedApiKey`).
    this.sponsoring = new SponsoringApiService(sponsoringConfig, this.logger, {
      inheritedApiKey: options.apiKey,
      inheritedApiKeyBaseURLs: [DEFAULT_SPONSORING_API_ENDPOINT, this.config.baseURL],
    });
    // Bridge does not inherit this service's `basePath`, so a `swapsApiConfig` slice moves swaps only.
    this.bridge = new BridgeApiService(withApiKey(bridgeConfig, options.apiKey), this.logger, overrideOptions);
    this.leverageYield = new LeverageYieldApiService(
      withApiKey(leverageYieldConfig, options.apiKey),
      this.logger,
      overrideOptions,
    );
  }

  /**
   * Mount applied here so `error.context.endpoint` stays route-relative and survives a `baseURL` override;
   * overrides get the legacy trim to avoid `/be/be/…`. Defaults are listed by field so `basePath` can't leak.
   */
  private async send<T>(endpoint: string, config: RequestConfig): Promise<T> {
    const { baseURL, ...rest } = config;
    const overrideBaseURL =
      baseURL !== undefined && this.trimsLegacyOverrides ? stripLegacyBackendMount(baseURL) : baseURL;
    return makeRequest<T>({
      endpoint: `${this.config.basePath}${endpoint}`,
      config: resolveRequestConfig(
        { ...rest, ...(overrideBaseURL === undefined ? {} : { baseURL: overrideBaseURL }) },
        { baseURL: this.config.baseURL, timeout: this.config.timeout, headers: this.headers },
      ),
      logger: this.logger,
      serviceLabel: 'BackendApiService',
    });
  }

  /** Validates the body against `schema`; a mismatch yields `EXTERNAL_API_ERROR` with `reason: 'invalid_response_shape'`. */
  private async request<S extends v.GenericSchema>(
    endpoint: string,
    config: RequestConfig,
    schema: S,
  ): Promise<Result<v.InferOutput<S>, SodaxError<'EXTERNAL_API_ERROR'>>> {
    try {
      const raw = await this.send<unknown>(endpoint, config);
      const parsed = v.safeParse(schema, raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: toInvalidResponseShapeError({
            api: 'backend',
            feature: 'backend',
            endpoint,
            issues: v.flatten(parsed.issues),
          }),
        };
      }
      return { ok: true, value: parsed.output };
    } catch (error) {
      return { ok: false, error: toExternalApiError({ api: 'backend', feature: 'backend', endpoint, error }) };
    }
  }

  /** No shape validation: for config/relay reads too large to validate or carrying `bigint`s; `ConfigService` falls back to defaults. */
  private async requestUnvalidated<T>(endpoint: string, config: RequestConfig): Promise<Result<T>> {
    try {
      const value = await this.send<T>(endpoint, config);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toExternalApiError({ api: 'backend', feature: 'backend', endpoint, error }) };
    }
  }

  /** `txHash` must be a hub-chain (Sonic) transaction hash. */
  public async getIntentByTxHash(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentResponse>> {
    return this.request(`/intent/tx/${txHash}`, { ...config, method: 'GET' }, schemas.IntentResponseSchema);
  }

  public async getIntentByHash(intentHash: string, config?: RequestOverrideConfig): Promise<Result<IntentResponse>> {
    return this.request(`/intent/${intentHash}`, { ...config, method: 'GET' }, schemas.IntentResponseSchema);
  }

  public async getOrderbook(
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<OrderbookResponse>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/solver/orderbook?${queryString}`;

    return this.request(endpoint, { ...config, method: 'GET' }, schemas.OrderbookResponseSchema);
  }

  /** `startDate`/`endDate` are Unix timestamps in milliseconds. */
  public async getUserIntents(
    params: {
      userAddress: Address;
      startDate?: number;
      endDate?: number;
      limit?: string;
      offset?: string;
    },
    config?: RequestOverrideConfig,
  ): Promise<Result<UserIntentsResponse>> {
    const { userAddress, startDate, endDate, limit, offset } = params;
    const queryParams = new URLSearchParams();
    if (startDate) queryParams.append('startDate', new Date(startDate).toISOString());
    if (endDate) queryParams.append('endDate', new Date(endDate).toISOString());
    if (limit) queryParams.append('limit', limit);
    if (offset) queryParams.append('offset', offset);

    const queryString = queryParams.toString();
    const endpoint =
      queryString.length > 0 ? `/intent/user/${userAddress}?${queryString}` : `/intent/user/${userAddress}`;

    return this.request(endpoint, { ...config, method: 'GET' }, schemas.UserIntentsResponseSchema);
  }

  public async getMoneyMarketPosition(
    userAddress: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketPosition>> {
    return this.request(
      `/moneymarket/position/${userAddress}`,
      { ...config, method: 'GET' },
      schemas.MoneyMarketPositionSchema,
    );
  }

  public async getAllMoneyMarketAssets(config?: RequestOverrideConfig): Promise<Result<MoneyMarketAsset[]>> {
    return this.request('/moneymarket/asset/all', { ...config, method: 'GET' }, schemas.MoneyMarketAssetsSchema);
  }

  public async getMoneyMarketAsset(
    reserveAddress: string,
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketAsset>> {
    return this.request(
      `/moneymarket/asset/${reserveAddress}`,
      { ...config, method: 'GET' },
      schemas.MoneyMarketAssetSchema,
    );
  }

  public async getMoneyMarketAssetBorrowers(
    reserveAddress: string,
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketAssetBorrowers>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/moneymarket/asset/${reserveAddress}/borrowers?${queryString}`;

    return this.request(endpoint, { ...config, method: 'GET' }, schemas.MoneyMarketAssetBorrowersSchema);
  }

  public async getMoneyMarketAssetSuppliers(
    reserveAddress: string,
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketAssetSuppliers>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/moneymarket/asset/${reserveAddress}/suppliers?${queryString}`;

    return this.request(endpoint, { ...config, method: 'GET' }, schemas.MoneyMarketAssetSuppliersSchema);
  }

  public async getAllMoneyMarketBorrowers(
    params: { offset: string; limit: string },
    config?: RequestOverrideConfig,
  ): Promise<Result<MoneyMarketBorrowers>> {
    const queryParams = new URLSearchParams();
    queryParams.append('offset', params.offset);
    queryParams.append('limit', params.limit);

    const queryString = queryParams.toString();
    const endpoint = `/moneymarket/borrowers?${queryString}`;

    return this.request(endpoint, { ...config, method: 'GET' }, schemas.MoneyMarketBorrowersSchema);
  }

  public async getOracleMarkets(config?: RequestOverrideConfig): Promise<Result<OracleMarketsResponse>> {
    return this.request('/oracle/markets', { ...config, method: 'GET' }, schemas.OracleMarketsResponseSchema);
  }

  /**
   * `from`/`to` are UNIX seconds, range `[from, to)` of at most 5000 buckets (else HTTP 400); unknown symbols return
   * `candles: []`, not 404. Re-poll while the last candle has `final === false`; responses are cached ~10s server-side.
   */
  public async getOracleCandles(
    params: { symbol: string; interval: OracleCandleInterval; from: number; to: number },
    config?: RequestOverrideConfig,
  ): Promise<Result<OracleCandlesResponse>> {
    const queryParams = new URLSearchParams();
    queryParams.append('symbol', params.symbol);
    queryParams.append('interval', params.interval);
    queryParams.append('from', String(params.from));
    queryParams.append('to', String(params.to));

    const queryString = queryParams.toString();
    const endpoint = `/oracle/candles?${queryString}`;

    return this.request(endpoint, { ...config, method: 'GET' }, schemas.OracleCandlesResponseSchema);
  }

  public async getAllConfig(config?: RequestOverrideConfig): Promise<Result<GetAllConfigApiResponse>> {
    return this.requestUnvalidated<GetAllConfigApiResponse>('/config/all', { ...config, method: 'GET' });
  }

  public async getChains(config?: RequestOverrideConfig): Promise<Result<GetChainsApiResponse>> {
    return this.request('/config/spoke/chains', { ...config, method: 'GET' }, schemas.GetChainsResponseSchema);
  }

  public async getSwapTokens(config?: RequestOverrideConfig): Promise<Result<GetSwapTokensApiResponse>> {
    return this.request('/config/swap/tokens', { ...config, method: 'GET' }, schemas.TokensByChainMapSchema);
  }

  public async getSwapTokensByChainId(
    chainId: SpokeChainKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetSwapTokensByChainIdApiResponse>> {
    return this.request(`/config/swap/${chainId}/tokens`, { ...config, method: 'GET' }, schemas.TokensListSchema);
  }

  public async getMoneyMarketTokens(config?: RequestOverrideConfig): Promise<Result<GetMoneyMarketTokensApiResponse>> {
    return this.request('/config/money-market/tokens', { ...config, method: 'GET' }, schemas.TokensByChainMapSchema);
  }

  public async getMoneyMarketReserveAssets(
    config?: RequestOverrideConfig,
  ): Promise<Result<GetMoneyMarketReserveAssetsApiResponse>> {
    return this.request(
      '/config/money-market/reserve-assets',
      { ...config, method: 'GET' },
      schemas.ReserveAssetsSchema,
    );
  }

  public async getMoneyMarketTokensByChainId(
    chainId: SpokeChainKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetMoneyMarketTokensByChainIdApiResponse>> {
    return this.request(
      `/config/money-market/${chainId}/tokens`,
      { ...config, method: 'GET' },
      schemas.TokensListSchema,
    );
  }

  public async getRelayChainIdMap(config?: RequestOverrideConfig): Promise<Result<GetRelayChainIdMapApiResponse>> {
    return this.requestUnvalidated<GetRelayChainIdMapApiResponse>('/config/relay/chain-id-map', {
      ...config,
      method: 'GET',
    });
  }

  public async getSpokeChainConfig(config?: RequestOverrideConfig): Promise<Result<GetSpokeChainConfigApiResponse>> {
    return this.requestUnvalidated<GetSpokeChainConfigApiResponse>('/config/spoke/all-chains-configs', {
      ...config,
      method: 'GET',
    });
  }

  /** Also propagates to `swaps`, `bridge` and `leverageYield`, but never `sponsoring` (independent origin; no credential leak). */
  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
    this.swaps.setHeaders(headers);
    this.leverageYield.setHeaders(headers);
    this.bridge.setHeaders(headers);
  }

  /** Gateway root without this service's mount (legacy `/be` suffix trimmed); requests go to `baseURL + basePath + route`. */
  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /** `/be` by default, or the configured `basePath` (`''` when addressed directly at its origin). */
  public getBasePath(): string {
    return this.config.basePath;
  }
}
