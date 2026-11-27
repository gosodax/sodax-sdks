/**
 * Tests for the BridgeApiService HTTP client (backend Bridge API).
 *
 * Mirrors SwapsApiService.test.ts:
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.api.bridge` is the
 *      service under test. `vi.stubGlobal('fetch', ...)` intercepts every outbound call.
 *   2. URL construction, HTTP method, default vs override headers, query-string params,
 *      request-body serialization, and valibot response validation are asserted explicitly.
 *      The service delegates the wire work to `@sodax/bridge-api`.
 *   3. Every method returns `Result<T>` — happy paths assert `{ ok: true, value }`,
 *      failures assert `{ ok: false }` with the expected error (a `BridgeApiError` on `cause`).
 *
 * Bridge-specific deltas covered: create-intent response is `{ tx, relayData }` (no intent);
 * the submit-tx body carries the FULL `relayData { address, payload }` envelope; the
 * submit-tx-status `status` schema is tolerant of unknown states; the domain→wire mapper
 * `toCreateBridgeIntentParamsV2` converts SDK names + bigint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_BASE_URL, type BridgeSubmitTxRequestV2, type CreateBridgeIntentParamsV2 } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { BridgeApiService, toCreateBridgeIntentParamsV2 } from './BridgeApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import { isAuthFailure, isSodaxError } from '../errors/guards.js';
import { BridgeApiError } from '@sodax/bridge-api';

// --- fetch stub -----------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- fixtures -------------------------------------------------------------
const sodax = new Sodax();
const BASE = DEFAULT_API_BASE_URL;
const TX_HASH = '0x46b053464f50836328b6158e1e33e5cf66c0e3ebe5004d30459b23acae5047a0';

const sampleCreateBridgeIntentParams: CreateBridgeIntentParamsV2 = {
  srcChainKey: '0xa4b1.arbitrum',
  dstChainKey: '0x2105.base',
  inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  inputAmount: '1000000',
  srcAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
  dstAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
};

const sampleRelayData = { address: '0xaddr', payload: '0xpayload' };

const sampleBridgeSubmitTxRequest: BridgeSubmitTxRequestV2 = {
  txHash: TX_HASH,
  srcChainKey: '0xa4b1.arbitrum',
  walletAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
  relayData: sampleRelayData,
};

// Valid response bodies (each matches its valibot schema).
const tokensResponse = {
  '0xa4b1.arbitrum': [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      chainKey: '0xa4b1.arbitrum',
      hubAsset: '0xhub',
      vault: '0xvault',
    },
  ],
};
const createBridgeIntentResponse = {
  tx: { from: '0x1', to: '0x2', value: '0', data: '0x' },
  relayData: sampleRelayData,
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

// Braces matter: `mockReset()` returns the mock, and a `beforeEach` that returns a function
// registers it as a teardown — vitest 4 leaves the impl in place, so it would fire the stub.
beforeEach(() => {
  mockFetch.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// URL + HTTP method for the endpoints without a behavioural test below (those
// assert their own URL + verb).
// =========================================================================

describe('BridgeApiService endpoint routing', () => {
  type Case = { name: string; invoke: () => Promise<{ ok: boolean }>; method: 'GET' | 'POST'; url: string };
  const bridgeablePair = {
    srcChainKey: '0xa4b1.arbitrum',
    dstChainKey: '0x89.polygon',
    inputToken: '0x1',
    outputToken: '0x2',
  } as const;
  const cases: Case[] = [
    {
      name: 'checkAllowance',
      invoke: () => sodax.api.bridge.checkAllowance(sampleCreateBridgeIntentParams),
      method: 'POST',
      url: `${BASE}/bridge/allowance/check`,
    },
    {
      name: 'getFee',
      invoke: () => sodax.api.bridge.getFee({ inputAmount: '1000000' }),
      method: 'POST',
      url: `${BASE}/bridge/fee`,
    },
    {
      name: 'getBridgeableAmount',
      invoke: () => sodax.api.bridge.getBridgeableAmount(bridgeablePair),
      method: 'POST',
      url: `${BASE}/bridge/bridgeable-amount`,
    },
    {
      name: 'isBridgeable',
      invoke: () => sodax.api.bridge.isBridgeable(bridgeablePair),
      method: 'POST',
      url: `${BASE}/bridge/bridgeable/check`,
    },
  ];

  it('each endpoint issues its exact verb to its exact path', async () => {
    for (const { name, invoke, method, url } of cases) {
      mockFetch.mockResolvedValueOnce(okResponse({}));
      await invoke();
      expect(mockFetch, name).toHaveBeenLastCalledWith(url, expect.objectContaining({ method }));
    }
  });
});

// =========================================================================
// Happy paths — valibot validation succeeds, Result wraps the parsed body.
// =========================================================================

describe('BridgeApiService happy paths (validated responses)', () => {
  it('getTokensByChain GETs /bridge/tokens/{chainKey} and returns the chain token list', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse['0xa4b1.arbitrum']));
    const result = await sodax.api.bridge.getTokensByChain('0xa4b1.arbitrum');
    expect(result).toEqual({ ok: true, value: tokensResponse['0xa4b1.arbitrum'] });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/bridge/tokens/0xa4b1.arbitrum`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('approve POSTs /bridge/approve and returns { tx, resetTx } (both tx.value decimal strings → bigint)', async () => {
    const approveResponse = {
      tx: { from: '0x1', to: '0x2', value: '0', data: '0x' },
      resetTx: { from: '0x1', to: '0x2', value: '0', data: '0xreset' },
    };
    mockFetch.mockResolvedValueOnce(okResponse(approveResponse));
    const result = await sodax.api.bridge.approve(sampleCreateBridgeIntentParams);
    expect(result).toEqual({
      ok: true,
      value: {
        tx: { ...approveResponse.tx, value: 0n },
        resetTx: { ...approveResponse.resetTx, value: 0n },
      },
    });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/bridge/approve`, expect.objectContaining({ method: 'POST' }));
  });

  it('createBridgeIntent POSTs /bridge/intents and returns { tx, relayData } (tx.value decimal string → bigint)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(createBridgeIntentResponse));
    const result = await sodax.api.bridge.createBridgeIntent(sampleCreateBridgeIntentParams);
    // srcChainKey is an EVM chain, so the EVM raw-tx schema transforms value "0" → 0n.
    expect(result).toEqual({
      ok: true,
      value: { ...createBridgeIntentResponse, tx: { ...createBridgeIntentResponse.tx, value: 0n } },
    });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/bridge/intents`, expect.objectContaining({ method: 'POST' }));
  });

  it('submitTx POSTs the FULL relayData envelope to /bridge/submit-tx and returns the insertion status', async () => {
    const body = { success: true, data: { status: 'inserted', message: 'Bridge transaction submitted successfully' } };
    mockFetch.mockResolvedValueOnce(okResponse(body));
    const result = await sodax.api.bridge.submitTx(sampleBridgeSubmitTxRequest);
    expect(result).toEqual({ ok: true, value: body });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/bridge/submit-tx`, expect.objectContaining({ method: 'POST' }));
    // The body carries the whole relayData { address, payload } object, not just payload.
    const sent = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(sent.relayData).toEqual(sampleRelayData);
  });

  it('getSubmitTxStatus unwraps the { success, data } envelope, tolerating an unknown status (not a picklist)', async () => {
    const body = {
      success: true,
      data: {
        txHash: '0xabc',
        srcChainKey: '0xa4b1.arbitrum',
        status: 'executed',
        processingAttempts: 1,
        result: { dstIntentTxHash: '0xdst' },
      },
    };
    mockFetch.mockResolvedValueOnce(okResponse(body));
    const result = await sodax.api.bridge.getSubmitTxStatus({ txHash: '0xabc', srcChainKey: '0xa4b1.arbitrum' });
    expect(result).toEqual({ ok: true, value: body });
    if (result.ok) expect(result.value.data.result?.dstIntentTxHash).toBe('0xdst');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/bridge/submit-tx/status?txHash=0xabc&srcChainKey=0xa4b1.arbitrum`,
      expect.objectContaining({ method: 'GET' }),
    );

    const future = {
      success: true,
      data: { txHash: '0xabc', srcChainKey: '0xa4b1.arbitrum', status: 'some_future_state', processingAttempts: 0 },
    };
    mockFetch.mockResolvedValueOnce(okResponse(future));
    await expect(
      sodax.api.bridge.getSubmitTxStatus({ txHash: '0xabc', srcChainKey: '0xa4b1.arbitrum' }),
    ).resolves.toEqual({ ok: true, value: future });
  });
});

// =========================================================================
// Domain → wire mapper: toCreateBridgeIntentParamsV2.
// =========================================================================

describe('toCreateBridgeIntentParamsV2', () => {
  it('renames SDK-domain fields to swaps wire names, serializes the bigint amount, and omits unset extras', () => {
    const wire = toCreateBridgeIntentParamsV2({
      srcChainKey: '0xa4b1.arbitrum',
      dstChainKey: '0x2105.base',
      srcToken: '0xsrc',
      dstToken: '0xdst',
      amount: 5000000000000000000n,
      srcAddress: '0xfrom',
      recipient: '0xto',
    });
    expect(wire).toEqual({
      srcChainKey: '0xa4b1.arbitrum',
      dstChainKey: '0x2105.base',
      inputToken: '0xsrc',
      outputToken: '0xdst',
      inputAmount: '5000000000000000000',
      srcAddress: '0xfrom',
      dstAddress: '0xto',
    });
    expect('srcPublicKey' in wire).toBe(false);
    expect('bound' in wire).toBe(false);
  });

  it('threads optional srcPublicKey / Bitcoin bound / per-request partnerFee extras', () => {
    const wire = toCreateBridgeIntentParamsV2(
      {
        srcChainKey: 'bitcoin',
        dstChainKey: '0x2105.base',
        srcToken: '0xsrc',
        dstToken: '0xdst',
        amount: 1n,
        srcAddress: 'bc1qfrom',
        recipient: '0xto',
      },
      { srcPublicKey: '0xpub', bound: { accessToken: 'tok' }, partnerFee: { address: '0xfee', percentage: 30 } },
    );
    expect(wire.srcPublicKey).toBe('0xpub');
    expect(wire.bound).toEqual({ accessToken: 'tok' });
    expect(wire.partnerFee).toEqual({ address: '0xfee', percentage: 30 });
  });
});

// =========================================================================
// valibot validation failures — malformed bodies resolve to ok:false.
// =========================================================================

describe('BridgeApiService response validation', () => {
  it('rejects getTokens when a token entry is missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ '0xa4b1.arbitrum': [{ symbol: 'USDC' }] }));
    const result = await sodax.api.bridge.getTokens();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      expect(err.context).toMatchObject({
        api: 'bridge',
        endpoint: '/bridge/tokens',
        reason: 'invalid_response_shape',
      });
      // issues are flattened (v.flatten) to match BackendApiService — a plain object that survives
      // SodaxError.toJSON, not a raw ValiError (which would sanitize down to just name + message).
      expect(err.context?.issues).toBeTypeOf('object');
      expect(err.context?.issues).not.toBeInstanceOf(Error);
    }
  });

  it('rejects approve when resetTx is malformed', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ tx: { from: '0x1', to: '0x2', value: '0', data: '0x' }, resetTx: { from: '0x1' } }),
    );
    const result = await sodax.api.bridge.approve(sampleCreateBridgeIntentParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
    }
  });

  it('rejects getSubmitTxStatus when the data envelope is missing', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ success: true }));
    const result = await sodax.api.bridge.getSubmitTxStatus({ txHash: '0xabc', srcChainKey: '0xa4b1.arbitrum' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      // The error context reports the static path — the query string moved into the wire client.
      expect(err.context?.endpoint).toBe('/bridge/submit-tx/status');
    }
  });

  it('does NOT tag a request-side VALIDATION_ERROR (stray bigint in the body) as invalid_response_shape', async () => {
    // Simulates an untyped JS caller passing a runtime bigint in a wire DTO. rejectBigint throws
    // before fetch; the failure is the caller's, so it must not be labeled a backend
    // response-shape problem (`reason`/`issues` are reserved for response validation).
    const badParams = { ...sampleCreateBridgeIntentParams, inputAmount: 1n } as unknown as CreateBridgeIntentParamsV2;
    const result = await sodax.api.bridge.checkAllowance(badParams);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.context?.code).toBe('VALIDATION_ERROR');
      expect(err.context?.reason).toBeUndefined();
      expect(err.context?.issues).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });
});

// =========================================================================
// Error propagation — HTTP, timeout, and network failures resolve to ok:false
// with a canonical SodaxError whose `cause` is the underlying BridgeApiError.
// Idempotent calls retry transient failures (delegated to @sodax/bridge-api).
// =========================================================================

describe('BridgeApiService error propagation', () => {
  it('wraps a non-retryable non-2xx response as EXTERNAL_API_ERROR (cause is a BridgeApiError HTTP_ERROR)', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(400, 'Bad Request'));
    const result = await sodax.api.bridge.getTokens();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      // Distinguish bridge-client errors from BackendApiService errors on the transport (catch) path.
      expect(err.context?.api).toBe('bridge');
      expect(err.context?.status).toBe(400);
      expect(err.cause).toBeInstanceOf(BridgeApiError);
      expect((err.cause as BridgeApiError).code).toBe('HTTP_ERROR');
      expect(isAuthFailure(result.error)).toBe(false);
    }
    expect(mockFetch).toHaveBeenCalledOnce(); // 400 is not retryable
  });

  it('lifts a 401 / 403 onto error.context so isAuthFailure recognizes it', async () => {
    // Without the lifted status a rejected key is indistinguishable from a transient failure, and a
    // keyed bridge submit-tx burns its whole attempt budget re-sending it.
    for (const status of [401, 403]) {
      mockFetch.mockResolvedValueOnce(httpErrorResponse(status, 'Unauthorized'));
      const result = await sodax.api.bridge.getTokens();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isSodaxError(result.error) && result.error.context?.status).toBe(status);
        expect(isAuthFailure(result.error)).toBe(true);
      }
    }
  });

  it('retries an idempotent call on a transient 503, then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(httpErrorResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(okResponse(tokensResponse));
    const result = await sodax.api.bridge.getTokens();
    expect(result).toEqual({ ok: true, value: tokensResponse });
    expect(mockFetch).toHaveBeenCalledTimes(2); // one retry after the 503
    expect(mockFetch).toHaveBeenLastCalledWith(`${BASE}/bridge/tokens`, expect.objectContaining({ method: 'GET' }));
  });

  it('never retries a non-idempotent call (submitTx) on a transient 503', async () => {
    mockFetch.mockResolvedValue(httpErrorResponse(503, 'Service Unavailable'));
    const result = await sodax.api.bridge.submitTx(sampleBridgeSubmitTxRequest);
    expect(result.ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledOnce(); // mutation: no retry despite the retryable status
  });

  it('wraps a timed-out call as EXTERNAL_API_ERROR with a TIMEOUT_ERROR cause, without retrying', async () => {
    mockFetch.mockImplementation(abortFetchImpl);
    const result = await sodax.api.bridge.getTokens({ timeout: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      // The wire code is surfaced in context so a timeout is distinguishable from a network drop.
      expect(err.context?.code).toBe('TIMEOUT_ERROR');
      expect(err.cause).toBeInstanceOf(BridgeApiError);
      expect((err.cause as BridgeApiError).code).toBe('TIMEOUT_ERROR');
    }
    // timeout is an overall deadline: it stops the call rather than burning the idempotent retry budget
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('wraps a raw network error as EXTERNAL_API_ERROR, preserving the original error on the cause chain', async () => {
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValue(networkError);
    const result = await sodax.api.bridge.getTokens();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.cause).toBeInstanceOf(BridgeApiError);
      // The original fetch error is preserved one level deeper, on the BridgeApiError's cause.
      expect((err.cause as BridgeApiError).cause).toBe(networkError);
    }
    expect(mockFetch).toHaveBeenCalledTimes(3); // network errors are retryable for idempotent calls
  });
});

// =========================================================================
// RequestOverrideConfig — baseURL / headers overrides.
// =========================================================================

describe('BridgeApiService RequestOverrideConfig', () => {
  it('overrides baseURL on GET and POST methods', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await sodax.api.bridge.getTokens({ baseURL: 'https://custom.example.com' });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://custom.example.com/bridge/tokens',
      expect.objectContaining({ method: 'GET' }),
    );

    mockFetch.mockResolvedValueOnce(okResponse(createBridgeIntentResponse));
    await sodax.api.bridge.createBridgeIntent(sampleCreateBridgeIntentParams, {
      baseURL: 'https://custom.example.com',
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://custom.example.com/bridge/intents',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('merges custom headers with the defaults (both present)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await sodax.api.bridge.getTokens({ headers: { 'X-Custom': 'test-value' } });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Custom': 'test-value',
        }),
      }),
    );
  });
});

// =========================================================================
// setHeaders (isolated instance to avoid leaking header mutations across the
// shared `sodax.api.bridge`).
// =========================================================================

describe('BridgeApiService.setHeaders', () => {
  it('persists headers into subsequent requests; a repeated mixed-casing update sends the newest value', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older casing last and let it win the merge.
    const service = new BridgeApiService({ baseURL: BASE, timeout: 30_000, headers: {} });
    service.setHeaders({ 'x-trace': 'v1', 'X-API-Key': 'api-key-123' });
    service.setHeaders({ 'X-Trace': 'v2' });
    service.setHeaders({ 'x-trace': 'v3' });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));

    await service.getTokens();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-trace')).toHaveLength(1);
    expect(new Headers(headers).get('x-trace')).toBe('v3');
    expect(new Headers(headers).get('x-api-key')).toBe('api-key-123');
  });
});

// =========================================================================
// API key → x-api-key. Precedence: per-call header > per-call apiKey > configured header > configured
// key. The adapter builds a `@sodax/bridge-api` client per call, so the key has to survive that hop —
// `BridgeService` sends the per-action key as `overrideConfig.apiKey` on the submit-tx leg.
// =========================================================================

const sentHeaders = (): Record<string, string> => mockFetch.mock.calls[0]?.[1]?.headers;

describe('BridgeApiService API key', () => {
  it('sends a configured x-api-key header, treating an empty per-call apiKey as unset', async () => {
    const service = new BridgeApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'config-key' } });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await service.getTokens({ apiKey: '' });
    expect(sentHeaders()['x-api-key']).toBe('config-key');
  });

  it('bakes the instance key from new Sodax({ apiKey }) into bridge requests; a per-call apiKey wins over it', async () => {
    const keyed = new Sodax({ apiKey: 'global-key', logger: 'silent' });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await keyed.api.bridge.getTokens();
    expect(sentHeaders()['x-api-key']).toBe('global-key');

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await keyed.api.bridge.getTokens({ apiKey: 'call-key' });
    expect(sentHeaders()['x-api-key']).toBe('call-key');
  });

  it('lets a per-call x-api-key header win over the per-call apiKey, in any casing', async () => {
    // fetch folds two casings of one header name into a comma-joined value, so the case variant must
    // REPLACE the expanded key instead of being sent alongside it.
    for (const name of ['x-api-key', 'X-Api-Key']) {
      mockFetch.mockReset();
      const service = new BridgeApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'config-key' } });
      mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
      await service.getTokens({ apiKey: 'call-key', headers: { [name]: 'call-header-key' } });
      const headers = sentHeaders();
      expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
      expect(new Headers(headers).get('x-api-key')).toBe('call-header-key');
    }
  });

  it('sends no x-api-key when nothing configures one', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await sodax.api.bridge.getTokens();
    expect(sentHeaders()['x-api-key']).toBeUndefined();
  });
});
