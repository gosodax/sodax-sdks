/**
 * Tests for the SwapsApiService HTTP client (backend Swaps API).
 *
 * Mirrors BackendApiService.test.ts:
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.api.swaps` is the
 *      service under test. `vi.stubGlobal('fetch', ...)` intercepts every outbound call.
 *   2. URL construction, HTTP method, default vs override headers, query-string params,
 *      request-body serialization (incl. bigint → decimal string), and response validation
 *      are all asserted explicitly. The service delegates the wire work to `@sodax/swaps-api`.
 *   3. Every method returns `Result<T>` — happy paths assert `{ ok: true, value }`,
 *      failures assert `{ ok: false }` with the expected error (a `SwapsApiError` on `cause`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  HookKind,
  type CreateIntentParamsV2,
  type CreateLimitOrderParamsV2,
  type IntentRequestV2,
  type QuoteRequestV2,
  type SubmitTxRequestV2,
} from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SwapsApiService } from './SwapsApiService.js';
import { SodaxError } from '../errors/SodaxError.js';
import { SwapsApiError } from '@sodax/swaps-api';
import type { RequestOverrideConfig } from './api-utils.js';

// --- fetch stub -----------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

const sampleQuoteRequest: QuoteRequestV2 = {
  tokenSrc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  tokenSrcChainKey: '0xa4b1.arbitrum',
  tokenDst: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  tokenDstChainKey: '0x89.polygon',
  amount: '1000000',
  quoteType: 'exact_input',
};

const sampleSubmitTxRequest: SubmitTxRequestV2 = {
  txHash: TX_HASH,
  srcChainKey: '0x38.bsc',
  walletAddress: '0x152740b9dB0C232a2909d4BeE5Ee83F565785813',
  intent: sampleIntentRequest,
  relayData: '0x',
};

// Valid response bodies (each matches its valibot schema).
const intentResponse = {
  intentId: '1',
  creator: '0x1',
  inputToken: '0x2',
  outputToken: '0x3',
  inputAmount: '1000000',
  minOutputAmount: '990000',
  deadline: '0',
  allowPartialFill: false,
  srcChain: '146',
  dstChain: '5',
  srcAddress: '0x4',
  dstAddress: '0x5',
  solver: '0x0',
  data: '0x',
};
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
const createIntentResponse = {
  tx: { from: '0x1', to: '0x2', value: '0', data: '0x' },
  intent: intentResponse,
  relayData: { address: '0xaddr', payload: '0xpayload' },
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
// URL + HTTP method for the endpoints without a behavioural test in this file;
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
// Happy paths — valibot validation succeeds, Result wraps the parsed body.
// =========================================================================

describe('SwapsApiService happy paths (validated responses)', () => {
  it('getQuote POSTs the request and returns the quoted amount; includeTxData=true transforms txData.tx (value → bigint)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ quotedAmount: '987654' }));
    const plain = await sodax.api.swaps.getQuote(sampleQuoteRequest);
    expect(plain).toEqual({ ok: true, value: { quotedAmount: '987654' } });
    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE}/swaps/quote`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(sampleQuoteRequest) }),
    );

    mockFetch.mockResolvedValueOnce(okResponse({ quotedAmount: '987654', txData: createIntentResponse }));
    const result = await sodax.api.swaps.getQuote(sampleQuoteRequest, { includeTxData: true });
    // tokenSrcChainKey is an EVM chain, so the EVM raw-tx schema transforms txData.tx.value "0" → 0n.
    expect(result).toEqual({
      ok: true,
      value: {
        quotedAmount: '987654',
        txData: { ...createIntentResponse, tx: { ...createIntentResponse.tx, value: 0n } },
      },
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE}/swaps/quote?includeTxData=true`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(sampleQuoteRequest) }),
    );
  });

  it('getStatus returns ok:true with a SOLVED status code and fill tx hash', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ status: 3, fillTxHash: '0xfill' }));
    const result = await sodax.api.swaps.getStatus({ intentTxHash: TX_HASH });
    expect(result).toEqual({ ok: true, value: { status: 3, fillTxHash: '0xfill' } });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/swaps/intents/status`, expect.objectContaining({ method: 'POST' }));
  });

  it('createIntent returns ok:true with { tx, intent, relayData } (tx.value decimal string → bigint)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(createIntentResponse));
    const result = await sodax.api.swaps.createIntent(sampleCreateIntentParams);
    // srcChainKey is an EVM chain, so the EVM raw-tx schema transforms value "0" → 0n.
    expect(result).toEqual({
      ok: true,
      value: { ...createIntentResponse, tx: { ...createIntentResponse.tx, value: 0n } },
    });
  });

  // SDK-service layer counterpart of the same-named assertion in packages/swaps-api/src/client.test.ts —
  // proves the SDK wrapper serializes `hook` onto the wire unmodified, NOT that any backend forwards it.
  const hookedQuote: QuoteRequestV2 = { ...sampleQuoteRequest, hook: { kind: HookKind.HYPERCORE_DEPOSIT } };
  const hookedParams: CreateIntentParamsV2 = {
    ...sampleCreateIntentParams,
    hook: { kind: HookKind.HYPERCORE_DEPOSIT },
  };
  it.each([
    {
      name: 'getQuote',
      url: `${BASE}/swaps/quote?includeTxData=true`,
      body: hookedQuote,
      invoke: () => sodax.api.swaps.getQuote(hookedQuote, { includeTxData: true }),
      response: { quotedAmount: '987654', txData: createIntentResponse },
    },
    {
      name: 'createIntent',
      url: `${BASE}/swaps/intents`,
      body: hookedParams,
      invoke: () => sodax.api.swaps.createIntent(hookedParams),
      response: createIntentResponse,
    },
  ])('$name forwards an optional hook field on the outgoing request body (client-side passthrough only)', async ({
    url,
    body,
    invoke,
    response,
  }) => {
    mockFetch.mockResolvedValueOnce(okResponse(response));
    await invoke();
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    );
  });

  it('getFilledIntent returns ok:true with the on-chain fill state', async () => {
    const fillState = { exists: true, remainingInput: '0', receivedOutput: '990000', pendingPayment: false };
    mockFetch.mockResolvedValueOnce(okResponse(fillState));
    const result = await sodax.api.swaps.getFilledIntent(TX_HASH);
    expect(result).toEqual({ ok: true, value: fillState });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/swaps/intents/${TX_HASH}/fill`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getSubmitTxStatus returns ok:true and unwraps the { success, data } envelope shape', async () => {
    const body = {
      success: true,
      data: {
        txHash: '0xabc',
        srcChainKey: '0x38.bsc',
        status: 'solved',
        processingAttempts: 1,
        result: { dstIntentTxHash: '0xdst' },
      },
    };
    mockFetch.mockResolvedValueOnce(okResponse(body));
    const result = await sodax.api.swaps.getSubmitTxStatus({ txHash: '0xabc', srcChainKey: '0x38.bsc' });
    expect(result).toEqual({ ok: true, value: body });
    if (result.ok) expect(result.value.data.result?.dstIntentTxHash).toBe('0xdst');
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

  it('cancelIntent serializes the intent struct bigints to decimal strings and drops feeAmount', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ tx: { from: '0x1', to: '0x2', value: '0', data: '0x' } }));

    const result = await sodax.api.swaps.cancelIntent({ srcChainKey: '0x38.bsc', intent: intentWithFee });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/swaps/intents/cancel`, expect.objectContaining({ method: 'POST' }));
    const parsed = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(parsed.intent.feeAmount).toBeUndefined();
    expect(parsed.intent.intentId).toBe('123456789');
    expect(parsed.intent.inputAmount).toBe('5000000000000000000');
    expect(parsed.intent.deadline).toBe('0');
    expect(parsed.srcChainKey).toBe('0x38.bsc');
  });

  it('getIntentHash drops feeAmount from the serialized intent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ hash: '0xabc' }));

    const result = await sodax.api.swaps.getIntentHash({ intent: intentWithFee });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/swaps/intents/hash`, expect.objectContaining({ method: 'POST' }));
    const parsed = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(parsed.intent.feeAmount).toBeUndefined();
    expect(parsed.intent.deadline).toBe('0');
  });
});

// =========================================================================
// valibot validation failures — malformed bodies resolve to ok:false.
// =========================================================================

describe('SwapsApiService response validation', () => {
  it('rejects getTokens when a token entry is missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ '0xa4b1.arbitrum': [{ symbol: 'USDC' }] }));
    const result = await sodax.api.swaps.getTokens();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      expect(err.context).toMatchObject({
        api: 'swaps',
        endpoint: '/swaps/tokens',
        reason: 'invalid_response_shape',
      });
      // issues are flattened (v.flatten) to match BackendApiService — a plain object that survives
      // SodaxError.toJSON, not a raw ValiError (which would sanitize down to just name + message).
      expect(err.context?.issues).toBeTypeOf('object');
      expect(err.context?.issues).not.toBeInstanceOf(Error);
    }
  });

  it('rejects getStatus when status is not one of the allowed codes', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ status: 99 }));
    const result = await sodax.api.swaps.getStatus({ intentTxHash: TX_HASH });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.context?.endpoint).toBe('/swaps/intents/status');
      expect(err.context?.reason).toBe('invalid_response_shape');
    }
  });

  it('rejects getSubmitTxStatus when the data envelope is missing', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ success: true }));
    const result = await sodax.api.swaps.getSubmitTxStatus({ txHash: '0xabc', srcChainKey: '0x38.bsc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
    }
  });

  it('does NOT mislabel a request-side validation error (stray bigint) as invalid_response_shape', async () => {
    // A bigint planted in a non-numeric intent field makes serializeIntentRequest throw
    // VALIDATION_ERROR before any HTTP call — a caller bug, not a backend response-shape fault.
    const badIntent = { ...sampleIntentRequest, creator: 5n as unknown as string };
    const result = await sodax.api.swaps.cancelIntent({ srcChainKey: '0x38.bsc', intent: badIntent });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.context?.code).toBe('VALIDATION_ERROR');
      expect(err.context?.reason).toBeUndefined(); // not tagged as a response-shape problem
    }
    expect(mockFetch).not.toHaveBeenCalled(); // failed before reaching the network
  });
});

// =========================================================================
// Error propagation — HTTP, timeout, and network failures resolve to ok:false
// with a canonical SodaxError whose `cause` is the underlying SwapsApiError.
// Idempotent calls retry transient failures (delegated to @sodax/swaps-api).
// =========================================================================

describe('SwapsApiService error propagation', () => {
  it('wraps a non-retryable non-2xx response as EXTERNAL_API_ERROR (cause is a SwapsApiError HTTP_ERROR)', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(400, 'Bad Request'));
    const result = await sodax.api.swaps.getTokens();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      // Distinguish swaps-client errors from BackendApiService errors on the transport (catch) path.
      expect(err.context?.api).toBe('swaps');
      expect(err.context?.status).toBe(400);
      expect(err.cause).toBeInstanceOf(SwapsApiError);
      expect((err.cause as SwapsApiError).code).toBe('HTTP_ERROR');
    }
    expect(mockFetch).toHaveBeenCalledOnce(); // 400 is not retryable
  });

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

  it('retries an idempotent call on a transient 503, then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(httpErrorResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(okResponse(tokensResponse));
    const result = await sodax.api.swaps.getTokens();
    expect(result).toEqual({ ok: true, value: tokensResponse });
    expect(mockFetch).toHaveBeenCalledTimes(2); // one retry after the 503
  });

  it('wraps a timed-out call as EXTERNAL_API_ERROR with a TIMEOUT_ERROR cause, without retrying', async () => {
    mockFetch.mockImplementation(abortFetchImpl);
    const result = await sodax.api.swaps.getTokens({ timeout: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      // The wire code is surfaced in context so a timeout is distinguishable from a network drop.
      expect(err.context?.code).toBe('TIMEOUT_ERROR');
      expect(err.cause).toBeInstanceOf(SwapsApiError);
      expect((err.cause as SwapsApiError).code).toBe('TIMEOUT_ERROR');
    }
    // timeout is an overall deadline: it stops the call rather than burning the idempotent retry budget
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('wraps a raw network error as EXTERNAL_API_ERROR, preserving the original error on the cause chain', async () => {
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValue(networkError);
    const result = await sodax.api.swaps.getTokens();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.cause).toBeInstanceOf(SwapsApiError);
      // The original fetch error is preserved one level deeper, on the SwapsApiError's cause.
      expect((err.cause as SwapsApiError).cause).toBe(networkError);
    }
    expect(mockFetch).toHaveBeenCalledTimes(3); // network errors are retryable for idempotent calls
  });
});

// =========================================================================
// RequestOverrideConfig — baseURL / headers / timeout overrides.
// =========================================================================

describe('SwapsApiService RequestOverrideConfig', () => {
  it('overrides baseURL on GET and POST methods', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await sodax.api.swaps.getTokens({ baseURL: 'https://custom.example.com' });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://custom.example.com/swaps/tokens',
      expect.objectContaining({ method: 'GET' }),
    );

    mockFetch.mockResolvedValueOnce(okResponse(createIntentResponse));
    await sodax.api.swaps.createIntent(sampleCreateIntentParams, { baseURL: 'https://custom.example.com' });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://custom.example.com/swaps/intents',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('merges custom headers with the defaults (both present) on the default baseURL', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await sodax.api.swaps.getTokens({ headers: { 'X-Custom': 'test-value' } });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/swaps/tokens`,
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
// API key → x-api-key. Precedence: per-call header > per-call apiKey > configured header > configured key.
// =========================================================================

const sentHeaders = (): Record<string, string> => mockFetch.mock.calls[0]?.[1]?.headers;

describe('SwapsApiService API key', () => {
  it('sends a configured x-api-key header, treating an empty per-call apiKey as unset', async () => {
    const service = new SwapsApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'config-key' } });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await service.getTokens({ apiKey: '' });
    expect(sentHeaders()['x-api-key']).toBe('config-key');
  });

  it('lets an explicit configured x-api-key header win over the instance key', async () => {
    const keyed = new Sodax({
      apiKey: 'global-key',
      api: { swapsApiConfig: { headers: { 'x-api-key': 'header-key' } } },
      logger: 'silent',
    });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await keyed.api.swaps.getTokens();
    expect(sentHeaders()['x-api-key']).toBe('header-key');
  });

  it('lets a per-call x-api-key header win over the per-call apiKey, in any casing, even when blank', async () => {
    // fetch folds two casings of one header name into a comma-joined value, so the case variant must
    // REPLACE the expanded key instead of being sent alongside it.
    for (const name of ['x-api-key', 'X-Api-Key']) {
      mockFetch.mockReset();
      const service = new SwapsApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'config-key' } });
      mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
      await service.getTokens({ apiKey: 'call-key', headers: { [name]: 'call-header-key' } });
      const headers = sentHeaders();
      expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
      expect(new Headers(headers).get('x-api-key')).toBe('call-header-key');
    }

    // A blank per-call header is sent verbatim rather than falling back.
    mockFetch.mockReset();
    const service = new SwapsApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'config-key' } });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await service.getTokens({ apiKey: 'call-key', headers: { 'x-api-key': '' } });
    expect(new Headers(sentHeaders()).get('x-api-key')).toBe('');
  });
});

describe('Sodax → swaps API key wiring', () => {
  it('sends no x-api-key when nothing configures one, and treats an empty apiKey as unset', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await sodax.api.swaps.getTokens();
    expect(sentHeaders()['x-api-key']).toBeUndefined();

    mockFetch.mockReset();
    const keyed = new Sodax({ apiKey: '', logger: 'silent' });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));
    await keyed.api.swaps.getTokens();
    expect(sentHeaders()['x-api-key']).toBeUndefined();
  });

  it('keeps the credential off the public instanceConfig', () => {
    const keyed = new Sodax({ apiKey: 'global-key', logger: 'silent' });
    expect(keyed.instanceConfig.apiKey).toBeUndefined();
    expect(keyed.config.apiKey).toBe('global-key');
  });
});

// =========================================================================
// API key on the submit-tx flow — the two methods runBackendSubmitTx drives.
// Asserted on the outgoing fetch request, read through `new Headers(...)`.
// =========================================================================

describe('SwapsApiService API key on the submit-tx flow', () => {
  const submitFlows = [
    {
      name: 'submitTx',
      invoke: (swaps: SwapsApiService, config?: RequestOverrideConfig) => swaps.submitTx(sampleSubmitTxRequest, config),
      url: `${BASE}/swaps/submit-tx`,
      method: 'POST',
      body: { success: true, data: { status: 'inserted', message: 'ok' } },
    },
    {
      name: 'getSubmitTxStatus',
      invoke: (swaps: SwapsApiService, config?: RequestOverrideConfig) =>
        swaps.getSubmitTxStatus({ txHash: '0xabc', srcChainKey: '0x38.bsc' }, config),
      url: `${BASE}/swaps/submit-tx/status?txHash=0xabc&srcChainKey=0x38.bsc`,
      method: 'GET',
      body: {
        success: true,
        data: { txHash: '0xabc', srcChainKey: '0x38.bsc', status: 'solved', processingAttempts: 1 },
      },
    },
  ];

  // Exactly one call is pinned per request, so the URL, method, and header all describe THAT request.
  it.each(submitFlows)('$name sends the instance key on the wire, and a per-request apiKey wins over it', async ({
    invoke,
    url,
    method,
    body,
  }) => {
    const keyed = new Sodax({ apiKey: 'global-key', logger: 'silent' });
    for (const [config, expected] of [
      [undefined, 'global-key'],
      [{ apiKey: 'call-key' }, 'call-key'],
    ] as const) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(okResponse(body));
      await invoke(keyed.api.swaps, config);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toBe(url);
      expect(mockFetch.mock.calls[0]?.[1]?.method).toBe(method);
      expect(new Headers(sentHeaders()).get('x-api-key')).toBe(expected);
    }
  });
});

// =========================================================================
// setHeaders (isolated instance to avoid leaking header mutations across the
// shared `sodax.api.swaps`).
// =========================================================================

describe('SwapsApiService.setHeaders', () => {
  it('persists headers into subsequent requests; a repeated mixed-casing update sends the newest value', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older `X-Api-Key` last and let it win the merge —
    // silently shipping the superseded credential. setHeaders must be case-insensitively last-write-wins.
    const service = new SwapsApiService({ baseURL: BASE, timeout: 30_000, headers: { 'x-api-key': 'v1' } });
    service.setHeaders({ 'X-Api-Key': 'v2', 'X-Trace': 't' });
    service.setHeaders({ 'x-api-key': 'v3' });
    mockFetch.mockResolvedValueOnce(okResponse(tokensResponse));

    await service.getTokens();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('v3');
    expect(headers['X-Trace']).toBe('t');
  });
});
