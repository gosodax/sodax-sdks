/**
 * Tests for the SwapsApiService HTTP client (backend Swaps API).
 *
 * Mirrors BackendApiService.test.ts:
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.api.swaps` is the
 *      service under test. `stubFetch()` intercepts every outbound call.
 *   2. Routes, retries and body serialization belong to `@sodax/swaps-api`'s own suite, and the per-service
 *      API-key / header precedence to BackendApiService.test.ts; this file pins the adapter's own
 *      mapping (error context, response-shape tagging, request-body normalization).
 *   3. Every method returns `Result<T>` — happy paths assert `{ ok: true, value }`,
 *      failures assert `{ ok: false }` with the expected error (a `SwapsApiError` on `cause`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  type CreateIntentParamsV2,
  type CreateLimitOrderParamsV2,
  type IntentRequestV2,
  type SubmitTxRequestV2,
} from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SwapsApiService } from './SwapsApiService.js';
import { SwapsApiError } from '@sodax/swaps-api';
import { abortingFetch, httpErrorResponse, okResponse, stubFetch } from '../test-utils/fetch.js';
import { expectErr, expectOk } from '../test-utils/result.js';

const mockFetch = stubFetch();

// --- fixtures -------------------------------------------------------------
const sodax = new Sodax();
const BASE = DEFAULT_API_BASE_URL;
const TX_HASH = '0x46b053464f50836328b6158e1e33e5cf66c0e3ebe5004d30459b23acae5047a0';

const sampleIntentRequest: IntentRequestV2 = {
  intentId: 123456789n,
  creator: '0x152740b9dB0C232a2909d4BeE5Ee83F565785813',
  inputToken: '0xb66cB7D841272AF6BaA8b8119007EdEE35d2C24F',
  outputToken: '0x9Ee17486571917837210824b0d4CAdfe3B324D12',
  inputAmount: 5000000000000000000n,
  minOutputAmount: 1965353839071625320n,
  deadline: 0n,
  allowPartialFill: false,
  srcChain: 1768124270n,
  dstChain: 5n,
  srcAddress: '0x000136a591b8bf330f129fd75686199ee34f09ebbd',
  dstAddress: '0x33bad609fd656df90fb9da00058c59a54a5d7a6f',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};

const sampleCreateIntentParams: CreateIntentParamsV2 = {
  srcChainKey: '0xa4b1.arbitrum',
  dstChainKey: '0x89.polygon',
  inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  outputToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '0',
  allowPartialFill: false,
  srcAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
  dstAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
};

const sampleLimitOrderParams: CreateLimitOrderParamsV2 = {
  srcChainKey: '0xa4b1.arbitrum',
  dstChainKey: '0x89.polygon',
  inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  outputToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  inputAmount: '1000000',
  minOutputAmount: '990000',
  allowPartialFill: false,
  srcAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
  dstAddress: '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31',
};

const sampleSubmitTxRequest: SubmitTxRequestV2 = {
  txHash: TX_HASH,
  srcChainKey: '0x38.bsc',
  walletAddress: '0x152740b9dB0C232a2909d4BeE5Ee83F565785813',
  intent: sampleIntentRequest,
  relayData: '0x',
};

// Braces matter: `mockReset()` returns the mock, and a `beforeEach` that returns a function
// registers it as a teardown — vitest 4 leaves the impl in place, so it would fire the stub.
beforeEach(() => {
  mockFetch.mockReset();
});

// =========================================================================
// URL + HTTP method for the remaining endpoint routes;
// only the fetch call is asserted, so response bodies need not satisfy the schema.
// =========================================================================

describe('SwapsApiService endpoint routing', () => {
  type Case = { name: string; invoke: () => Promise<{ ok: boolean }>; method: 'GET' | 'POST'; url: string };
  const cases: Case[] = [
    {
      name: 'getTokensByChain',
      invoke: () => sodax.api.swaps.getTokensByChain('0xa4b1.arbitrum'),
      method: 'GET',
      url: `${BASE}/swaps/tokens/0xa4b1.arbitrum`,
    },
    {
      name: 'getDeadline',
      invoke: () => sodax.api.swaps.getDeadline({ offsetSeconds: 600 }),
      method: 'GET',
      url: `${BASE}/swaps/deadline?offsetSeconds=600`,
    },
    {
      name: 'checkAllowance',
      invoke: () => sodax.api.swaps.checkAllowance(sampleCreateIntentParams),
      method: 'POST',
      url: `${BASE}/swaps/allowance/check`,
    },
    {
      name: 'approve',
      invoke: () => sodax.api.swaps.approve(sampleCreateIntentParams),
      method: 'POST',
      url: `${BASE}/swaps/approve`,
    },
    {
      name: 'submitIntent',
      invoke: () => sodax.api.swaps.submitIntent({ chainId: '146', txHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/swaps/intents/submit`,
    },
    {
      name: 'getSolvedIntentPacket',
      invoke: () => sodax.api.swaps.getSolvedIntentPacket({ chainId: '5', fillTxHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/swaps/intents/packet`,
    },
    {
      name: 'getIntentSubmitTxExtraData',
      invoke: () => sodax.api.swaps.getIntentSubmitTxExtraData({ txHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/swaps/intents/extra-data`,
    },
    {
      name: 'getIntent',
      invoke: () => sodax.api.swaps.getIntent(TX_HASH),
      method: 'GET',
      url: `${BASE}/swaps/intents/${TX_HASH}`,
    },
    {
      name: 'createLimitOrderIntent',
      invoke: () => sodax.api.swaps.createLimitOrderIntent(sampleLimitOrderParams),
      method: 'POST',
      url: `${BASE}/swaps/limit-orders`,
    },
    {
      name: 'estimateGas',
      invoke: () => sodax.api.swaps.estimateGas({ chainKey: '0x38.bsc', tx: { from: '0x1' } }),
      method: 'POST',
      url: `${BASE}/swaps/gas/estimate`,
    },
    {
      name: 'getPartnerFee',
      invoke: () => sodax.api.swaps.getPartnerFee({ amount: '1000000' }),
      method: 'GET',
      url: `${BASE}/swaps/fees/partner?amount=1000000`,
    },
    {
      name: 'getSolverFee',
      invoke: () => sodax.api.swaps.getSolverFee({ amount: '1000000' }),
      method: 'GET',
      url: `${BASE}/swaps/fees/solver?amount=1000000`,
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
// Intent-carrying request bodies. The intent struct's bigint numerics serialize to
// decimal strings so JSON.stringify does not throw. `sodax.swaps.createIntent` returns
// `Intent & FeeAmount`, and callers pass that intent straight in, so SwapsApiService
// drops the SDK-only `feeAmount` before the strict wire serializer (which would
// otherwise throw before fetch, leaving no request body and result.ok false).
// =========================================================================

describe('SwapsApiService intent body serialization', () => {
  const intentWithFee = { ...sampleIntentRequest, feeAmount: 12345n };

  it('submitTx returns the insertion status, serializing intent bigints and dropping feeAmount', async () => {
    const body = { success: true, data: { status: 'inserted', message: 'Swap transaction submitted successfully' } };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    const result = await sodax.api.swaps.submitTx({ ...sampleSubmitTxRequest, intent: intentWithFee });

    expect(result).toEqual({ ok: true, value: body });
    const parsed = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(parsed.intent.feeAmount).toBeUndefined();
    expect(parsed.intent.minOutputAmount).toBe('1965353839071625320');
  });

  const intentBearing = [
    {
      name: 'cancelIntent',
      invoke: () => sodax.api.swaps.cancelIntent({ srcChainKey: '0x38.bsc', intent: intentWithFee }),
      body: { tx: { from: '0x1', to: '0x2', value: '0', data: '0x' } },
      path: 'cancel',
    },
    {
      name: 'getIntentHash',
      invoke: () => sodax.api.swaps.getIntentHash({ intent: intentWithFee }),
      body: { hash: '0xabc' },
      path: 'hash',
    },
  ];

  it('cancelIntent and getIntentHash serialize intent bigints and drop feeAmount', async () => {
    for (const { name, invoke, body, path } of intentBearing) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(okResponse(body));
      expectOk<unknown, unknown>(await invoke(), name);
      expect(mockFetch, name).toHaveBeenCalledWith(
        `${BASE}/swaps/intents/${path}`,
        expect.objectContaining({ method: 'POST' }),
      );
      const parsed = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(parsed.intent.feeAmount, name).toBeUndefined();
      expect(parsed.intent.intentId, name).toBe('123456789');
      expect(parsed.intent.inputAmount, name).toBe('5000000000000000000');
      expect(parsed.intent.deadline, name).toBe('0');
      if (name === 'cancelIntent') expect(parsed.srcChainKey).toBe('0x38.bsc');
    }
  });
});

// =========================================================================
// valibot validation failures — malformed bodies resolve to ok:false.
// =========================================================================

describe('SwapsApiService response validation', () => {
  it('rejects getTokens when a token entry is missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ '0xa4b1.arbitrum': [{ symbol: 'USDC' }] }));
    const err = expectErr(await sodax.api.swaps.getTokens(), 'EXTERNAL_API_ERROR', {
      api: 'swaps',
      endpoint: '/swaps/tokens',
      reason: 'invalid_response_shape',
    });
    expect(err.feature).toBe('backend');
    // issues are flattened (v.flatten) to match BackendApiService — a plain object that survives
    // SodaxError.toJSON, not a raw ValiError (which would sanitize down to just name + message).
    expect(err.context?.issues).toBeTypeOf('object');
    expect(err.context?.issues).not.toBeInstanceOf(Error);
  });

  it('does NOT mislabel a request-side validation error (stray bigint) as invalid_response_shape', async () => {
    // A bigint planted in a non-numeric intent field makes serializeIntentRequest throw
    // VALIDATION_ERROR before any HTTP call — a caller bug, not a backend response-shape fault.
    const badIntent = { ...sampleIntentRequest, creator: 5n as unknown as string };
    const result = await sodax.api.swaps.cancelIntent({ srcChainKey: '0x38.bsc', intent: badIntent });
    const err = expectErr(result, 'EXTERNAL_API_ERROR', { code: 'VALIDATION_ERROR' });
    expect(err.context?.reason).toBeUndefined(); // not tagged as a response-shape problem
    expect(mockFetch).not.toHaveBeenCalled(); // failed before reaching the network
  });
});

// =========================================================================
// Error propagation — HTTP, timeout, and network failures resolve to ok:false
// with a canonical SodaxError whose `cause` is the underlying SwapsApiError.
// =========================================================================

describe('SwapsApiService error propagation', () => {
  // `SwapService.getDetailedStatus` reads exactly these fields to tell a definitive "no record"
  // (404) from a backend that could not answer, and routes and budgets its retries on the answer.
  // Pinned on this endpoint specifically so drift in the error mapping fails here rather than
  // silently turning a backend outage into a budgetable miss.
  it('preserves HTTP 404 for submit-tx status lookup', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(404, 'Not Found'));

    const result = await sodax.api.swaps.getSubmitTxStatus({
      txHash: '0xabc',
      srcChainKey: '0x38.bsc',
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'EXTERNAL_API_ERROR',
        context: {
          api: 'swaps',
          code: 'HTTP_ERROR',
          status: 404,
        },
      },
    });
  });

  it('wraps a timed-out call as EXTERNAL_API_ERROR with a TIMEOUT_ERROR cause, without retrying', async () => {
    mockFetch.mockImplementation(abortingFetch);
    // The wire code is surfaced in context so a timeout is distinguishable from a network drop.
    const err = expectErr(await sodax.api.swaps.getTokens({ timeout: 5 }), 'EXTERNAL_API_ERROR', {
      code: 'TIMEOUT_ERROR',
    });
    expect(err.cause).toBeInstanceOf(SwapsApiError);
    expect((err.cause as SwapsApiError).code).toBe('TIMEOUT_ERROR');
    // timeout is an overall deadline: it stops the call rather than burning the idempotent retry budget
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('wraps a raw network error as EXTERNAL_API_ERROR, preserving the original error on the cause chain', async () => {
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValue(networkError);
    const err = expectErr(await sodax.api.swaps.getTokens(), 'EXTERNAL_API_ERROR');
    expect(err.cause).toBeInstanceOf(SwapsApiError);
    // The original fetch error is preserved one level deeper, on the SwapsApiError's cause.
    expect((err.cause as SwapsApiError).cause).toBe(networkError);
    expect(mockFetch).toHaveBeenCalledTimes(3); // network errors are retryable for idempotent calls
  });
});

describe('Sodax → swaps API key wiring', () => {
  it('keeps the credential off the public instanceConfig', () => {
    const keyed = new Sodax({ apiKey: 'global-key', logger: 'silent' });
    expect(keyed.instanceConfig.apiKey).toBeUndefined();
    expect(keyed.config.apiKey).toBe('global-key');
  });
});

// Direct construction (no facade options) also pins the default legacy-trim option.
describe('SwapsApiService.setHeaders', () => {
  it('persists headers into subsequent requests; a repeated mixed-casing update sends the newest value', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older `X-Api-Key` last and let it win the merge —
    // silently shipping the superseded credential. setHeaders must be case-insensitively last-write-wins.
    const service = new SwapsApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'v1' } });
    service.setHeaders({ 'X-Api-Key': 'v2', 'X-Trace': 't' });
    service.setHeaders({ 'x-api-key': 'v3' });
    mockFetch.mockResolvedValueOnce(okResponse({}));

    await service.getTokens();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('v3');
    expect(headers['X-Trace']).toBe('t');
  });
});
