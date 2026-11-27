/**
 * Tests for the BackendApiService HTTP proxy.
 *
 * Mirrors the shape of MoneyMarketService.test.ts / SwapService.test.ts:
 *
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.backendApi` is the
 *      service under test. The same instance is reused via `vi.stubGlobal('fetch', ...)`
 *      to intercept every outbound HTTP call.
 *   2. `describe(method name)` + one or more `it` per flow. Branchy methods get nested
 *      `happy paths` / `rejects on invalid inputs` / `propagates internal errors` subgroups.
 *   3. Internal collaborators are exclusively `fetch` and the valibot response schemas in
 *      `backendApiSchemas.ts`. Both are exercised through real code — the schemas are not
 *      mocked; a data/token/money-market response that fails its schema resolves to
 *      `EXTERNAL_API_ERROR` (`context.reason: 'invalid_response_shape'`). The config/relay reads
 *      (getAllConfig / getSpokeChainConfig / getRelayChainIdMap) are intentionally not validated.
 *   4. URL construction, HTTP method, default vs override headers, query-string params,
 *      and timeout (`AbortController`) propagation are all asserted explicitly so a
 *      mutation in either `request<T>` or `makeRequest<T>` surfaces immediately.
 *   5. Methods that return `Result<T>` are validated with `expect(result).toEqual(...)`;
 *      methods that return raw `Promise<T>` are validated with `await expect(...).resolves`
 *      / `.rejects` — matching the runtime contract of each method.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKEND_API_BASE_PATH,
  ChainKeys,
  DEFAULT_SPONSORING_API_ENDPOINT,
  type Address,
  type ApiConfig,
  type HttpUrl,
  type SodaxLogger,
} from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { BackendApiService } from './BackendApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import { silentLogger } from '../shared/logger.js';
import type { RequestOverrideConfig } from './api-utils.js';

// --- fetch stub -----------------------------------------------------------
//
// Every test routes through `global.fetch`. We stub it once for the file and reset
// the mock state between tests so each `it` configures its own response. `vi.stubGlobal`
// (over assignment to `global.fetch`) means the original is automatically restored when
// the file finishes.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- test fixtures --------------------------------------------------------

const sodax = new Sodax();
// `api.baseURL` is the gateway ROOT; the backend data API's own `/be` mount is appended by the service.
// So request URLs are prefixed with DATA_API, while `getBaseURL()` reports ROOT.
const ROOT = 'https://api.sodax.com/v1';
const DATA_API = `${ROOT}${BACKEND_API_BASE_PATH}`;

const SAMPLE_USER_ADDRESS = '0x1111111111111111111111111111111111111111' as Address;
const SAMPLE_TX_HASH = '0x46b053464f50836328b6158e1e33e5cf66c0e3ebe5004d30459b23acae5047a0';
const SAMPLE_INTENT_HASH = '0xf7e195884112667fb1c239bef650c19a730ba3eb93d38aa0313dc1754e39fc1b';
const SAMPLE_RESERVE_ADDRESS = '0x14238d267557e9d799016ad635b53cd15935d290';

// Schema-valid response fixtures. The service now validates every data/token/money-market
// response against a valibot schema, so happy-path mocks must satisfy the declared shape.
const SAMPLE_INTENT_RESPONSE = {
  intentHash: SAMPLE_INTENT_HASH,
  txHash: SAMPLE_TX_HASH,
  logIndex: 0,
  chainId: 146,
  blockNumber: 37002111,
  open: true,
  intent: {
    intentId: '1',
    creator: SAMPLE_USER_ADDRESS,
    inputToken: '0x0000000000000000000000000000000000000001',
    outputToken: '0x0000000000000000000000000000000000000002',
    inputAmount: '1000000',
    minOutputAmount: '990000',
    deadline: '0',
    allowPartialFill: false,
    srcChain: 146,
    dstChain: 23,
    srcAddress: SAMPLE_USER_ADDRESS,
    dstAddress: SAMPLE_USER_ADDRESS,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  events: [],
};

const SAMPLE_MM_ASSET = {
  reserveAddress: SAMPLE_RESERVE_ADDRESS,
  aTokenAddress: '0x5c50cf875aebad8d5ba548f229960c90b1c1f8c3',
  totalATokenBalance: '24998168147931621',
  variableDebtTokenAddress: '0x96a4197803ac8b21a1b7aefe72e565c71a91a40f',
  totalVariableDebtTokenBalance: '0',
  liquidityRate: '0',
  symbol: 'sodaAVAX',
  totalSuppliers: 1,
  totalBorrowers: 0,
  variableBorrowRate: '0',
  stableBorrowRate: '0',
  liquidityIndex: '1000000000000000000000000000',
  variableBorrowIndex: '1000000000000000000000000000',
  blockNumber: 37002111,
};

const SAMPLE_XTOKEN = {
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  chainKey: ChainKeys.BSC_MAINNET,
  hubAsset: '0x0000000000000000000000000000000000000010',
  vault: '0x0000000000000000000000000000000000000011',
};

const SAMPLE_ORACLE_MARKETS = {
  quote: 'USD',
  intervals: [
    { key: '1m', label: '1 minute', seconds: 60 },
    { key: '5m', label: '5 minutes', seconds: 300 },
    { key: '1h', label: '1 hour', seconds: 3600 },
    { key: '1d', label: '1 day', seconds: 86400 },
  ],
  symbols: ['BTC', 'ETH', 'SOL'],
};

const SAMPLE_ORACLE_CANDLES = {
  symbol: 'ETH',
  quote: 'USD',
  interval: '1h',
  candles: [
    { timestamp: 1782234000, open: '1665.57', high: '1666.22', low: '1663.01', close: '1665.02' },
    { timestamp: 1782237600, open: '1665.02', high: '1670.40', low: '1664.88', close: '1669.13', final: false },
  ],
};

// --- helpers --------------------------------------------------------------

const okResponse = <T>(data: T) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });
const httpErrorResponse = (status: number, text: string) => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(text),
});
const abortFetchImpl = (_url: string, init: { signal: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// Intent endpoints — Result<T> wrapper, default GET headers.
// =========================================================================

describe('BackendApiService.getIntentByTxHash', () => {
  it('issues GET to /intent/tx/{txHash} with default headers and returns ok:true wrapping the JSON body', async () => {
    const intentBody = SAMPLE_INTENT_RESPONSE;
    mockFetch.mockResolvedValueOnce(okResponse(intentBody));

    const result = await sodax.backendApi.getIntentByTxHash(SAMPLE_TX_HASH);

    expect(result).toEqual({ ok: true, value: intentBody });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${DATA_API}/intent/tx/${SAMPLE_TX_HASH}`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
      }),
    );
  });

  // `SwapService.resolveSolverStatus` branches on exactly this: a 404 is the backend answering "no
  // record", which lets a solver NOT_FOUND stand as a definitive miss, while any other failure leaves
  // it unverified. The status therefore has to survive into `context`, and nothing else pins that.
  it('returns EXTERNAL_API_ERROR wrapping HTTP_REQUEST_FAILED on a non-2xx, with the status lifted into context', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(404, 'Not Found'));

    const result = await sodax.backendApi.getIntentByTxHash(SAMPLE_TX_HASH);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      expect(err.message).toBe('HTTP_REQUEST_FAILED');
      // cause chain: SodaxError → makeRequest Error('HTTP_REQUEST_FAILED') → Error('HTTP 404: …')
      expect((err.cause as Error).message).toBe('HTTP_REQUEST_FAILED');
      expect(((err.cause as Error).cause as Error).message).toMatch(/HTTP 404: Not Found/);
      expect(err.context?.status).toBe(404);
      expect(err.context?.api).toBe('backend');
    }
  });

  it('returns ok:false wrapping a non-AbortError network error as EXTERNAL_API_ERROR (original on cause)', async () => {
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValueOnce(networkError);

    const result = await sodax.backendApi.getIntentByTxHash(SAMPLE_TX_HASH);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      expect(err.cause).toBe(networkError);
    }
  });

  it('returns ok:false wrapping UNKNOWN_REQUEST_ERROR when fetch rejects with a non-Error value', async () => {
    mockFetch.mockRejectedValueOnce('string-not-error');

    const result = await sodax.backendApi.getIntentByTxHash(SAMPLE_TX_HASH);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.message).toBe('UNKNOWN_REQUEST_ERROR');
      // cause chain: SodaxError → makeRequest Error('UNKNOWN_REQUEST_ERROR') → 'string-not-error'
      expect((err.cause as Error).message).toBe('UNKNOWN_REQUEST_ERROR');
      expect((err.cause as Error).cause).toBe('string-not-error');
    }
  });
});

// =========================================================================
// Validated data reads: each row pins its exact GET path + query string and that a
// schema-valid body comes back as ok:true.
// =========================================================================

describe('BackendApiService data reads', () => {
  const position = {
    userAddress: SAMPLE_USER_ADDRESS,
    positions: [
      {
        reserveAddress: SAMPLE_RESERVE_ADDRESS,
        aTokenAddress: '0x5c50cf875aebad8d5ba548f229960c90b1c1f8c3',
        variableDebtTokenAddress: '0x96a4197803ac8b21a1b7aefe72e565c71a91a40f',
        aTokenBalance: '24998168147931621',
        variableDebtTokenBalance: '0',
        blockNumber: 37002111,
      },
    ],
  };
  const page = { offset: '0', limit: '10' };
  const reads: Array<[name: string, invoke: () => Promise<unknown>, path: string, body: unknown]> = [
    [
      'getIntentByHash',
      () => sodax.backendApi.getIntentByHash(SAMPLE_INTENT_HASH),
      `/intent/${SAMPLE_INTENT_HASH}`,
      SAMPLE_INTENT_RESPONSE,
    ],
    [
      'getOrderbook',
      () => sodax.backendApi.getOrderbook(page),
      '/solver/orderbook?offset=0&limit=10',
      { total: 0, data: [] },
    ],
    [
      'getMoneyMarketPosition',
      () => sodax.backendApi.getMoneyMarketPosition(SAMPLE_USER_ADDRESS),
      `/moneymarket/position/${SAMPLE_USER_ADDRESS}`,
      position,
    ],
    [
      'getAllMoneyMarketAssets',
      () => sodax.backendApi.getAllMoneyMarketAssets(),
      '/moneymarket/asset/all',
      [SAMPLE_MM_ASSET],
    ],
    [
      'getMoneyMarketAsset',
      () => sodax.backendApi.getMoneyMarketAsset(SAMPLE_RESERVE_ADDRESS),
      `/moneymarket/asset/${SAMPLE_RESERVE_ADDRESS}`,
      SAMPLE_MM_ASSET,
    ],
    [
      'getMoneyMarketAssetBorrowers',
      () => sodax.backendApi.getMoneyMarketAssetBorrowers(SAMPLE_RESERVE_ADDRESS, page),
      `/moneymarket/asset/${SAMPLE_RESERVE_ADDRESS}/borrowers?offset=0&limit=10`,
      { borrowers: [], total: 0, offset: 0, limit: 10 },
    ],
    [
      'getMoneyMarketAssetSuppliers',
      () => sodax.backendApi.getMoneyMarketAssetSuppliers(SAMPLE_RESERVE_ADDRESS, page),
      `/moneymarket/asset/${SAMPLE_RESERVE_ADDRESS}/suppliers?offset=0&limit=10`,
      { suppliers: [], total: 0, offset: 0, limit: 10 },
    ],
    [
      'getAllMoneyMarketBorrowers',
      () => sodax.backendApi.getAllMoneyMarketBorrowers(page),
      '/moneymarket/borrowers?offset=0&limit=10',
      { borrowers: [], total: 0, offset: 0, limit: 10 },
    ],
    ['getOracleMarkets', () => sodax.backendApi.getOracleMarkets(), '/oracle/markets', SAMPLE_ORACLE_MARKETS],
  ];

  it('each read GETs its exact data-API path and wraps the schema-valid JSON body in ok:true', async () => {
    for (const [name, invoke, path, body] of reads) {
      mockFetch.mockResolvedValueOnce(okResponse(body));
      expect(await invoke(), name).toEqual({ ok: true, value: body });
      expect(mockFetch, name).toHaveBeenLastCalledWith(
        `${DATA_API}${path}`,
        expect.objectContaining({ method: 'GET' }),
      );
    }
  });
});

describe('BackendApiService.getUserIntents', () => {
  it('issues GET to /intent/user/{userAddress} with no query string when no filters are provided', async () => {
    const userIntents = { total: 0, offset: 0, limit: 0, items: [] };
    mockFetch.mockResolvedValueOnce(okResponse(userIntents));

    await expect(sodax.backendApi.getUserIntents({ userAddress: SAMPLE_USER_ADDRESS })).resolves.toEqual({
      ok: true,
      value: userIntents,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${DATA_API}/intent/user/${SAMPLE_USER_ADDRESS}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('appends startDate / endDate as ISO strings and limit / offset verbatim when provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ total: 0, offset: 0, limit: 0, items: [] }));
    const startDate = Date.UTC(2024, 0, 1);
    const endDate = Date.UTC(2024, 1, 1);

    await sodax.backendApi.getUserIntents({
      userAddress: SAMPLE_USER_ADDRESS,
      startDate,
      endDate,
      limit: '50',
      offset: '0',
    });

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(`/intent/user/${SAMPLE_USER_ADDRESS}?`);
    expect(calledUrl).toContain(`startDate=${encodeURIComponent(new Date(startDate).toISOString())}`);
    expect(calledUrl).toContain(`endDate=${encodeURIComponent(new Date(endDate).toISOString())}`);
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('offset=0');
  });
});

// =========================================================================
// Oracle endpoints — USD OHLC candle discovery and reads. The candles URL is
// asserted in full because the backend rejects any extra query param with a 400,
// so the query string this service builds is part of the contract.
// =========================================================================

describe('BackendApiService.getOracleCandles', () => {
  it('issues GET to /oracle/candles with exactly the four wire params, in order', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(SAMPLE_ORACLE_CANDLES));

    const result = await sodax.backendApi.getOracleCandles({
      symbol: 'ETH',
      interval: '1h',
      from: 1782234000,
      to: 1782241200,
    });

    expect(result).toEqual({ ok: true, value: SAMPLE_ORACLE_CANDLES });
    expect(mockFetch).toHaveBeenCalledWith(
      `${DATA_API}/oracle/candles?symbol=ETH&interval=1h&from=1782234000&to=1782241200`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // `from: 0` also guards the serialization: a falsy-conditional append (the getUserIntents shape)
  // would silently drop it. This valid historical range has no stored candles.
  it('serializes numeric bounds verbatim, including a zero lower bound', async () => {
    const body = { symbol: 'BTC', quote: 'USD', interval: '1d', candles: [] };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    const result = await sodax.backendApi.getOracleCandles({ symbol: 'BTC', interval: '1d', from: 0, to: 86400 });

    expect(result).toEqual({ ok: true, value: body });
    expect(mockFetch).toHaveBeenCalledWith(
      `${DATA_API}/oracle/candles?symbol=BTC&interval=1d&from=0&to=86400`,
      expect.any(Object),
    );
  });
});

// =========================================================================
// Config endpoints — Result<T> wrappers, all GET, exhaustive endpoint coverage.
// Each endpoint is asserted to hit its exact path so a refactor that flips a
// path string surfaces immediately.
// =========================================================================

describe('BackendApiService config endpoints', () => {
  type ConfigCase = {
    name: string;
    invoke: () => Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>;
    endpoint: string;
    // Schema-valid body for validated endpoints; an arbitrary object for the unvalidated
    // config/relay reads (getAllConfig / getRelayChainIdMap / getSpokeChainConfig).
    body: unknown;
  };

  const cases: ConfigCase[] = [
    {
      name: 'getAllConfig',
      invoke: () => sodax.backendApi.getAllConfig(),
      endpoint: '/config/all',
      body: { version: 1, config: { mock: 'config' } },
    },
    {
      name: 'getChains',
      invoke: () => sodax.backendApi.getChains(),
      endpoint: '/config/spoke/chains',
      body: [ChainKeys.BSC_MAINNET],
    },
    {
      name: 'getSwapTokens',
      invoke: () => sodax.backendApi.getSwapTokens(),
      endpoint: '/config/swap/tokens',
      body: { [ChainKeys.BSC_MAINNET]: [SAMPLE_XTOKEN] },
    },
    {
      name: 'getSwapTokensByChainId',
      invoke: () => sodax.backendApi.getSwapTokensByChainId(ChainKeys.BSC_MAINNET),
      endpoint: `/config/swap/${ChainKeys.BSC_MAINNET}/tokens`,
      body: [SAMPLE_XTOKEN],
    },
    {
      name: 'getMoneyMarketTokens',
      invoke: () => sodax.backendApi.getMoneyMarketTokens(),
      endpoint: '/config/money-market/tokens',
      body: { [ChainKeys.BSC_MAINNET]: [SAMPLE_XTOKEN] },
    },
    {
      name: 'getMoneyMarketReserveAssets',
      invoke: () => sodax.backendApi.getMoneyMarketReserveAssets(),
      endpoint: '/config/money-market/reserve-assets',
      body: [SAMPLE_RESERVE_ADDRESS],
    },
    {
      name: 'getMoneyMarketTokensByChainId',
      invoke: () => sodax.backendApi.getMoneyMarketTokensByChainId(ChainKeys.BSC_MAINNET),
      endpoint: `/config/money-market/${ChainKeys.BSC_MAINNET}/tokens`,
      body: [SAMPLE_XTOKEN],
    },
    {
      name: 'getRelayChainIdMap',
      invoke: () => sodax.backendApi.getRelayChainIdMap(),
      endpoint: '/config/relay/chain-id-map',
      body: { [ChainKeys.BSC_MAINNET]: 4 },
    },
    {
      name: 'getSpokeChainConfig',
      invoke: () => sodax.backendApi.getSpokeChainConfig(),
      endpoint: '/config/spoke/all-chains-configs',
      body: { mock: 'spokeChainConfig' },
    },
  ];

  it('each config read GETs its exact path and wraps the JSON body in ok:true', async () => {
    for (const { name, invoke, endpoint, body } of cases) {
      mockFetch.mockResolvedValueOnce(okResponse(body));
      expect(await invoke(), name).toEqual({ ok: true, value: body });
      expect(mockFetch, name).toHaveBeenLastCalledWith(
        `${DATA_API}${endpoint}`,
        expect.objectContaining({ method: 'GET' }),
      );
    }
  });

  it('an unvalidated config read (getAllConfig) returns ok:false with HTTP_REQUEST_FAILED on a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(500, 'boom'));

    const result = await sodax.backendApi.getAllConfig();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as SodaxError).code).toBe('EXTERNAL_API_ERROR');
      expect((result.error as Error).message).toBe('HTTP_REQUEST_FAILED');
    }
  });
});

// =========================================================================
// Response validation — data/token/money-market responses are validated against
// valibot schemas; a 2xx body that fails its schema resolves to EXTERNAL_API_ERROR
// (context.reason: 'invalid_response_shape'). The config/relay reads are NOT validated.
// =========================================================================

describe('BackendApiService response validation', () => {
  it('getIntentByHash rejects a 2xx body missing required intent fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ intentHash: SAMPLE_INTENT_HASH, txHash: SAMPLE_TX_HASH }));

    const result = await sodax.backendApi.getIntentByHash(SAMPLE_INTENT_HASH);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      expect(err.context?.api).toBe('backend');
      expect(err.context?.endpoint).toBe(`/intent/${SAMPLE_INTENT_HASH}`);
      expect(err.context?.reason).toBe('invalid_response_shape');
    }
  });

  it('rejects a money-market asset or XToken entry missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse([{ symbol: 'sodaAVAX' }]));
    const assets = await sodax.backendApi.getAllMoneyMarketAssets();
    expect(!assets.ok && (assets.error as SodaxError).context?.reason).toBe('invalid_response_shape');

    mockFetch.mockResolvedValueOnce(okResponse([{ symbol: 'USDC' }]));
    const tokens = await sodax.backendApi.getSwapTokensByChainId(ChainKeys.BSC_MAINNET);
    expect(!tokens.ok && (tokens.error as SodaxError).context?.reason).toBe('invalid_response_shape');
  });

  it('getOrderbook rejects a malformed nested entry (empty intentState / intentData)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ total: 1, data: [{ intentState: {}, intentData: {} }] }));

    const result = await sodax.backendApi.getOrderbook({ offset: '0', limit: '1' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as SodaxError).context?.reason).toBe('invalid_response_shape');
  });

  it('getOracleCandles rejects OHLC prices sent as JSON numbers, and an interval echo outside the declared union', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        symbol: 'ETH',
        quote: 'USD',
        interval: '1h',
        candles: [{ timestamp: 1782234000, open: 1665.57, high: 1666.22, low: 1663.01, close: 1665.02 }],
      }),
    );

    const result = await sodax.backendApi.getOracleCandles({
      symbol: 'ETH',
      interval: '1h',
      from: 1782234000,
      to: 1782241200,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as SodaxError).context?.reason).toBe('invalid_response_shape');

    mockFetch.mockResolvedValueOnce(okResponse({ symbol: 'ETH', quote: 'USD', interval: '4h', candles: [] }));
    const echo = await sodax.backendApi.getOracleCandles({
      symbol: 'ETH',
      interval: '1h',
      from: 1782234000,
      to: 1782241200,
    });
    expect(!echo.ok && (echo.error as SodaxError).context?.reason).toBe('invalid_response_shape');
  });

  it('getOracleMarkets tolerates an unknown interval key (schema is not a picklist)', async () => {
    const body = {
      quote: 'USD',
      intervals: [{ key: '4h', label: '4 hours', seconds: 14400 }],
      symbols: ['ETH'],
    };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    await expect(sodax.backendApi.getOracleMarkets()).resolves.toEqual({ ok: true, value: body });
  });

  // `final` is advisory, so the schema tolerates `true` rather than blanking a whole chart over it;
  // consumers branch on `final === false`, not on the field being present.
  it('getOracleCandles accepts a candle marked final: true', async () => {
    const body = {
      symbol: 'ETH',
      quote: 'USD',
      interval: '1h',
      candles: [
        { timestamp: 1782234000, open: '1665.57', high: '1666.22', low: '1663.01', close: '1665.02', final: true },
      ],
    };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    await expect(
      sodax.backendApi.getOracleCandles({ symbol: 'ETH', interval: '1h', from: 1782234000, to: 1782241200 }),
    ).resolves.toEqual({ ok: true, value: body });
  });

  it('getOracleMarkets rejects an intervals entry missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ quote: 'USD', intervals: [{ key: '1h' }], symbols: ['ETH'] }));

    const result = await sodax.backendApi.getOracleMarkets();

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as SodaxError).context?.reason).toBe('invalid_response_shape');
  });
});

// =========================================================================
// request() config threading — BackendApiService.request folds a per-call
// override into the request and merges it with the service defaults before
// delegating to makeRequest. The exhaustive makeRequest URL / header / timeout
// precedence invariants are unit-tested directly in api-utils.test.ts.
// =========================================================================

describe('BackendApiService.request config threading', () => {
  it('normalizes a legacy /be-suffixed per-call baseURL override instead of double-mounting', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ total: 0, data: [] }));

    // The value the pre-change docs told consumers to pass. Appending the mount to it verbatim would
    // request `/v1/be/be/solver/orderbook`, which the gateway does not route.
    await sodax.backendApi.getOrderbook({ offset: '0', limit: '5' }, { baseURL: DATA_API });

    expect(mockFetch).toHaveBeenCalledWith(`${DATA_API}/solver/orderbook?offset=0&limit=5`, expect.anything());
  });

  it('threads a per-call override into the request: baseURL replaced, custom header merged with the defaults', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ total: 0, data: [] }));

    await sodax.backendApi.getOrderbook(
      { offset: '0', limit: '5' },
      { baseURL: 'https://custom.example.com', headers: { 'X-Request-Id': '12345' } },
    );

    // The override replaces the gateway root; the service's own `/be` mount still applies.
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.example.com/be/solver/orderbook?offset=0&limit=5',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Request-Id': '12345',
        }),
      }),
    );
  });

  it('threads a per-call timeout override through to makeRequest (resolves ok:false with REQUEST_TIMEOUT)', async () => {
    mockFetch.mockImplementationOnce(abortFetchImpl);

    await expect(sodax.backendApi.getOrderbook({ offset: '0', limit: '5' }, { timeout: 5 })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ message: 'REQUEST_TIMEOUT' }),
    });
  });
});

// =========================================================================
// Utility methods — setHeaders / getBaseURL. setHeaders mutates the underlying
// ApiConfig, so this block uses a freshly-constructed BackendApiService rather
// than the shared `sodax.backendApi` to avoid leaking mutations across the file.
// =========================================================================

describe('BackendApiService.setHeaders', () => {
  it('persists the supplied headers and merges them into subsequent requests', async () => {
    const isolatedConfig: ApiConfig = {
      baseURL: ROOT,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    };
    const isolatedService = new BackendApiService(isolatedConfig);
    isolatedService.setHeaders({ 'X-Custom-Header': 'custom-value', 'X-API-Key': 'api-key-123' });
    mockFetch.mockResolvedValueOnce(okResponse({ ok: true }));

    await isolatedService.getIntentByTxHash('0x123');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Custom-Header': 'custom-value',
          'X-API-Key': 'api-key-123',
        }),
      }),
    );
  });

  it('a repeated mixed-casing update sends the newest value, and fans it out to every keyed client', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older casing last and let it win the merge.
    const isolatedService = new BackendApiService({ baseURL: ROOT, timeout: 30_000, headers: {} });
    isolatedService.setHeaders({ 'x-api-key': 'v1' });
    isolatedService.setHeaders({ 'X-Api-Key': 'v2' });
    isolatedService.setHeaders({ 'x-api-key': 'v3' });

    // Each client gets a body its own schema accepts, so the assertion is not read past a
    // validation rejection that only shows up as log noise.
    const calls: Array<[call: () => Promise<unknown>, body: unknown]> = [
      [() => isolatedService.getIntentByTxHash('0x123'), { ok: true }],
      [() => isolatedService.swaps.getTokens(), {}],
      [() => isolatedService.bridge.getTokens(), {}],
      [() => isolatedService.leverageYield.getVaults(), []],
    ];
    for (const [call, body] of calls) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(okResponse(body));
      await call();
      const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
      expect(new Headers(headers).get('x-api-key')).toBe('v3');
    }
  });
});

describe('BackendApiService logger forwarding', () => {
  it('forwards the injected logger to the swaps sub-service (a swaps error path hits the same sink)', async () => {
    const spy: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const isolatedService = new BackendApiService({ baseURL: ROOT, timeout: 30_000, headers: {} }, spy);
    // A non-2xx on a swaps endpoint makes makeRequest call `logger.error(...)` before rethrowing.
    mockFetch.mockResolvedValueOnce(httpErrorResponse(502, 'Bad Gateway'));

    const result = await isolatedService.swaps.getTokens();

    // Regression guard for the wiring bug: without forwarding, swaps would use the default
    // consoleLogger and this injected sink would never be called.
    expect(result.ok).toBe(false);
    // Don't couple to the exact log message — asserting (string, Error) proves the swaps error path
    // reached the injected sink (only possible if the logger was forwarded to the sub-service).
    expect(spy.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
  });
});

describe('BackendApiService legacy baseURL deprecation', () => {
  const loggerSpy = (): SodaxLogger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  it('warns once at construction, naming the trimmed gateway root', () => {
    const spy = loggerSpy();
    new BackendApiService({ baseURL: DATA_API, timeout: 30_000, headers: {} }, spy);
    expect(spy.warn).toHaveBeenCalledTimes(1);
    // `stringContaining(ROOT)` alone would also pass on the UNtrimmed message, since ROOT is a prefix
    // of DATA_API — so assert the trimmed value is what the message reports.
    const [message] = vi.mocked(spy.warn).mock.calls[0] as [string];
    expect(message).toContain(`"${ROOT}"`);
    expect(message).not.toContain(`"${DATA_API}"`);
  });

  it('stays quiet for a gateway root, and when an explicit basePath says the base URL is already a root', () => {
    const spy = loggerSpy();
    new BackendApiService({ baseURL: ROOT, timeout: 30_000, headers: {} }, spy);
    new BackendApiService({ baseURL: DATA_API, basePath: '', timeout: 30_000, headers: {} }, spy);
    expect(spy.warn).not.toHaveBeenCalled();
  });
});

describe('BackendApiService.getBaseURL', () => {
  it('returns the gateway root, not the data API mount that requests are prefixed with', () => {
    expect(sodax.backendApi.getBaseURL()).toBe(ROOT);
    expect(sodax.backendApi.getBasePath()).toBe(BACKEND_API_BASE_PATH);
    expect(`${sodax.backendApi.getBaseURL()}${sodax.backendApi.getBasePath()}`).toBe(DATA_API);
  });
});

// =========================================================================
// ApiConfig union wiring — BackendApiService resolves the base slice and its
// `swaps` sub-service resolves the swaps slice from the same ApiConfig.
// (Pure resolver behaviour is unit-tested in apiConfig.test.ts.)
// =========================================================================

describe('BackendApiService ApiConfig variants', () => {
  it('flat BaseApiConfig: base and swaps share the same baseURL', () => {
    const service = new BackendApiService({
      baseURL: 'https://flat.example',
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    expect(service.getBaseURL()).toBe('https://flat.example');
    expect(service.swaps.getBaseURL()).toBe('https://flat.example');
  });

  it('CustomApiConfig: routes base requests to baseApiConfig and swaps requests to swapsApiConfig', async () => {
    const service = new BackendApiService({
      baseApiConfig: {
        baseURL: 'https://base.example',
        timeout: 30_000,
        headers: { 'Content-Type': 'application/json' },
      },
      swapsApiConfig: {
        baseURL: 'https://swaps.example',
        timeout: 30_000,
        headers: { 'Content-Type': 'application/json' },
      },
    });
    expect(service.getBaseURL()).toBe('https://base.example');
    expect(service.swaps.getBaseURL()).toBe('https://swaps.example');

    mockFetch.mockResolvedValueOnce(okResponse({ intentHash: '0x1' }));
    await service.getIntentByTxHash('0xabc');
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://base.example/be/intent/tx/0xabc',
      expect.objectContaining({ method: 'GET' }),
    );

    mockFetch.mockResolvedValueOnce(okResponse({})); // empty token map = valid GetSwapTokensResponseV2
    await service.swaps.getTokens();
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://swaps.example/swaps/tokens',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('CustomApiConfig with only baseApiConfig: swaps falls back to the base baseURL', () => {
    const service = new BackendApiService({
      baseApiConfig: { baseURL: 'https://base-only.example', timeout: 30_000, headers: { Accept: 'application/json' } },
    });
    expect(service.getBaseURL()).toBe('https://base-only.example');
    expect(service.swaps.getBaseURL()).toBe('https://base-only.example');
  });

  // End-to-end through the Sodax facade: exercises mergeSodaxConfig (constructor) → service
  // construction → per-service resolution, the real path a consumer hits.
  it('via new Sodax({ api }): CustomApiConfig wires base and swaps to their own baseURLs; a flat partial keeps defaults', () => {
    const s = new Sodax({
      api: {
        baseApiConfig: {
          baseURL: 'https://base.sodax.example',
          timeout: 30_000,
          headers: { Accept: 'application/json' },
        },
        swapsApiConfig: {
          baseURL: 'https://swaps.sodax.example',
          timeout: 30_000,
          headers: { Accept: 'application/json' },
        },
      },
    });
    expect(s.backendApi.getBaseURL()).toBe('https://base.sodax.example');
    expect(s.api.swaps.getBaseURL()).toBe('https://swaps.sodax.example');

    // A flat partial merge keeps the default baseURL for base and swaps.
    const partial = new Sodax({ api: { timeout: 12_345 } });
    expect(partial.backendApi.getBaseURL()).toBe(ROOT);
    expect(partial.api.swaps.getBaseURL()).toBe(ROOT);
  });
});

// =========================================================================
// API key — one `new Sodax({ apiKey })` for every backend service.
//
// Asserted on the wire (the style of defaultApiUrls.test.ts) rather than on resolved config: what a
// gateway authenticates is the header it receives, and sponsoring's inherited key is deliberately
// NOT baked into any config — it is selected per request from the target URL.
// =========================================================================

/** The `x-api-key` actually sent, read through `Headers` so any casing counts. */
const sentApiKey = (): string | null => new Headers(mockFetch.mock.calls.at(-1)?.[1]?.headers).get('x-api-key');

const CUSTOM_SPONSORING: HttpUrl = 'https://sponsoring.mydapp.example';
/** A whole-stack retarget: one root every service is pointed at, distinct from the packaged one. */
const STAGING_ROOT: HttpUrl = 'https://staging-api.sodax.example/v1';

type ApiCall = (config?: RequestOverrideConfig) => Promise<unknown>;

describe('one key, every service', () => {
  const keyed = new Sodax({ apiKey: 'instance-key', logger: silentLogger });
  const services: Array<[label: string, call: ApiCall]> = [
    ['data', config => keyed.backendApi.getAllConfig(config)],
    ['swaps', config => keyed.api.swaps.getTokens(config)],
    ['bridge', config => keyed.api.bridge.getTokens(config)],
    ['leverageYield', config => keyed.api.leverageYield.getVaults(config)],
    ['sponsoring', config => keyed.api.sponsoring.getStellarSponsorConfig(config)],
  ];

  it.each(
    services,
  )('resolves the apiKey precedence on the %s wire (instance < per-request; blank = unset)', async (_label, call) => {
    const keySent = async (config?: RequestOverrideConfig): Promise<string | null> => {
      mockFetch.mockResolvedValueOnce(okResponse({}));
      await call(config);
      return sentApiKey();
    };
    expect(await keySent()).toBe('instance-key');
    expect(await keySent({ apiKey: 'call-key' })).toBe('call-key');
    expect(await keySent({ apiKey: '' })).toBe('instance-key');
    // `undefined` is exactly what runBackendSubmitTx passes when `extras` is omitted.
    expect(await keySent({ apiKey: undefined })).toBe('instance-key');
  });

  it.each(
    services,
  )('lets a raw per-request x-api-key header win as the ONLY key header on the %s wire', async (_label, call) => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await call({ headers: { 'X-Api-Key': 'raw-key' } });
    const headers = mockFetch.mock.calls.at(-1)?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('raw-key');

    // A blank raw header is sent verbatim, even over a per-request apiKey.
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await call({ apiKey: 'call-key', headers: { 'x-api-key': '' } });
    expect(sentApiKey()).toBe('');
  });

  it('lets an explicitly configured x-api-key header win over the instance key', async () => {
    // Sponsoring is excluded on purpose: it never inherits the shared headers.
    const configured = new Sodax({
      apiKey: 'instance-key',
      api: { headers: { 'x-api-key': 'configured-header' } },
      logger: silentLogger,
    });
    for (const call of [
      () => configured.backendApi.getAllConfig(),
      () => configured.api.swaps.getTokens(),
      () => configured.api.bridge.getTokens(),
      () => configured.api.leverageYield.getVaults(),
    ]) {
      mockFetch.mockResolvedValueOnce(okResponse({}));
      await call();
      expect(sentApiKey()).toBe('configured-header');
    }
  });
});

describe('sponsoring inherits the instance key only for an allowed root', () => {
  /**
   * Issue one sponsoring request and report the `x-api-key` it carried. The target is asserted here
   * so a "no key sent" expectation can never pass because the request went somewhere else — or nowhere.
   */
  const keySentTo = async (target: string, sodax: Sodax, config?: RequestOverrideConfig): Promise<string | null> => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await sodax.api.sponsoring.getStellarSponsorConfig(config);
    expect(mockFetch.mock.calls.at(-1)?.[0]).toBe(`${target}/sponsorships/stellar/config`);
    return sentApiKey();
  };

  /** POST twin of `keySentTo`: one `createStellarSponsoredAccount` call, target asserted the same way. */
  const keySentToAccounts = async (
    target: string,
    sodax: Sodax,
    config?: RequestOverrideConfig,
  ): Promise<string | null> => {
    mockFetch.mockResolvedValueOnce(okResponse({ hash: '0xhash', alreadyActive: false }));
    await sodax.api.sponsoring.createStellarSponsoredAccount({ data: 'AAAA' }, config);
    expect(mockFetch.mock.calls.at(-1)?.[0]).toBe(`${target}/sponsorships/stellar/accounts`);
    expect(mockFetch.mock.calls.at(-1)?.[1]?.method).toBe('POST');
    return sentApiKey();
  };

  const sliceOrigins: Array<HttpUrl | undefined> = [undefined, CUSTOM_SPONSORING];

  it('lets the sponsoring slice key win over the instance key at the default root and at a custom origin', async () => {
    for (const baseURL of sliceOrigins) {
      const sodax = new Sodax({
        apiKey: 'instance-key',
        api: { sponsoringApiConfig: { ...(baseURL ? { baseURL } : {}), apiKey: 'slice-key' } },
        logger: silentLogger,
      });
      expect(await keySentTo(baseURL ?? DEFAULT_SPONSORING_API_ENDPOINT, sodax)).toBe('slice-key');
    }
  });

  it('inherits when only the shared root moved and sponsoring stayed on the packaged default', async () => {
    const sodax = new Sodax({ apiKey: 'instance-key', api: { baseURL: STAGING_ROOT }, logger: silentLogger });
    // Sponsoring never inherits a base URL, so it is still the origin the key belongs to.
    expect(await keySentTo(DEFAULT_SPONSORING_API_ENDPOINT, sodax)).toBe('instance-key');
  });

  it('inherits when the sponsoring slice points at the retargeted shared root', async () => {
    const sodax = new Sodax({
      apiKey: 'instance-key',
      api: { baseURL: STAGING_ROOT, sponsoringApiConfig: { baseURL: STAGING_ROOT } },
      logger: silentLogger,
    });
    expect(await keySentTo(STAGING_ROOT, sodax)).toBe('instance-key');
  });

  // The gate is re-evaluated per request because a `RequestOverrideConfig.baseURL` retargets the call
  // while keeping the service defaults — a baked-in key would ride along to the new origin.
  it('withholds the instance key when a per-request baseURL leaves the allowed roots', async () => {
    const sodax = new Sodax({ apiKey: 'instance-key', logger: silentLogger });
    expect(await keySentTo(CUSTOM_SPONSORING, sodax, { baseURL: CUSTOM_SPONSORING })).toBeNull();
  });

  it('still sends an explicit per-request apiKey or raw x-api-key header to that same custom target', async () => {
    const sodax = new Sodax({ apiKey: 'instance-key', logger: silentLogger });
    const overrides: RequestOverrideConfig[] = [{ apiKey: 'call-key' }, { headers: { 'X-Api-Key': 'call-key' } }];
    for (const override of overrides) {
      expect(await keySentTo(CUSTOM_SPONSORING, sodax, { baseURL: CUSTOM_SPONSORING, ...override })).toBe('call-key');
    }
  });

  it('withholds the key from a configured custom origin, and inherits again when a per-request baseURL points back at an allowed root', async () => {
    const sodax = new Sodax({
      apiKey: 'instance-key',
      api: { baseURL: STAGING_ROOT, sponsoringApiConfig: { baseURL: CUSTOM_SPONSORING } },
      logger: silentLogger,
    });
    expect(await keySentTo(CUSTOM_SPONSORING, sodax)).toBeNull();
    expect(await keySentTo(STAGING_ROOT, sodax, { baseURL: STAGING_ROOT })).toBe('instance-key');
  });

  it('inherits when a configured or per-request baseURL differs from an allowed root only by a trailing slash', async () => {
    const configured = new Sodax({
      apiKey: 'instance-key',
      api: { sponsoringApiConfig: { baseURL: `${DEFAULT_SPONSORING_API_ENDPOINT}/` } },
      logger: silentLogger,
    });
    // The wire URL is built from the trimmed base, so the asserted target carries no slash.
    expect(await keySentTo(DEFAULT_SPONSORING_API_ENDPOINT, configured)).toBe('instance-key');

    const perRequest = new Sodax({ apiKey: 'instance-key', logger: silentLogger });
    const config: RequestOverrideConfig = { baseURL: `${DEFAULT_SPONSORING_API_ENDPOINT}/` };
    expect(await keySentTo(DEFAULT_SPONSORING_API_ENDPOINT, perRequest, config)).toBe('instance-key');
  });

  it('gates the account-creation POST the same way: default root inherits, custom or retargeted origin does not', async () => {
    const defaults = new Sodax({ apiKey: 'instance-key', logger: silentLogger });
    expect(await keySentToAccounts(DEFAULT_SPONSORING_API_ENDPOINT, defaults)).toBe('instance-key');
    expect(await keySentToAccounts(CUSTOM_SPONSORING, defaults, { baseURL: CUSTOM_SPONSORING })).toBeNull();

    const custom = new Sodax({
      apiKey: 'instance-key',
      api: { sponsoringApiConfig: { baseURL: CUSTOM_SPONSORING } },
      logger: silentLogger,
    });
    expect(await keySentToAccounts(CUSTOM_SPONSORING, custom)).toBeNull();
  });
});
