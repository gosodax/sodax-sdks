/**
 * Tests for the LeverageYieldApiService HTTP client (backend Leverage Yield API).
 *
 * Mirrors SwapsApiService.test.ts / BridgeApiService.test.ts:
 *   1. A single module-scope `new Sodax()` backs every test — `sodax.api.leverageYield` is the
 *      service under test. `stubFetch()` intercepts every outbound call.
 *   2. URL construction, HTTP method, default vs override headers, query-string params,
 *      request-body serialization, and valibot response validation are asserted explicitly.
 *   3. Every method returns `Result<T>` — happy paths assert `{ ok: true, value }`,
 *      failures assert `{ ok: false }` with the expected error.
 *
 * Leverage-yield-specific deltas covered: the vault registry / vault-read routes, the separate
 * deposit and withdraw quote + create-intent routes, and the `feeAmount` strip that keeps the
 * SDK-only display field off the wire on every intent-bearing call.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  type CreateDepositIntentParamsV2,
  type CreateWithdrawIntentParamsV2,
  type IntentRequestV2,
  type LeverageYieldSubmitTxRequestV2,
} from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { LeverageYieldApiService } from './LeverageYieldApiService.js';
import { isAuthFailure } from '../errors/guards.js';
import { silentLogger } from '../shared/logger.js';
import { httpErrorResponse, okResponse, stubFetch } from '../test-utils/fetch.js';
import { expectErr, expectOk } from '../test-utils/result.js';

const mockFetch = stubFetch();

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

// --- helpers --------------------------------------------------------------
/** The JSON body of the last request, parsed. */
const sentBody = (): Record<string, unknown> => JSON.parse(String(mockFetch.mock.calls.at(-1)?.[1]?.body));

beforeEach(() => mockFetch.mockReset());

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

  it('sends every endpoint to its documented method and URL', async () => {
    // The body is deliberately `{}` — response validation may reject it, but the request that
    // already went out is this block's whole subject. Mismatches are collected so a failure names them.
    const misrouted: string[] = [];
    for (const { name, invoke, method, url } of cases) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(okResponse({}));
      await invoke();
      const [calledUrl, init] = mockFetch.mock.calls[0] ?? [];
      if (calledUrl !== decodeURIComponent(url) || init?.method !== method) {
        misrouted.push(`${name}: expected ${method} ${url}, got ${init?.method} ${calledUrl}`);
      }
    }
    expect(misrouted).toEqual([]);
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
  it('createDepositIntent returns { tx, intent, relayData } with tx.value transformed to bigint', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(createIntentResponse));
    const value = expectOk(await sodax.api.leverageYield.createDepositIntent(sampleDepositParams));
    expect(value.tx).toEqual({ from: '0x1', to: '0x2', value: 0n, data: '0x' });
    expect(value.intent).toEqual(intentResponse);
    expect(value.relayData).toEqual(relayDataResponse);
  });

  it('getDepositQuote returns the quoted lsoda* shares, asking for txData only when the query says so', async () => {
    const quote = {
      vault: VAULT,
      tokenSrc: '0xin',
      tokenSrcChainKey: SONIC,
      amount: '1000000',
      quoteType: 'exact_input',
    } as const;
    mockFetch.mockResolvedValueOnce(okResponse(quoteResponse)).mockResolvedValueOnce(okResponse(quoteResponse));

    expect(await sodax.api.leverageYield.getDepositQuote(quote)).toEqual({ ok: true, value: quoteResponse });
    expect(mockFetch).toHaveBeenLastCalledWith(`${BASE}/leverage-yield/quote/deposit`, expect.anything());
    await sodax.api.leverageYield.getDepositQuote(quote, { includeTxData: true });
    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE}/leverage-yield/quote/deposit?includeTxData=true`,
      expect.objectContaining({ method: 'POST' }),
    );
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

  it('every intent-bearing call drops the SDK-only feeAmount from the intent', async () => {
    // `createVaultIntent` returns `Intent & FeeAmount`, which is structurally assignable to the wire
    // `IntentRequestV2`; the lenient JSON serializer would otherwise send the extra bigint wholesale.
    for (const [name, invoke] of intentBearing) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(okResponse({}));
      await invoke();
      expect(mockFetch, name).toHaveBeenCalledTimes(1);
      const intent = sentBody().intent as Record<string, unknown>;
      expect(intent, name).not.toHaveProperty('feeAmount');
      // The rest of the struct still travels, with bigints as decimal strings.
      expect(intent.intentId, name).toBe('1');
      expect(intent.inputAmount, name).toBe('1000000');
    }
  });

  it('getIntentSubmitTxExtraData leaves a txHash-only body alone', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(relayDataResponse));
    await sodax.api.leverageYield.getIntentSubmitTxExtraData({ txHash: TX_HASH });
    expect(sentBody()).toEqual({ txHash: TX_HASH });
  });
});

// =========================================================================
// Response validation — a 2xx body off the v2 contract is rejected.
// =========================================================================

describe('LeverageYieldApiService response validation', () => {
  it('rejects a descriptor missing required fields, a numeric field sent as a number, and a status with no data envelope', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([{ name: 'lsodaWEETH' }]))
      .mockResolvedValueOnce(okResponse({ collateral: 10, debt: '4', ltv: '4000', healthFactor: '2', idleAsset: '0' }))
      .mockResolvedValueOnce(okResponse({ success: true }));

    expectErr(
      await sodax.api.leverageYield.getVaults(),
      'EXTERNAL_API_ERROR',
      { reason: 'invalid_response_shape', api: 'leverageYield', endpoint: '/leverage-yield/vaults' },
      'getVaults',
    );
    expectErr(await sodax.api.leverageYield.getPosition({ vault: VAULT }), undefined, undefined, 'getPosition');
    expectErr(
      await sodax.api.leverageYield.getSubmitTxStatus({ txHash: TX_HASH, srcChainKey: SONIC }),
      undefined,
      undefined,
      'getSubmitTxStatus',
    );
  });
});

// =========================================================================
// Error propagation — transport failures become EXTERNAL_API_ERROR, and an
// auth rejection lifts its status so the poll loop and hooks can stop early.
// =========================================================================

describe('LeverageYieldApiService error propagation', () => {
  it('wraps a non-2xx response as EXTERNAL_API_ERROR (cause carries HTTP_REQUEST_FAILED)', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(502, 'Bad Gateway'));
    const err = expectErr(await sodax.api.leverageYield.getVaults(), 'EXTERNAL_API_ERROR');
    expect(err.feature).toBe('backend');
    expect(err.message).toBe('HTTP_REQUEST_FAILED');
  });

  it('lifts a 401 or 403 onto error.context so isAuthFailure recognizes it', async () => {
    // Without the lifted status a rejected key is indistinguishable from a transient failure, and a
    // keyed leverage-yield submit-tx burns its whole attempt budget re-sending it.
    for (const status of [401, 403]) {
      mockFetch.mockResolvedValueOnce(httpErrorResponse(status, 'Unauthorized'));
      const err = expectErr(await sodax.api.leverageYield.getVaults(), undefined, { status }, `${status}`);
      expect(isAuthFailure(err)).toBe(true);
    }
  });
});

// =========================================================================
// RequestOverrideConfig — baseURL / headers overrides.
// =========================================================================

describe('LeverageYieldApiService RequestOverrideConfig', () => {
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
});

// =========================================================================
// Utility methods — setHeaders / getBaseURL / getTimeout (isolated instances
// to avoid leaking header mutations across the shared `sodax.api.leverageYield`).
// =========================================================================

describe('LeverageYieldApiService utilities', () => {
  it('setHeaders persists into later requests, a repeated mixed-casing update sending only the newest value', async () => {
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
