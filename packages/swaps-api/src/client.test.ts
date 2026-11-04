import { describe, expect, it, vi } from 'vitest';
import { HookKind } from '@sodax/types';
import { SwapsApiError } from './errors.js';
import { API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE } from './http.js';
import { SwapsApi } from './client.js';

const BASE = 'https://api.test/v1';
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const makeApi = (fetchImpl: typeof globalThis.fetch) => new SwapsApi({ baseUrl: BASE, fetch: fetchImpl });

// Fixtures.
const intent = {
  intentId: 1n,
  creator: '0xc',
  inputToken: '0xi',
  outputToken: '0xo',
  inputAmount: 1000n,
  minOutputAmount: 1n,
  deadline: 0n,
  allowPartialFill: false,
  srcChain: 146n,
  dstChain: 1n,
  srcAddress: '0xs',
  dstAddress: '0xd',
  solver: '0x0',
  data: '0x',
};
const params = {
  srcChainKey: 'sonic',
  dstChainKey: '0xa86a.avax',
  inputToken: '0xi',
  outputToken: '0xo',
  inputAmount: '1000000',
  minOutputAmount: '1',
  deadline: '0',
  allowPartialFill: false,
  srcAddress: '0xs',
  dstAddress: '0xd',
};
const quoteBody = {
  tokenSrc: '0xi',
  tokenSrcChainKey: 'sonic',
  tokenDst: '0xo',
  tokenDstChainKey: '0xa86a.avax',
  amount: '1000000',
  quoteType: 'exact_input' as const,
};

// Each endpoint → how to invoke it, and the URL + method it must hit.
const ROUTES = [
  { name: 'getTokens', run: (a: SwapsApi) => a.getTokens(), method: 'GET', path: '/swaps/tokens' },
  {
    name: 'getTokensByChain',
    run: (a: SwapsApi) => a.getTokensByChain('sonic'),
    method: 'GET',
    path: '/swaps/tokens/sonic',
  },
  { name: 'getQuote', run: (a: SwapsApi) => a.getQuote(quoteBody), method: 'POST', path: '/swaps/quote' },
  { name: 'getDeadline', run: (a: SwapsApi) => a.getDeadline(), method: 'GET', path: '/swaps/deadline' },
  {
    name: 'checkAllowance',
    run: (a: SwapsApi) => a.checkAllowance(params),
    method: 'POST',
    path: '/swaps/allowance/check',
  },
  { name: 'approve', run: (a: SwapsApi) => a.approve(params), method: 'POST', path: '/swaps/approve' },
  { name: 'createIntent', run: (a: SwapsApi) => a.createIntent(params), method: 'POST', path: '/swaps/intents' },
  {
    name: 'submitIntent',
    run: (a: SwapsApi) => a.submitIntent({ chainId: '146', txHash: '0xabc' }),
    method: 'POST',
    path: '/swaps/intents/submit',
  },
  {
    name: 'getStatus',
    run: (a: SwapsApi) => a.getStatus({ intentTxHash: '0xabc' }),
    method: 'POST',
    path: '/swaps/intents/status',
  },
  {
    name: 'cancelIntent',
    run: (a: SwapsApi) => a.cancelIntent({ srcChainKey: 'sonic', intent }),
    method: 'POST',
    path: '/swaps/intents/cancel',
  },
  {
    name: 'getIntentHash',
    run: (a: SwapsApi) => a.getIntentHash({ intent }),
    method: 'POST',
    path: '/swaps/intents/hash',
  },
  {
    name: 'getSolvedIntentPacket',
    run: (a: SwapsApi) => a.getSolvedIntentPacket({ chainId: '146', fillTxHash: '0xf' }),
    method: 'POST',
    path: '/swaps/intents/packet',
  },
  {
    name: 'getIntentSubmitTxExtraData',
    run: (a: SwapsApi) => a.getIntentSubmitTxExtraData({ intent }),
    method: 'POST',
    path: '/swaps/intents/extra-data',
  },
  {
    name: 'getFilledIntent',
    run: (a: SwapsApi) => a.getFilledIntent('0xabc'),
    method: 'GET',
    path: '/swaps/intents/0xabc/fill',
  },
  { name: 'getIntent', run: (a: SwapsApi) => a.getIntent('0xabc'), method: 'GET', path: '/swaps/intents/0xabc' },
  {
    name: 'createLimitOrderIntent',
    run: (a: SwapsApi) => a.createLimitOrderIntent(params),
    method: 'POST',
    path: '/swaps/limit-orders',
  },
  {
    name: 'estimateGas',
    run: (a: SwapsApi) => a.estimateGas({ chainKey: 'sonic', tx: {} }),
    method: 'POST',
    path: '/swaps/gas/estimate',
  },
  {
    name: 'getPartnerFee',
    run: (a: SwapsApi) => a.getPartnerFee({ amount: '1000' }),
    method: 'GET',
    path: '/swaps/fees/partner?amount=1000',
  },
  {
    name: 'getSolverFee',
    run: (a: SwapsApi) => a.getSolverFee({ amount: '1000' }),
    method: 'GET',
    path: '/swaps/fees/solver?amount=1000',
  },
  {
    name: 'submitTx',
    run: (a: SwapsApi) =>
      a.submitTx({ txHash: '0xabc', srcChainKey: 'sonic', walletAddress: '0xw', intent, relayData: '0x' }),
    method: 'POST',
    path: '/swaps/submit-tx',
  },
  {
    name: 'getSubmitTxStatus',
    run: (a: SwapsApi) => a.getSubmitTxStatus({ txHash: 'abc', srcChainKey: 'sonic' }),
    method: 'GET',
    path: '/swaps/submit-tx/status?txHash=abc&srcChainKey=sonic',
  },
];

describe('SwapsApi routing (all 21 endpoints hit the right method + URL)', () => {
  it.each(ROUTES)('$name → $method $path', async ({ run, method, path }) => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({}));
    await run(makeApi(fetchImpl)).catch(() => {}); // response may fail validation; we only assert the request
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(BASE + path);
    expect(init?.method).toBe(method);
  });
});

describe('SwapsApi request shaping', () => {
  it('sends a configured apiKey as the x-api-key header on every request', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json([]));
    const api = new SwapsApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-123' });
    await api.getTokens().catch(() => {});
    await api.getQuote(quoteBody).catch(() => {});
    for (const call of fetchImpl.mock.calls) {
      expect((call[1]?.headers as Record<string, string>)['x-api-key']).toBe('k-123');
    }
  });

  it('lets an explicit x-api-key header win over the apiKey option, in any casing', async () => {
    // HTTP header names are case-insensitive and fetch folds two casings into one comma-joined value,
    // so a case-variant header must REPLACE the expanded key rather than ride alongside it.
    for (const name of ['x-api-key', 'X-Api-Key']) {
      const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json([]));
      const api = new SwapsApi({
        baseUrl: BASE,
        fetch: fetchImpl,
        apiKey: 'k-option',
        headers: { [name]: 'k-header' },
      });
      await api.getTokens().catch(() => {});
      const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
      expect(new Headers(headers).get('x-api-key')).toBe('k-header');
    }
  });

  it('sends the configured apiKey on a genuine non-idempotent mutation (createIntent POST)', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const api = new SwapsApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-123' });
    await api.createIntent(params).catch(() => {}); // response may fail validation; we only assert the request
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/swaps/intents`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('k-123');
  });

  it('keeps the configured apiKey on every attempt across an apiguard-503 mutation retry', async () => {
    // Headers are built once above the retry loop; nothing else pins the key to the replayed attempt.
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          json(
            { statusCode: 503, message: API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE, error: 'Service Unavailable' },
            503,
          ),
        )
        .mockResolvedValueOnce(json({}));
      const api = new SwapsApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-123' });
      const pending = api.createIntent(params).catch(() => {}); // success body fails validation; requests are the subject
      await vi.advanceTimersByTimeAsync(250);
      await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      for (const call of fetchImpl.mock.calls) {
        expect(new Headers(call[1]?.headers).get('x-api-key')).toBe('k-123');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an empty apiKey as unset rather than sending a blank credential', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json([]));
    await new SwapsApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: '' }).getTokens().catch(() => {});
    expect((fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>)['x-api-key']).toBeUndefined();
  });

  it('encodeURIComponent-escapes path params', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({}));
    await makeApi(fetchImpl)
      .getIntent('0x/weird?hash')
      .catch(() => {});
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/swaps/intents/0x%2Fweird%3Fhash`);
  });

  it('serializes IntentRequestV2 bigint fields to decimal strings before sending', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ hash: '0xh' }));
    await makeApi(fetchImpl).getIntentHash({ intent });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.intent.intentId).toBe('1');
    expect(body.intent.inputAmount).toBe('1000');
    expect(body.intent.srcChain).toBe('146');
    expect(typeof body.intent.allowPartialFill).toBe('boolean');
  });

  it('omits an absent optional query and serializes a present one', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ quotedAmount: '5' }));
    await makeApi(fetchImpl).getQuote(quoteBody);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/swaps/quote`);

    const fetchImpl2 = vi.fn<typeof globalThis.fetch>(async () => json({ quotedAmount: '5' }));
    await makeApi(fetchImpl2).getQuote(quoteBody, { includeTxData: true });
    expect(fetchImpl2.mock.calls[0]?.[0]).toBe(`${BASE}/swaps/quote?includeTxData=true`);
  });

  it('omits includeTxData when explicitly false (absence is the unambiguous "off")', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ quotedAmount: '5' }));
    await makeApi(fetchImpl).getQuote(quoteBody, { includeTxData: false });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/swaps/quote`);
  });

  it('forwards an optional hook field on getQuote unmodified (client-side passthrough only)', async () => {
    // Wire-client layer counterpart of the same-named assertion in
    // packages/sdk/src/backendApi/SwapsApiService.test.ts — keep both in sync (this proves the
    // request-shaping layer puts `hook` on the wire as-is, not that any backend forwards it).
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ quotedAmount: '5' }));
    await makeApi(fetchImpl).getQuote(
      { ...quoteBody, hook: { kind: HookKind.HYPERCORE_DEPOSIT } },
      {
        includeTxData: true,
      },
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.hook).toEqual({ kind: HookKind.HYPERCORE_DEPOSIT });
  });

  it('deep-serializes bigint tx values in estimateGas instead of throwing on them', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ gas: '21000' }));
    await makeApi(fetchImpl)
      .estimateGas({ chainKey: 'sonic', tx: { from: '0xf', to: '0xt', value: 1000n, data: '0x' } })
      .catch(() => {});
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.tx.value).toBe('1000'); // bigint → decimal string on the wire, no VALIDATION_ERROR
  });
});

describe('SwapsApi response handling', () => {
  it('returns the validated, typed response', async () => {
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ deadline: '1782451893' })));
    expect((await api.getDeadline()).deadline).toBe('1782451893');
  });

  it('throws a typed SwapsApiError on a non-2xx', async () => {
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ message: 'nope' }, 400)));
    await expect(api.getDeadline()).rejects.toBeInstanceOf(SwapsApiError);
    await expect(api.getDeadline()).rejects.toMatchObject({ code: 'HTTP_ERROR', context: { status: 400 } });
  });

  it('throws VALIDATION_ERROR when the response shape is wrong', async () => {
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ deadline: 123 }))); // number, schema wants string
    await expect(api.getDeadline()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
