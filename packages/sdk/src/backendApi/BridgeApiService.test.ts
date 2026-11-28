/**
 * Tests for the BridgeApiService HTTP client (backend Bridge API).
 *
 * Mirrors SwapsApiService.test.ts:
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.api.bridge` is the
 *      service under test. `vi.stubGlobal('fetch', ...)` intercepts every outbound call.
 *   2. Routes, retries and body serialization belong to `@sodax/bridge-api`'s own suite, and the per-service
 *      API-key / header precedence to BackendApiService.test.ts; this file pins the adapter's own
 *      mapping (error context, response-shape tagging, request-body normalization).
 *   3. Every method returns `Result<T>` — happy paths assert `{ ok: true, value }`,
 *      failures assert `{ ok: false }` with the expected error (a `BridgeApiError` on `cause`).
 *
 * Bridge-specific deltas covered: the submit-tx body carries the FULL `relayData { address, payload }`
 * envelope; the domain→wire mapper `toCreateBridgeIntentParamsV2` converts SDK names + bigint.
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
// Happy paths — valibot validation succeeds, Result wraps the parsed body.
// =========================================================================

describe('BridgeApiService happy paths (validated responses)', () => {
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
// =========================================================================

describe('BridgeApiService error propagation', () => {
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

// Direct construction (no facade options) also pins the default legacy-trim option.
describe('BridgeApiService.setHeaders', () => {
  it('persists headers into subsequent requests; a repeated mixed-casing update sends the newest value', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older casing last and let it win the merge.
    const service = new BridgeApiService({ baseURL: BASE, timeout: 30_000, headers: {} });
    service.setHeaders({ 'x-trace': 'v1', 'X-API-Key': 'api-key-123' });
    service.setHeaders({ 'X-Trace': 'v2' });
    service.setHeaders({ 'x-trace': 'v3' });
    mockFetch.mockResolvedValueOnce(okResponse({}));

    await service.getTokens();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-trace')).toHaveLength(1);
    expect(new Headers(headers).get('x-trace')).toBe('v3');
    expect(new Headers(headers).get('x-api-key')).toBe('api-key-123');
  });
});
