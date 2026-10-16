// packages/sdk/src/services/BackendApiService.ts

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

/** Full details of a single swap intent as stored and returned by the backend. */
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

/** Paginated list of intents created by a specific user wallet. */
export interface UserIntentsResponse {
  total: number;
  offset: number;
  limit: number;
  items: IntentResponse[];
}

/** Paginated snapshot of open swap intents currently awaiting solver execution. */
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

/** A user's current supply and borrow positions across all money market reserves. */
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

/**
 * On-chain state for a single money market reserve asset, including aggregate
 * supply/borrow balances, current interest rates, and participant counts.
 * All numeric values are returned as decimal strings to avoid `bigint`
 * serialisation issues.
 */
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

/** Paginated list of wallet addresses that currently hold an active borrow position against a specific reserve. */
export interface MoneyMarketAssetBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}

/** Paginated list of wallet addresses that currently hold an active supply position in a specific reserve. */
export interface MoneyMarketAssetSuppliers {
  suppliers: string[];
  total: number;
  offset: number;
  limit: number;
}

/** Paginated list of all wallet addresses that hold an active borrow position across any money market reserve. */
export interface MoneyMarketBorrowers {
  borrowers: string[];
  total: number;
  offset: number;
  limit: number;
}

/** Interval keys accepted by the oracle candles endpoint (bucket sizes 60s / 300s / 3600s / 86400s). */
export type OracleCandleInterval = (typeof schemas.ORACLE_CANDLE_INTERVALS)[number];

/** One selectable candle interval in the oracle markets discovery payload. */
export interface OracleMarketInterval {
  /**
   * Interval id for {@link BackendApiService.getOracleCandles}. Typed `string`, not
   * `OracleCandleInterval`: discovery must survive the backend adding an interval this SDK version
   * does not know, so membership-test against `ORACLE_CANDLE_INTERVALS` before passing it on.
   */
  key: string;
  label: string;
  seconds: number;
}

/** Discovery payload for the oracle candle store: quote currency, selectable intervals, and covered symbols. */
export interface OracleMarketsResponse {
  quote: string;
  intervals: OracleMarketInterval[];
  symbols: string[];
}

/**
 * One USD OHLC bucket. `timestamp` is the bucket START in UNIX seconds; prices are USD decimal
 * strings. Treat `final === false` as "still forming" — the backend sends it only on the current
 * bucket and omits it on closed ones, so absent (or `true`) means closed.
 */
export interface OracleCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  final?: boolean;
}

/** GET /oracle/candles response: the echoed query dimensions plus oldest-first candles (no volume field). */
export interface OracleCandlesResponse {
  symbol: string;
  quote: string;
  interval: OracleCandleInterval;
  candles: OracleCandle[];
}

/** Construction options for {@link BackendApiService}. */
export type BackendApiServiceOptions = {
  /**
   * Config-level API key for every gateway service (`new Sodax({ apiKey })`), sent as the `x-api-key`
   * header. Sponsoring receives it only when its target is an allowed root — see the constructor.
   */
  apiKey?: string;
};

/**
 * HTTP client for the SODAX backend API.
 *
 * Implements `IConfigApi` so that other services (e.g. `ConfigService`) can
 * fetch runtime chain/token configuration from the backend without being
 * coupled to a concrete HTTP implementation.
 *
 * Beyond configuration, the service exposes endpoints for:
 * - **Intents** — look up swap intents by transaction hash or intent hash.
 * - **Swaps** — submit a cross-chain swap transaction and poll its relay status.
 * - **Solver orderbook** — read open intents waiting to be filled.
 * - **Money market** — query per-user positions, per-reserve asset stats,
 *   and paginated borrower/supplier lists.
 * - **Oracle** — USD OHLC candle discovery and reads for charting.
 *
 * All public methods return `Promise<Result<T>>` — they never throw. On network
 * failure, timeout, non-2xx HTTP response, or unexpected response shape the
 * returned Result has `ok: false` with a canonical `SodaxError<'EXTERNAL_API_ERROR'>`
 * (`feature: 'backend'`, `context.api: 'backend'`) in the `error` field; the
 * underlying failure is preserved on `error.cause`.
 *
 * Per-call request overrides (base URL, timeout, headers, API key) can be passed as
 * the optional last argument to any method via `RequestOverrideConfig`.
 */
export class BackendApiService implements IConfigApiV1 {
  // sub-services exposing domain-specific APIs
  public readonly swaps: SwapsApiService;
  public readonly sponsoring: SponsoringApiService;
  public readonly bridge: BridgeApiService;
  public readonly leverageYield: LeverageYieldApiService;

  // resolved base-API config: the flat fields of the ApiConfig union with any `baseApiConfig` layered on
  // top. `baseURL` is the gateway root; `basePath` is this service's own mount below it.
  private readonly config: ResolvedBackendApiConfig;
  private readonly headers: Record<string, string>;
  private readonly logger: SodaxLogger;

  /**
   * The resolved request timeout. Exposed so a caller wanting a *shorter* per-call budget can clamp
   * to it: a `RequestOverrideConfig.timeout` replaces the configured value rather than capping it,
   * so passing a fixed override would silently lengthen requests for a consumer who configured a
   * stricter timeout.
   */
  public get requestTimeoutMs(): number {
    return this.config.timeout;
  }
  /**
   * Whether a legacy `/be` suffix is trimmed off a per-call `baseURL` override. Mirrors the config-level
   * decision: an explicit `basePath` means the consumer writes complete roots, so their per-call value is
   * left exactly as given rather than having a real path segment eaten.
   */
  private readonly trimsLegacyOverrides: boolean;

  constructor(config: ApiConfig, logger: SodaxLogger = consoleLogger, options: BackendApiServiceOptions = {}) {
    this.config = withApiKey(resolveBaseApiConfig(config), options.apiKey);
    this.headers = { ...this.config.headers };
    this.logger = logger;
    this.trimsLegacyOverrides = !hasExplicitBasePath(config);
    // Resolve every slice up front: the diagnostics below inspect what each service will actually
    // request, which is the only way to catch a base URL that reaches a service through its own slice.
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
    // Each sub-service gets its concrete resolved config plus the shared logger — none of them sees the
    // `ApiConfig` union, and all must route diagnostics through the same consumer-selected sink. The
    // legacy-trim decision travels with them so their per-call overrides match the config-level choice.
    const overrideOptions = { trimLegacyOverrides: this.trimsLegacyOverrides };
    // The config-level key is baked into every gateway service's headers; configured headers win.
    this.swaps = new SwapsApiService(withApiKey(swapsConfig, options.apiKey), this.logger, overrideOptions);
    // Sponsoring routes independently, so it never trims and takes no override option. Its inherited key
    // stays UN-baked and is gated per request against these roots (see `inheritedApiKey`).
    this.sponsoring = new SponsoringApiService(sponsoringConfig, this.logger, {
      inheritedApiKey: options.apiKey,
      inheritedApiKeyBaseURLs: [DEFAULT_SPONSORING_API_ENDPOINT, this.config.baseURL],
    });
    // Bridge hangs off the same gateway root as `/bridge/*` — resolved from `baseApiConfig` but without
    // this service's `basePath`, so a `swapsApiConfig` slice moves swaps only (see `resolveBridgeApiConfig`).
    this.bridge = new BridgeApiService(withApiKey(bridgeConfig, options.apiKey), this.logger, overrideOptions);
    // `/leverage-yield/*` is another gateway sibling, resolved like bridge so it never inherits this
    // service's `basePath` — and it takes the same legacy-override decision.
    this.leverageYield = new LeverageYieldApiService(
      withApiKey(leverageYieldConfig, options.apiKey),
      this.logger,
      overrideOptions,
    );
  }

  /**
   * Issue the HTTP call for a route.
   *
   * The mount is applied here rather than at each route literal, so `error.context.endpoint` stays
   * route-relative and the mount survives a per-call `baseURL` override — that retargets the gateway
   * root, not which service the route belongs to. For the same reason an override is put through the
   * legacy-mount trim: without it, passing the old `…/v1/be` value per call would yield `/be/be/…`.
   *
   * Defaults are listed field by field so `basePath` cannot cross into `RequestConfig`, where it has no
   * meaning — a spread would pass it silently, since TypeScript skips excess-property checks on spreads.
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

  /**
   * Issue a request and validate the JSON body against `schema`, wrapping the result in `Result<T>`.
   * Mirrors {@link SwapsApiService}: a 2xx body that fails the schema is surfaced as
   * `EXTERNAL_API_ERROR` (`context.reason: 'invalid_response_shape'`) rather than returned untyped.
   * Every data/token/money-market method delegates here; the config/relay reads use
   * {@link requestUnvalidated} instead.
   */
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

  /**
   * Issue a request WITHOUT response-shape validation (passthrough typing). Reserved for the
   * config/relay reads whose shapes are too large/brittle to schema-validate (`SodaxConfig` via
   * `getAllConfig`, `SpokeChainConfigMap` via `getSpokeChainConfig`) or carry `bigint` values that
   * cannot survive JSON validation (`getRelayChainIdMap`). `ConfigService` version-gates and falls
   * back to packaged defaults, so it relies on no response-shape guarantee from these endpoints.
   */
  private async requestUnvalidated<T>(endpoint: string, config: RequestConfig): Promise<Result<T>> {
    try {
      const value = await this.send<T>(endpoint, config);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toExternalApiError({ api: 'backend', feature: 'backend', endpoint, error }) };
    }
  }

  // Intent endpoints
  /**
   * Fetch a swap intent by the hub-chain transaction hash that created it.
   *
   * Intents are always created on the hub chain (Sonic), so `txHash` must
   * originate from that chain.
   *
   * @param txHash - The hub-chain transaction hash that emitted the intent creation event.
   * @returns `Result<IntentResponse>` — on success, the full intent details including
   *   open/closed state, token amounts, and any fill events.
   */
  public async getIntentByTxHash(txHash: string, config?: RequestOverrideConfig): Promise<Result<IntentResponse>> {
    return this.request(`/intent/tx/${txHash}`, { ...config, method: 'GET' }, schemas.IntentResponseSchema);
  }

  /**
   * Fetch a swap intent by its canonical intent hash.
   *
   * @param intentHash - The unique identifier derived from the intent's on-chain data.
   * @returns `Result<IntentResponse>` — on success, the full intent details.
   */
  public async getIntentByHash(intentHash: string, config?: RequestOverrideConfig): Promise<Result<IntentResponse>> {
    return this.request(`/intent/${intentHash}`, { ...config, method: 'GET' }, schemas.IntentResponseSchema);
  }

  // Solver endpoints
  /**
   * Fetch a paginated snapshot of the solver orderbook — open swap intents
   * that are currently waiting to be filled by the solver.
   *
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<OrderbookResponse>` — on success, the total count and an
   *   array of intent entries with their current fill state.
   */
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

  /**
   * Fetch all swap intents created by a specific wallet address, with optional
   * date-range filtering and pagination.
   *
   * `startDate` and `endDate` are Unix timestamps in **milliseconds**; the
   * backend converts them to ISO-8601 strings internally.
   *
   * @param params.userAddress - The user's hub-chain wallet address.
   * @param params.startDate - Optional lower bound for the intent creation time (ms since epoch).
   * @param params.endDate - Optional upper bound for the intent creation time (ms since epoch).
   * @param params.limit - Optional maximum number of results to return (as a string).
   * @param params.offset - Optional zero-based pagination offset (as a string).
   * @returns `Result<UserIntentsResponse>` — on success, a paginated list of the
   *   user's intent history with `total`, `offset`, `limit`, and `items`.
   */
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

  // Money Market endpoints
  /**
   * Fetch the current money market position for a wallet address.
   *
   * Returns all reserves in which the user holds aTokens (supplied collateral)
   * or variable-debt tokens (outstanding borrows), together with their
   * on-chain balances and the block number at which the snapshot was taken.
   *
   * @param userAddress - The wallet address to query.
   * @returns `Result<MoneyMarketPosition>` — on success, the user's aggregate
   *   position across all active reserves.
   */
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

  /**
   * Fetch the on-chain state for every active money market reserve asset.
   *
   * @returns `Result<MoneyMarketAsset[]>` — on success, an array of reserve
   *   snapshots including interest rates, liquidity indices, and participant counts.
   */
  public async getAllMoneyMarketAssets(config?: RequestOverrideConfig): Promise<Result<MoneyMarketAsset[]>> {
    return this.request('/moneymarket/asset/all', { ...config, method: 'GET' }, schemas.MoneyMarketAssetsSchema);
  }

  /**
   * Fetch the on-chain state for a single money market reserve asset.
   *
   * @param reserveAddress - The reserve contract address (EVM `0x…` format).
   * @returns `Result<MoneyMarketAsset>` — on success, the reserve snapshot
   *   including interest rates, total balances, and liquidity indices.
   */
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

  /**
   * Fetch a paginated list of wallets that currently have an outstanding borrow
   * against a specific reserve.
   *
   * @param reserveAddress - The reserve contract address to query.
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<MoneyMarketAssetBorrowers>` — on success, the borrower addresses
   *   and pagination metadata (`total`, `offset`, `limit`).
   */
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

  /**
   * Fetch a paginated list of wallets that currently have an active supply
   * (aToken balance) in a specific reserve.
   *
   * @param reserveAddress - The reserve contract address to query.
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<MoneyMarketAssetSuppliers>` — on success, the supplier addresses
   *   and pagination metadata (`total`, `offset`, `limit`).
   */
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

  /**
   * Fetch a paginated list of all wallet addresses that hold an active borrow
   * position across any money market reserve.
   *
   * @param params - Pagination cursor: `offset` (zero-based) and `limit` (page size), both as strings.
   * @returns `Result<MoneyMarketBorrowers>` — on success, the borrower addresses
   *   and pagination metadata (`total`, `offset`, `limit`).
   */
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

  // Oracle endpoints
  /**
   * Fetch the oracle candle store's discovery payload: the quote currency (currently always
   * `"USD"`), the selectable candle intervals, and the canonical symbols that have candle data.
   *
   * Use this to populate a symbol picker and interval switcher before calling
   * {@link getOracleCandles}.
   *
   * @returns `Result<OracleMarketsResponse>` — on success, `{ quote, intervals, symbols }`.
   */
  public async getOracleMarkets(config?: RequestOverrideConfig): Promise<Result<OracleMarketsResponse>> {
    return this.request('/oracle/markets', { ...config, method: 'GET' }, schemas.OracleMarketsResponseSchema);
  }

  /**
   * Fetch USD OHLC candles for a symbol over the half-open time range `[from, to)`.
   *
   * `from` and `to` are UNIX **seconds** (integers); `to` is exclusive and must exceed `from`,
   * and the range may cover at most 5000 buckets of the requested interval (invalid or wider
   * ranges fail with HTTP 400). A valid range with no stored candles resolves `ok` with
   * `candles: []`; an unknown symbol currently does the same rather than returning 404. The last
   * candle may still be forming; re-poll while its `final === false`.
   * Responses are cached server-side for roughly 10 seconds per distinct URL.
   *
   * @param params.symbol - Canonical symbol, exact case, from {@link getOracleMarkets} (e.g. `"ETH"`).
   * @param params.interval - Candle bucket size: `'1m' | '5m' | '1h' | '1d'`.
   * @param params.from - Range start, UNIX seconds, inclusive.
   * @param params.to - Range end, UNIX seconds, exclusive.
   * @returns `Result<OracleCandlesResponse>` — on success, the echoed query dimensions and
   *   oldest-first candles with USD decimal-string prices (no volume field).
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

  /**
   * Fetch the complete SODAX runtime configuration in a single request.
   *
   * The response bundles the full `SodaxConfig` (chain configs, token lists,
   * contract addresses, etc.) along with an optional schema version number.
   * `ConfigService` calls this method as its primary configuration source.
   *
   * @returns `Result<GetAllConfigApiResponse>` — on success, `{ version?, config }` where
   *   `config` is the current `SodaxConfig` used by all SDK services.
   */
  public async getAllConfig(config?: RequestOverrideConfig): Promise<Result<GetAllConfigApiResponse>> {
    return this.requestUnvalidated<GetAllConfigApiResponse>('/config/all', { ...config, method: 'GET' });
  }

  /**
   * Fetch the list of spoke chain keys that are currently supported by the
   * SODAX protocol.
   *
   * Required by `IConfigApi`. Used by `ConfigService` to discover which chains
   * are available before building chain-specific service configurations.
   *
   * @returns `Result<GetChainsApiResponse>` — on success, a readonly array of
   *   `SpokeChainKey` strings (e.g. `["ethereum", "arbitrum", "solana", …]`).
   */
  public async getChains(config?: RequestOverrideConfig): Promise<Result<GetChainsApiResponse>> {
    return this.request('/config/spoke/chains', { ...config, method: 'GET' }, schemas.GetChainsResponseSchema);
  }

  /**
   * Fetch the full map of tokens available for swapping, keyed by spoke chain.
   *
   * Required by `IConfigApi`. The response is a `Record<SpokeChainKey, readonly XToken[]>`
   * covering all chains. Use `getSwapTokensByChainId` to narrow to a single chain.
   *
   * @returns `Result<GetSwapTokensApiResponse>` — on success, a map from each
   *   supported spoke chain key to its list of swappable `XToken` definitions.
   */
  public async getSwapTokens(config?: RequestOverrideConfig): Promise<Result<GetSwapTokensApiResponse>> {
    return this.request('/config/swap/tokens', { ...config, method: 'GET' }, schemas.TokensByChainMapSchema);
  }

  /**
   * Fetch the list of tokens available for swapping on a specific spoke chain.
   *
   * Required by `IConfigApi`.
   *
   * @param chainId - The spoke chain key to query (e.g. `"ethereum"`, `"solana"`).
   * @returns `Result<GetSwapTokensByChainIdApiResponse>` — on success, a readonly
   *   array of `XToken` definitions supported for swapping on that chain.
   */
  public async getSwapTokensByChainId(
    chainId: SpokeChainKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<GetSwapTokensByChainIdApiResponse>> {
    return this.request(`/config/swap/${chainId}/tokens`, { ...config, method: 'GET' }, schemas.TokensListSchema);
  }

  /**
   * Fetch the full map of tokens available in the money market (lending/borrowing),
   * keyed by spoke chain.
   *
   * Required by `IConfigApi`.
   *
   * @returns `Result<GetMoneyMarketTokensApiResponse>` — on success, a map from
   *   each supported spoke chain key to its list of money-market `XToken` definitions.
   */
  public async getMoneyMarketTokens(config?: RequestOverrideConfig): Promise<Result<GetMoneyMarketTokensApiResponse>> {
    return this.request('/config/money-market/tokens', { ...config, method: 'GET' }, schemas.TokensByChainMapSchema);
  }

  /**
   * Fetch the list of hub-chain reserve asset addresses registered in the
   * money market protocol.
   *
   * Reserve addresses are the on-chain contract addresses (EVM `0x…` format)
   * for each lending pool. They are used to key into per-reserve queries such
   * as `getMoneyMarketAsset` and `getMoneyMarketAssetBorrowers`.
   *
   * @returns `Result<GetMoneyMarketReserveAssetsApiResponse>` — on success, a
   *   readonly array of reserve `Address` strings.
   */
  public async getMoneyMarketReserveAssets(
    config?: RequestOverrideConfig,
  ): Promise<Result<GetMoneyMarketReserveAssetsApiResponse>> {
    return this.request(
      '/config/money-market/reserve-assets',
      { ...config, method: 'GET' },
      schemas.ReserveAssetsSchema,
    );
  }

  /**
   * Fetch the list of tokens available for lending/borrowing on a specific
   * spoke chain.
   *
   * Required by `IConfigApi`.
   *
   * @param chainId - The spoke chain key to query (e.g. `"ethereum"`, `"arbitrum"`).
   * @returns `Result<GetMoneyMarketTokensByChainIdApiResponse>` — on success, a
   *   readonly array of `XToken` definitions supported in the money market on that chain.
   */
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

  /**
   * Fetch the mapping from spoke chain keys to the numeric chain IDs used by
   * the intent relay protocol.
   *
   * The relay chain ID map is consumed by `IntentRelayApiService` to translate
   * between SDK chain keys and the numeric identifiers expected by the relay
   * smart contracts and the solver.
   *
   * @returns `Result<GetRelayChainIdMapApiResponse>` — on success, an
   *   `IntentRelayChainIdMap` record mapping each spoke chain key to its relay chain ID.
   */
  public async getRelayChainIdMap(config?: RequestOverrideConfig): Promise<Result<GetRelayChainIdMapApiResponse>> {
    return this.requestUnvalidated<GetRelayChainIdMapApiResponse>('/config/relay/chain-id-map', {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Fetch the full chain configuration for all supported spoke chains.
   *
   * The response is a `SpokeChainConfigMap` — a record keyed by `SpokeChainKey`
   * where each entry describes the spoke contracts, asset contracts, and
   * chain-level parameters (e.g. RPC URLs, decimals, icon symbol) for that chain.
   * `ConfigService` uses this to populate per-chain spoke provider configurations.
   *
   * @returns `Result<GetSpokeChainConfigApiResponse>` — on success, the full
   *   `SpokeChainConfigMap` for all currently enabled spoke chains.
   */
  public async getSpokeChainConfig(config?: RequestOverrideConfig): Promise<Result<GetSpokeChainConfigApiResponse>> {
    return this.requestUnvalidated<GetSpokeChainConfigApiResponse>('/config/spoke/all-chains-configs', {
      ...config,
      method: 'GET',
    });
  }

  /**
   * Merge additional headers into the service's default header set.
   *
   * Useful for injecting authentication tokens or tracing headers at runtime
   * without constructing a new service instance. Existing header keys are
   * overwritten; keys absent from `headers` are preserved.
   *
   * Headers also reach `swaps`, `bridge` and `leverageYield`, but never `sponsoring`: it is configured
   * independently, so base-API credentials must not be forwarded to whatever origin it points at. Note
   * `swaps` can also be retargeted to another origin via `swapsApiConfig`, in which case a header set
   * here follows it.
   *
   * @param headers - Key-value pairs to add or overwrite in the default headers.
   */
  public setHeaders(headers: Record<string, string>): void {
    assignHeaders(this.headers, headers);
    this.swaps.setHeaders(headers);
    this.leverageYield.setHeaders(headers);
    this.bridge.setHeaders(headers);
  }

  /**
   * Return the gateway root the service is currently pointing at — WITHOUT this service's own mount.
   * Requests go to `getBaseURL() + getBasePath() + <route>`.
   *
   * @returns The resolved gateway root, i.e. the `baseURL` from the `ApiConfig` this instance was
   * constructed with, minus a legacy `/be` suffix if one was supplied.
   */
  public getBaseURL(): string {
    return this.config.baseURL;
  }

  /**
   * Return the backend data API's mount below {@link getBaseURL} — `/be` by default, or whatever
   * `basePath` the `ApiConfig` supplied (`''` for a service addressed directly at its origin).
   */
  public getBasePath(): string {
    return this.config.basePath;
  }
}
