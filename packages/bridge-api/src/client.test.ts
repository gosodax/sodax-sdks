import { describe, expect, it, vi } from 'vitest';
import { BridgeApi } from './client.js';
import { BridgeApiError } from './errors.js';
import { API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE } from './http.js';

const BASE = 'https://api.test/v1';
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const makeApi = (fetchImpl: typeof globalThis.fetch) => new BridgeApi({ baseUrl: BASE, fetch: fetchImpl });

// Fixtures.
const params = {
  srcChainKey: 'sonic',
  dstChainKey: '0xa86a.avax',
  inputToken: '0xi',
  outputToken: '0xo',
  inputAmount: '1000000',
  srcAddress: '0xs',
  dstAddress: '0xd',
};
const quoteBody = {
  srcChainKey: 'sonic',
  dstChainKey: '0xa86a.avax',
  inputToken: '0xi',
  outputToken: '0xo',
};
const relayData = { address: '0xrelay', payload: '0xpayload' };

// Each endpoint → how to invoke it, the URL + method it must hit, whether it is idempotent
// (retried on transient failures) — mutations must NEVER be — and the exact JSON body it must
// send (`undefined` for bodyless GETs).
const ROUTES: Array<{
  name: string;
  run: (a: BridgeApi) => Promise<unknown>;
  method: 'GET' | 'POST';
  path: string;
  idempotent: boolean;
  body?: Record<string, unknown>;
}> = [
  {
    name: 'getTokens',
    run: (a: BridgeApi) => a.getTokens(),
    method: 'GET',
    path: '/bridge/tokens',
    idempotent: true,
  },
  {
    name: 'getTokensByChain',
    run: (a: BridgeApi) => a.getTokensByChain('sonic'),
    method: 'GET',
    path: '/bridge/tokens/sonic',
    idempotent: true,
  },
  {
    name: 'checkAllowance',
    run: (a: BridgeApi) => a.checkAllowance(params),
    method: 'POST',
    path: '/bridge/allowance/check',
    idempotent: true,
    body: params,
  },
  {
    name: 'approve',
    run: (a: BridgeApi) => a.approve(params),
    method: 'POST',
    path: '/bridge/approve',
    idempotent: false,
    body: params,
  },
  {
    name: 'createBridgeIntent',
    run: (a: BridgeApi) => a.createBridgeIntent(params),
    method: 'POST',
    path: '/bridge/intents',
    idempotent: false,
    body: params,
  },
  {
    name: 'submitTx',
    run: (a: BridgeApi) => a.submitTx({ txHash: '0xabc', srcChainKey: 'sonic', walletAddress: '0xw', relayData }),
    method: 'POST',
    path: '/bridge/submit-tx',
    idempotent: false,
    body: { txHash: '0xabc', srcChainKey: 'sonic', walletAddress: '0xw', relayData },
  },
  {
    name: 'getSubmitTxStatus',
    run: (a: BridgeApi) => a.getSubmitTxStatus({ txHash: 'abc', srcChainKey: 'sonic' }),
    method: 'GET',
    path: '/bridge/submit-tx/status?txHash=abc&srcChainKey=sonic',
    idempotent: true,
  },
  {
    name: 'getFee',
    run: (a: BridgeApi) => a.getFee({ inputAmount: '1000000' }),
    method: 'POST',
    path: '/bridge/fee',
    idempotent: true,
    body: { inputAmount: '1000000' },
  },
  {
    name: 'getBridgeableAmount',
    run: (a: BridgeApi) => a.getBridgeableAmount(quoteBody),
    method: 'POST',
    path: '/bridge/bridgeable-amount',
    idempotent: true,
    body: quoteBody,
  },
  {
    name: 'isBridgeable',
    run: (a: BridgeApi) => a.isBridgeable(quoteBody),
    method: 'POST',
    path: '/bridge/bridgeable/check',
    idempotent: true,
    body: quoteBody,
  },
];

describe('BridgeApi routing (every endpoint hits the right method + URL + body)', () => {
  it.each(ROUTES)('$name → $method $path', async ({ run, method, path, body }) => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({}));
    await run(makeApi(fetchImpl)).catch(() => {}); // response may fail validation; we only assert the request
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(BASE + path);
    expect(init?.method).toBe(method);
    // Pin the outgoing body per route — a dropped/renamed request field would otherwise ship a
    // broken request while the mocked responses keep every test green.
    if (body) expect(JSON.parse(String(init?.body))).toEqual(body);
    else expect(init?.body).toBeUndefined();
  });
});

describe('BridgeApi retry safety at the method layer (pins the whole idempotency map)', () => {
  // A persistent 503 exposes each method's idempotency flag through its attempt count:
  // idempotent → 1 + MAX_RETRIES(2) = 3 attempts; mutation → exactly 1 (a transient failure
  // must never replay approve/createBridgeIntent/submitTx — the backend could build duplicate
  // deposit/approve txs). A flag flipped either way in client.ts fails this table.
  it.each(ROUTES)('$name (idempotent: $idempotent) makes the expected attempts on a persistent 503', async route => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ message: 'unavailable' }, 503));
    await expect(route.run(makeApi(fetchImpl))).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    expect(fetchImpl).toHaveBeenCalledTimes(route.idempotent ? 3 : 1);
  });
});

describe('BridgeApi request shaping', () => {
  it('encodeURIComponent-escapes path params', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json([]));
    await makeApi(fetchImpl)
      .getTokensByChain('0x/weird?key')
      .catch(() => {});
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/bridge/tokens/0x%2Fweird%3Fkey`);
  });

  it('sends the string-typed wire body as-is (no field renames or transforms)', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({ valid: true }));
    await makeApi(fetchImpl).checkAllowance({ ...params, srcPublicKey: '02aa' });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ ...params, srcPublicKey: '02aa' });
  });

  it('submitTx carries the FULL relayData envelope (address + payload), not just the payload', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () =>
      json({ success: true, data: { status: 'inserted', message: 'ok' } }),
    );
    await makeApi(fetchImpl).submitTx({ txHash: '0xabc', srcChainKey: 'sonic', walletAddress: '0xw', relayData });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.relayData).toEqual({ address: '0xrelay', payload: '0xpayload' });
  });
});

describe('BridgeApi API key', () => {
  it('sends a configured apiKey as the x-api-key header on every request', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json([]));
    const api = new BridgeApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-123' });
    await api.getTokens().catch(() => {});
    await api.getFee({ inputAmount: '1000000' }).catch(() => {});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      expect(new Headers(call[1]?.headers).get('x-api-key')).toBe('k-123');
    }
  });

  it('lets an explicit x-api-key header win over the apiKey option, in any casing', async () => {
    // HTTP header names are case-insensitive and fetch folds two casings into one comma-joined value,
    // so a case-variant header must REPLACE the expanded key rather than ride alongside it.
    for (const name of ['x-api-key', 'X-Api-Key']) {
      const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json([]));
      await new BridgeApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-option', headers: { [name]: 'k-header' } })
        .getTokens()
        .catch(() => {});
      const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
      expect(new Headers(headers).get('x-api-key')).toBe('k-header');
    }
  });

  it('sends the configured apiKey on a genuine non-idempotent mutation (createBridgeIntent POST)', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const api = new BridgeApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-123' });
    await api.createBridgeIntent(params).catch(() => {}); // response may fail validation; the request is the subject
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/bridge/intents`);
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
      const api = new BridgeApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: 'k-123' });
      const pending = api.createBridgeIntent(params).catch(() => {}); // success body fails validation; requests are the subject
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
    await new BridgeApi({ baseUrl: BASE, fetch: fetchImpl, apiKey: '' }).getTokens().catch(() => {});
    expect((fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>)['x-api-key']).toBeUndefined();
  });
});

describe('BridgeApi response handling', () => {
  it('returns the validated, typed response', async () => {
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ fee: '42' })));
    expect((await api.getFee({ inputAmount: '1000000' })).fee).toBe('42');
  });

  it('transforms the create-intent tx to its chain variant (value string→bigint)', async () => {
    const evmTx = { from: '0xf', to: '0xt', value: '1000000000000000000', data: '0x' };
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ tx: evmTx, relayData })));
    const out = await api.createBridgeIntent(params);
    expect(out.tx).toMatchObject({ value: 1000000000000000000n });
    expect(out.relayData).toEqual(relayData);
  });

  it('transforms the approve tx to its chain variant (value string→bigint)', async () => {
    // The approve response is `{ tx }` only — no relayData, so reusing the create-intent schema here
    // would fail this test rather than production.
    const evmTx = { from: '0xf', to: '0xt', value: '5000', data: '0x' };
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ tx: evmTx })));
    const out = await api.approve(params);
    expect(out.tx).toMatchObject({ value: 5000n });
  });

  it('picks the raw-tx schema by SOURCE chain key (near → NEAR transform), not the destination', async () => {
    const nearTx = {
      signerId: 'alice.near',
      params: { contractId: 'intents.near', method: 'ft_transfer_call', args: {}, gas: '30000000000000', deposit: '1' },
    };
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ tx: nearTx, relayData })));
    // srcChainKey 'near' (NEAR family) with an EVM destination: the NEAR schema must apply.
    // Selecting by dstChainKey — or hardcoding the EVM schema — would reject this tx outright.
    const out = await api.createBridgeIntent({ ...params, srcChainKey: 'near', dstChainKey: '0xa86a.avax' });
    expect(out.tx).toMatchObject({ signerId: 'alice.near', params: { gas: 30000000000000n, deposit: 1n } });
  });

  it('throws a typed BridgeApiError on a non-2xx', async () => {
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ message: 'nope' }, 400)));
    await expect(api.getFee({ inputAmount: '1' })).rejects.toBeInstanceOf(BridgeApiError);
    await expect(api.getFee({ inputAmount: '1' })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      context: { status: 400 },
    });
  });

  it('throws VALIDATION_ERROR when the response shape is wrong', async () => {
    const api = makeApi(vi.fn<typeof globalThis.fetch>(async () => json({ fee: 123 }))); // number, schema wants string
    await expect(api.getFee({ inputAmount: '1' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
