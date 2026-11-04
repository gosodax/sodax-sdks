/**
 * Tests for the LeverageYieldApiService HTTP client (backend Leverage Yield API).
 *
 * Mirrors SwapsApiService.test.ts / BridgeApiService.test.ts:
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.api.leverageYield` is the
 *      service under test. `vi.stubGlobal('fetch', ...)` intercepts every outbound call.
 *   2. URL construction, HTTP method, default vs override headers, query-string params,
 *      request-body serialization, and valibot response validation are asserted explicitly.
 *   3. Every method returns `Result<T>` — happy paths assert `{ ok: true, value }`,
 *      failures assert `{ ok: false }` with the expected error.
 *
 * Leverage-yield-specific deltas covered: the vault registry / vault-read routes, the separate
 * deposit and withdraw quote + create-intent routes, the `operation` discriminator on the
 * submit-tx body, `solved` as the terminal submit-tx status, and the `feeAmount` strip that keeps
 * the SDK-only display field off the wire on every intent-bearing call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  type CreateDepositIntentParamsV2,
  type CreateWithdrawIntentParamsV2,
  type IntentRequestV2,
  type LeverageYieldSubmitTxRequestV2,
} from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { LeverageYieldApiService } from './LeverageYieldApiService.js';
import type { SodaxError } from '../errors/SodaxError.js';
import { isAuthFailure, isSodaxError } from '../errors/guards.js';
import { silentLogger } from '../shared/logger.js';

// --- fetch stub -----------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- fixtures -------------------------------------------------------------
const sodax = new Sodax({ logger: silentLogger });
const BASE = DEFAULT_API_BASE_URL;
const TX_HASH = '0x46b053464f50836328b6158e1e33e5cf66c0e3ebe5004d30459b23acae5047a0';
const VAULT = '0x1D0f1D0F1d0F1d0f1D0f1d0F1D0f1D0f1D0F1d0F';
const OWNER = '0xc2F8215962fa3AB238c96B7E73a17edcE0Cacd31';
const SONIC = 'sonic';

/** The intent as `createVaultIntent` returns it: the wire shape PLUS the SDK-only `feeAmount`. */
const sampleIntent = {
  intentId: 1n,
  creator: OWNER,
  inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  outputToken: VAULT,
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 0n,
  allowPartialFill: false,
  srcChain: 4n,
  dstChain: 146n,
  srcAddress: OWNER,
  dstAddress: OWNER,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
  feeAmount: 1_000n,
} satisfies IntentRequestV2 & { feeAmount: bigint };

const sampleDepositParams: CreateDepositIntentParamsV2 = {
  vault: VAULT,
  srcChainKey: SONIC,
  srcAddress: OWNER,
  inputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  inputAmount: '1000000',
  minOutputAmount: '900000',
};

const sampleWithdrawParams: CreateWithdrawIntentParamsV2 = {
  vault: VAULT,
  srcChainKey: SONIC,
  srcAddress: OWNER,
  dstChainKey: '0xa4b1.arbitrum',
  outputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  inputAmount: '1000000000000000000',
  minOutputAmount: '900000',
};

const sampleSubmitTxRequest: LeverageYieldSubmitTxRequestV2 = {
  txHash: TX_HASH,
  srcChainKey: SONIC,
  walletAddress: OWNER,
  intent: sampleIntent,
  relayData: '0xpayload',
  operation: 'deposit',
};

// Valid response bodies (each matches its valibot schema).
const vaultDescriptor = {
  name: 'lsodaWEETH',
  vault: VAULT,
  asset: '0xasset',
  borrowToken: '0xborrow',
  lsdSource: { poolId: 'pool-1', fallbackAprPct: 3.2, label: 'weETH' },
};
const rawTx = { from: '0x1', to: '0x2', value: '0', data: '0x' };
const intentResponse = {
  intentId: '1',
  creator: OWNER,
  inputToken: '0xin',
  outputToken: '0xout',
  inputAmount: '1000000',
  minOutputAmount: '900000',
  deadline: '0',
  allowPartialFill: false,
  srcChain: '4',
  dstChain: '146',
  srcAddress: OWNER,
  dstAddress: OWNER,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};
const relayDataResponse = { address: '0xaddr', payload: '0xpayload' };
const createIntentResponse = { tx: rawTx, intent: intentResponse, relayData: relayDataResponse };
const quoteResponse = { quotedAmount: '990000' };
const submitTxStatusResponse = {
  success: true,
  data: {
    txHash: TX_HASH,
    srcChainKey: SONIC,
    status: 'solved',
    processingAttempts: 1,
    result: { dstIntentTxHash: '0xdst', intent_hash: '0xhash' },
  },
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

/** The JSON body of the last request, parsed. */
const sentBody = (): Record<string, unknown> => JSON.parse(String(mockFetch.mock.calls.at(-1)?.[1]?.body));

beforeEach(() => mockFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

// =========================================================================
// URL + HTTP method coverage for every endpoint. Asserts the exact path
// and verb so a refactor that flips a route string surfaces immediately.
// =========================================================================

describe('LeverageYieldApiService endpoint routing', () => {
  type Case = { name: string; invoke: () => Promise<{ ok: boolean }>; method: 'GET' | 'POST'; url: string };
  const api = sodax.api.leverageYield;
  const cases: Case[] = [
    { name: 'getVaults', invoke: () => api.getVaults(), method: 'GET', url: `${BASE}/leverage-yield/vaults` },
    {
      name: 'getVault',
      invoke: () => api.getVault('lsodaWEETH'),
      method: 'GET',
      url: `${BASE}/leverage-yield/vaults/lsodaWEETH`,
    },
    {
      name: 'getAsset',
      invoke: () => api.getAsset({ vault: VAULT }),
      method: 'GET',
      url: `${BASE}/leverage-yield/asset?vault=${VAULT}`,
    },
    {
      name: 'getPosition',
      invoke: () => api.getPosition({ vault: VAULT }),
      method: 'GET',
      url: `${BASE}/leverage-yield/position?vault=${VAULT}`,
    },
    {
      name: 'getApr',
      invoke: () => api.getApr({ vault: VAULT }),
      method: 'GET',
      url: `${BASE}/leverage-yield/apr?vault=${VAULT}`,
    },
    {
      name: 'getEffectiveApr',
      invoke: () => api.getEffectiveApr({ vault: VAULT }),
      method: 'GET',
      url: `${BASE}/leverage-yield/apr/effective?vault=${VAULT}`,
    },
    {
      name: 'getLsdApr',
      invoke: () => api.getLsdApr({ vault: VAULT }),
      method: 'GET',
      url: `${BASE}/leverage-yield/apr/lsd?vault=${VAULT}`,
    },
    {
      name: 'getTotalAssets',
      invoke: () => api.getTotalAssets({ vault: VAULT }),
      method: 'GET',
      url: `${BASE}/leverage-yield/total-assets?vault=${VAULT}`,
    },
    {
      name: 'previewDeposit',
      invoke: () => api.previewDeposit({ vault: VAULT, assets: '1000000' }),
      method: 'GET',
      url: `${BASE}/leverage-yield/preview/deposit?vault=${VAULT}&assets=1000000`,
    },
    {
      name: 'previewWithdraw',
      invoke: () => api.previewWithdraw({ vault: VAULT, assets: '1000000' }),
      method: 'GET',
      url: `${BASE}/leverage-yield/preview/withdraw?vault=${VAULT}&assets=1000000`,
    },
    {
      name: 'previewRedeem',
      invoke: () => api.previewRedeem({ vault: VAULT, shares: '1000000' }),
      method: 'GET',
      url: `${BASE}/leverage-yield/preview/redeem?vault=${VAULT}&shares=1000000`,
    },
    {
      name: 'getShareBalance',
      invoke: () => api.getShareBalance({ vault: VAULT, owner: OWNER }),
      method: 'GET',
      url: `${BASE}/leverage-yield/share-balance?vault=${VAULT}&owner=${OWNER}`,
    },
    {
      name: 'getMaxWithdraw',
      invoke: () => api.getMaxWithdraw({ vault: VAULT, owner: OWNER }),
      method: 'GET',
      url: `${BASE}/leverage-yield/max-withdraw?vault=${VAULT}&owner=${OWNER}`,
    },
    {
      name: 'getDepositQuote',
      invoke: () =>
        api.getDepositQuote({
          vault: VAULT,
          tokenSrc: '0xin',
          tokenSrcChainKey: SONIC,
          amount: '1000000',
          quoteType: 'exact_input',
        }),
      method: 'POST',
      url: `${BASE}/leverage-yield/quote/deposit`,
    },
    {
      name: 'getWithdrawQuote',
      invoke: () =>
        api.getWithdrawQuote({
          vault: VAULT,
          srcChainKey: SONIC,
          tokenDst: '0xout',
          tokenDstChainKey: '0xa4b1.arbitrum',
          amount: '1000000000000000000',
          quoteType: 'exact_input',
        }),
      method: 'POST',
      url: `${BASE}/leverage-yield/quote/withdraw`,
    },
    {
      name: 'getDeadline',
      invoke: () => api.getDeadline({ offsetSeconds: 600 }),
      method: 'GET',
      url: `${BASE}/leverage-yield/deadline?offsetSeconds=600`,
    },
    {
      name: 'getDeadline (no query)',
      invoke: () => api.getDeadline(),
      method: 'GET',
      url: `${BASE}/leverage-yield/deadline`,
    },
    {
      name: 'checkAllowance',
      invoke: () => api.checkAllowance(sampleDepositParams),
      method: 'POST',
      url: `${BASE}/leverage-yield/allowance/check`,
    },
    {
      name: 'approve',
      invoke: () => api.approve(sampleDepositParams),
      method: 'POST',
      url: `${BASE}/leverage-yield/approve`,
    },
    {
      name: 'createDepositIntent',
      invoke: () => api.createDepositIntent(sampleDepositParams),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/deposit`,
    },
    {
      name: 'createWithdrawIntent',
      invoke: () => api.createWithdrawIntent(sampleWithdrawParams),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/withdraw`,
    },
    {
      name: 'submitIntent',
      invoke: () => api.submitIntent({ chainId: '146', txHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/submit`,
    },
    {
      name: 'getStatus',
      invoke: () => api.getStatus({ intentTxHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/status`,
    },
    {
      name: 'cancelIntent',
      invoke: () => api.cancelIntent({ srcChainKey: SONIC, intent: sampleIntent }),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/cancel`,
    },
    {
      name: 'getIntentHash',
      invoke: () => api.getIntentHash({ intent: sampleIntent }),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/hash`,
    },
    {
      name: 'getSolvedIntentPacket',
      invoke: () => api.getSolvedIntentPacket({ chainId: '146', fillTxHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/packet`,
    },
    {
      name: 'getIntentSubmitTxExtraData',
      invoke: () => api.getIntentSubmitTxExtraData({ txHash: TX_HASH }),
      method: 'POST',
      url: `${BASE}/leverage-yield/intents/extra-data`,
    },
    {
      name: 'getFilledIntent',
      invoke: () => api.getFilledIntent(TX_HASH),
      method: 'GET',
      url: `${BASE}/leverage-yield/intents/${TX_HASH}/fill`,
    },
    {
      name: 'getIntent',
      invoke: () => api.getIntent(TX_HASH),
      method: 'GET',
      url: `${BASE}/leverage-yield/intents/${TX_HASH}`,
    },
    {
      name: 'estimateGas',
      invoke: () => api.estimateGas({ chainKey: SONIC, tx: { from: '0x1', to: '0x2', data: '0x' } }),
      method: 'POST',
      url: `${BASE}/leverage-yield/gas/estimate`,
    },
    {
      name: 'getPartnerFee',
      invoke: () => api.getPartnerFee({ amount: '1000000' }),
      method: 'GET',
      url: `${BASE}/leverage-yield/fees/partner?amount=1000000`,
    },
    {
      name: 'getSolverFee',
      invoke: () => api.getSolverFee({ amount: '1000000' }),
      method: 'GET',
      url: `${BASE}/leverage-yield/fees/solver?amount=1000000`,
    },
    {
      name: 'submitTx',
      invoke: () => api.submitTx(sampleSubmitTxRequest),
      method: 'POST',
      url: `${BASE}/leverage-yield/submit-tx`,
    },
    {
      name: 'getSubmitTxStatus',
      invoke: () => api.getSubmitTxStatus({ txHash: TX_HASH, srcChainKey: SONIC }),
      method: 'GET',
      url: `${BASE}/leverage-yield/submit-tx/status?txHash=${TX_HASH}&srcChainKey=${SONIC}`,
    },
  ];

  it.each(cases)('$name hits $method $url', async ({ invoke, method, url }) => {
    // The body is deliberately `{}` — response validation may reject it, but the request that
    // already went out is this block's whole subject.
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await invoke();
    expect(mockFetch).toHaveBeenCalledWith(decodeURIComponent(url), expect.objectContaining({ method }));
  });

  it('covers every method of the client', () => {
    // A method added to the service without a routing row above would otherwise ship unpinned.
    const declared = Object.getOwnPropertyNames(LeverageYieldApiService.prototype).filter(
      name => !['constructor', 'request', 'withQuery', 'setHeaders', 'getBaseURL', 'getTimeout'].includes(name),
    );
    const covered = new Set(cases.map(c => c.name.replace(/ \(.*\)$/, '')));
    expect([...declared].filter(name => !covered.has(name))).toEqual([]);
  });
});

// =========================================================================
// Happy paths — validated responses unwrapped into Result values.
// =========================================================================

describe('LeverageYieldApiService happy paths (validated responses)', () => {
  it('getVaults returns ok:true with the vault descriptors', async () => {
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));
    const result = await sodax.api.leverageYield.getVaults();
    expect(result).toEqual({ ok: true, value: [vaultDescriptor] });
  });

  it('getVaults accepts a descriptor with no lsdSource (the field is optional)', async () => {
    const { lsdSource: _lsdSource, ...noLsd } = vaultDescriptor;
    mockFetch.mockResolvedValueOnce(okResponse([noLsd]));
    const result = await sodax.api.leverageYield.getVaults();
    expect(result).toEqual({ ok: true, value: [noLsd] });
  });

  it('getEffectiveApr returns the combined AAVE + LSD rates', async () => {
    const apr = {
      supplyAprRay: '1',
      borrowAprRay: '2',
      targetLtvBps: '8000',
      leverageMultiplierWad: '5',
      netAprRay: '3',
      lsdApr: { aprRay: '4', label: 'weETH', stale: false },
      effectiveSupplyAprRay: '5',
      effectiveNetAprRay: '6',
    };
    mockFetch.mockResolvedValueOnce(okResponse(apr));
    expect(await sodax.api.leverageYield.getEffectiveApr({ vault: VAULT })).toEqual({ ok: true, value: apr });
  });

  it('getPosition returns the leveraged-position snapshot as decimal strings', async () => {
    const position = { collateral: '10', debt: '4', ltv: '4000', healthFactor: '2', idleAsset: '0' };
    mockFetch.mockResolvedValueOnce(okResponse(position));
    expect(await sodax.api.leverageYield.getPosition({ vault: VAULT })).toEqual({ ok: true, value: position });
  });

  it('createDepositIntent returns { tx, intent, relayData } with tx.value transformed to bigint', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(createIntentResponse));
    const result = await sodax.api.leverageYield.createDepositIntent(sampleDepositParams);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tx).toEqual({ from: '0x1', to: '0x2', value: 0n, data: '0x' });
      expect(result.value.intent).toEqual(intentResponse);
      expect(result.value.relayData).toEqual(relayDataResponse);
    }
  });

  it('getDepositQuote returns the quoted lsoda* shares', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(quoteResponse));
    const result = await sodax.api.leverageYield.getDepositQuote({
      vault: VAULT,
      tokenSrc: '0xin',
      tokenSrcChainKey: SONIC,
      amount: '1000000',
      quoteType: 'exact_input',
    });
    expect(result).toEqual({ ok: true, value: quoteResponse });
  });

  it('getDepositQuote asks for txData only when the query says so', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(quoteResponse));
    await sodax.api.leverageYield.getDepositQuote(
      { vault: VAULT, tokenSrc: '0xin', tokenSrcChainKey: SONIC, amount: '1', quoteType: 'exact_input' },
      { includeTxData: true },
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/leverage-yield/quote/deposit?includeTxData=true`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('submitTx returns the insertion status', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ success: true, data: { status: 'inserted', message: 'accepted' } }));
    const result = await sodax.api.leverageYield.submitTx(sampleSubmitTxRequest);
    expect(result).toEqual({ ok: true, value: { success: true, data: { status: 'inserted', message: 'accepted' } } });
  });

  it('getSubmitTxStatus unwraps the { success, data } envelope on the solved terminal status', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(submitTxStatusResponse));
    const result = await sodax.api.leverageYield.getSubmitTxStatus({ txHash: TX_HASH, srcChainKey: SONIC });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.data.status).toBe('solved');
      expect(result.value.data.result?.intent_hash).toBe('0xhash');
    }
  });
});

// =========================================================================
// Wire bodies — bigint serialization and the SDK-only `feeAmount` strip.
// =========================================================================

describe('LeverageYieldApiService intent wire bodies', () => {
  const intentBearing: Array<[name: string, invoke: () => Promise<unknown>]> = [
    ['submitTx', () => sodax.api.leverageYield.submitTx(sampleSubmitTxRequest)],
    ['cancelIntent', () => sodax.api.leverageYield.cancelIntent({ srcChainKey: SONIC, intent: sampleIntent })],
    ['getIntentHash', () => sodax.api.leverageYield.getIntentHash({ intent: sampleIntent })],
    ['getIntentSubmitTxExtraData', () => sodax.api.leverageYield.getIntentSubmitTxExtraData({ intent: sampleIntent })],
  ];

  it.each(intentBearing)('%s drops the SDK-only feeAmount from the intent', async (_name, invoke) => {
    // `createVaultIntent` returns `Intent & FeeAmount`, which is structurally assignable to the wire
    // `IntentRequestV2`; the lenient JSON serializer would otherwise send the extra bigint wholesale.
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await invoke();
    const intent = sentBody().intent as Record<string, unknown>;
    expect(intent).not.toHaveProperty('feeAmount');
    // The rest of the struct still travels, with bigints as decimal strings.
    expect(intent.intentId).toBe('1');
    expect(intent.inputAmount).toBe('1000000');
  });

  it('getIntentSubmitTxExtraData leaves a txHash-only body alone', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(relayDataResponse));
    await sodax.api.leverageYield.getIntentSubmitTxExtraData({ txHash: TX_HASH });
    expect(sentBody()).toEqual({ txHash: TX_HASH });
  });

  it('submitTx sends the operation discriminator the backend requires', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}));
    await sodax.api.leverageYield.submitTx({ ...sampleSubmitTxRequest, operation: 'withdraw' });
    expect(sentBody().operation).toBe('withdraw');
  });
});

// =========================================================================
// Response validation — a 2xx body off the v2 contract is rejected.
// =========================================================================

describe('LeverageYieldApiService response validation', () => {
  it('rejects getVaults when a descriptor is missing required fields', async () => {
    mockFetch.mockResolvedValueOnce(okResponse([{ name: 'lsodaWEETH' }]));
    const result = await sodax.api.leverageYield.getVaults();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.context?.reason).toBe('invalid_response_shape');
      expect(err.context?.api).toBe('leverageYield');
      expect(err.context?.endpoint).toBe('/leverage-yield/vaults');
    }
  });

  it('rejects getPosition when a numeric field arrives as a number instead of a decimal string', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ collateral: 10, debt: '4', ltv: '4000', healthFactor: '2', idleAsset: '0' }),
    );
    expect((await sodax.api.leverageYield.getPosition({ vault: VAULT })).ok).toBe(false);
  });

  it('rejects getSubmitTxStatus when the data envelope is missing', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ success: true }));
    expect((await sodax.api.leverageYield.getSubmitTxStatus({ txHash: TX_HASH, srcChainKey: SONIC })).ok).toBe(false);
  });
});

// =========================================================================
// Error propagation — transport failures become EXTERNAL_API_ERROR, and an
// auth rejection lifts its status so the poll loop and hooks can stop early.
// =========================================================================

describe('LeverageYieldApiService error propagation', () => {
  it('wraps a non-2xx response as EXTERNAL_API_ERROR (cause carries HTTP_REQUEST_FAILED)', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(502, 'Bad Gateway'));
    const result = await sodax.api.leverageYield.getVaults();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.code).toBe('EXTERNAL_API_ERROR');
      expect(err.feature).toBe('backend');
      expect(err.message).toBe('HTTP_REQUEST_FAILED');
    }
  });

  it('wraps a timeout abort as EXTERNAL_API_ERROR (message REQUEST_TIMEOUT)', async () => {
    mockFetch.mockImplementationOnce(abortFetchImpl);
    const result = await sodax.api.leverageYield.getVaults({ timeout: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as SodaxError).message).toBe('REQUEST_TIMEOUT');
  });

  it('wraps a raw network error as EXTERNAL_API_ERROR with the original error as cause', async () => {
    const networkError = new Error('Network down');
    mockFetch.mockRejectedValueOnce(networkError);
    const result = await sodax.api.leverageYield.getVaults();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.error as SodaxError;
      expect(err.cause).toBe(networkError);
      expect(err.message).toBe('Network down');
    }
  });

  it.each([401, 403])('lifts a %d onto error.context so isAuthFailure recognizes it', async status => {
    // Without the lifted status a rejected key is indistinguishable from a transient failure, and a
    // keyed leverage-yield submit-tx burns its whole attempt budget re-sending it.
    mockFetch.mockResolvedValueOnce(httpErrorResponse(status, 'Unauthorized'));
    const result = await sodax.api.leverageYield.getVaults();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isSodaxError(result.error) && result.error.context?.status).toBe(status);
      expect(isAuthFailure(result.error)).toBe(true);
    }
  });
});

// =========================================================================
// RequestOverrideConfig — baseURL / headers overrides.
// =========================================================================

describe('LeverageYieldApiService RequestOverrideConfig', () => {
  it('overrides baseURL on a GET method', async () => {
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));
    await sodax.api.leverageYield.getVaults({ baseURL: 'https://custom.example.com' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.example.com/leverage-yield/vaults',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('overrides baseURL on a POST method', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(createIntentResponse));
    await sodax.api.leverageYield.createDepositIntent(sampleDepositParams, { baseURL: 'https://custom.example.com' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.example.com/leverage-yield/intents/deposit',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('trims a legacy /be suffix off a per-call override, like its swaps and bridge siblings', async () => {
    // A per-call override is the gateway ROOT. Untrimmed it would nest the routes under the data
    // API's mount — `/be/leverage-yield/vaults`, which the gateway does not route.
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));
    await sodax.api.leverageYield.getVaults({ baseURL: `${BASE}/be` });
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/leverage-yield/vaults`, expect.anything());
  });

  it('leaves the override exactly as given when an explicit basePath opts the config out', async () => {
    // The config-level trim stands down for an explicit `basePath`; the per-call path must agree, or
    // a `/be` that is a real path segment for this deployment gets eaten out of the override.
    const gw = new Sodax({
      api: { baseApiConfig: { baseURL: 'https://gw.example/be', basePath: '' } },
      logger: silentLogger,
    });
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));
    await gw.api.leverageYield.getVaults({ baseURL: 'https://gw2.example/be' });
    expect(mockFetch).toHaveBeenCalledWith('https://gw2.example/be/leverage-yield/vaults', expect.anything());
  });

  it('merges custom headers with the defaults (both present)', async () => {
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));
    await sodax.api.leverageYield.getVaults({ headers: { 'X-Custom': 'test-value' } });
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
// Utility methods — setHeaders / getBaseURL / getTimeout (isolated instances
// to avoid leaking header mutations across the shared `sodax.api.leverageYield`).
// =========================================================================

describe('LeverageYieldApiService utilities', () => {
  it('getBaseURL returns the configured gateway root', () => {
    expect(sodax.api.leverageYield.getBaseURL()).toBe(BASE);
  });

  it('getTimeout returns the configured per-request timeout — the ceiling runBackendSubmitTx clamps to', () => {
    const service = new LeverageYieldApiService({ baseURL: BASE, timeout: 12_345, headers: {} });
    expect(service.getTimeout()).toBe(12_345);
  });

  it('setHeaders persists and merges headers into subsequent requests', async () => {
    const service = new LeverageYieldApiService({
      baseURL: BASE,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    service.setHeaders({ 'X-API-Key': 'api-key-123' });
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));

    await service.getVaults();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'api-key-123' }) }),
    );
  });

  it('a repeated mixed-casing update sends the newest value, not a stale case variant', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older casing last and let it win the merge.
    const service = new LeverageYieldApiService({ baseURL: BASE, timeout: 30_000, headers: {} });
    service.setHeaders({ 'x-api-key': 'v1' });
    service.setHeaders({ 'X-Api-Key': 'v2' });
    service.setHeaders({ 'x-api-key': 'v3' });
    mockFetch.mockResolvedValueOnce(okResponse([vaultDescriptor]));

    await service.getVaults();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('v3');
  });
});
