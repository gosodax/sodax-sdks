import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOUND_API_HOST, BOUND_COMPANION_HOSTS, type RadfiConfig } from '@sodax/types';
import { RadfiApiError, RadfiProvider } from './RadfiProvider.js';

// Regression tests for issue #233: a non-JSON (HTML) Bound Exchange response must surface as a
// typed RadfiApiError carrying the real HTTP status — NOT a raw `SyntaxError: Unexpected token '<'`.
// This guards the BE "build raw intent" path so an SDK bump can't silently regress it.

const baseConfig: RadfiConfig = {
  apiUrl: BOUND_API_HOST,
  apiKey: '',
  umsUrl: 'https://api.ums.bound.exchange/api',
  accessToken: '',
  refreshToken: '',
};

// The exact gateway body shape from the production report (nginx 403 HTML).
const HTML_403 =
  '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>';
const HTML_502 = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>502</body></html>';

/** Minimal Response stub: `parseJsonBody` reads `res.text()`, then checks `res.ok` / `res.status`. */
function makeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response;
}

const withdrawParams = {
  token: '0:0',
  amount: 1000n,
  recipient: 'bc1pcz4pyrfgv7v6tx8a404mafyvt73cnm80yuv8tqwrywxmqxpja8ys4pjyl5',
  userAddress: 'bc1qnqllgwj499u0q6pyj7syrzpapnsvpcrnkrvead',
  data: 'deadbeef',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RadfiProvider — non-JSON error bodies (issue #233)', () => {
  it('createWithdrawTransaction throws RadfiApiError (not SyntaxError) on an HTML 403', async () => {
    fetchMock.mockResolvedValue(makeResponse(403, HTML_403));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.createWithdrawTransaction(withdrawParams, 'access-token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as RadfiApiError).status).toBe(403);
    // The original opaque failure mode must be gone.
    expect((caught as Error).message).not.toContain('Unexpected token');
    expect((caught as Error).message).toContain('403');
  });

  it('requestRadfiSignature throws RadfiApiError (not SyntaxError) on an HTML 502', async () => {
    fetchMock.mockResolvedValue(makeResponse(502, HTML_502));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.requestRadfiSignature({ userAddress: withdrawParams.userAddress, signedBase64Tx: 'cHNidP8=' }, 'tok');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as RadfiApiError).status).toBe(502);
    expect((caught as Error).message).not.toContain('Unexpected token');
  });

  it('createTradingWallet (sibling method) also yields RadfiApiError on an HTML error body', async () => {
    // The issue only named two methods, but every method built a RadfiApiError from `await res.json()`
    // in its !res.ok branch — also throwing SyntaxError on an HTML error body. parseJsonBody fixes all.
    fetchMock.mockResolvedValue(makeResponse(403, HTML_403));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.createTradingWallet({ walletAddress: withdrawParams.userAddress, publicKey: '02abcdef' }, 'tok');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect((caught as RadfiApiError).status).toBe(403);
    expect((caught as Error).message).not.toContain('Unexpected token');
  });

  it('getTradingWallet surfaces the real HTTP status (403), not a generic "Trading wallet not found"', async () => {
    // The trading-wallet lookup is a public GET; an edge/WAF "403 Forbidden" HTML page used to throw a
    // generic Error('Trading wallet not found'), masking the real status. It must now be a typed
    // RadfiApiError carrying status 403 so an origin/WAF block is diagnosable.
    fetchMock.mockResolvedValue(makeResponse(403, HTML_403));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.getTradingWallet('bc1pax7wcjw4r7m25fn2405x5a5f6vucv8pcqr8ltsz2mp4xjmx26rgstqgwhz');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as RadfiApiError).status).toBe(403);
    expect((caught as Error).message).not.toContain('Unexpected token');
    expect((caught as Error).message).toContain('403');
  });
});

describe('RadfiProvider — happy path + logical-error envelopes still work', () => {
  it('getTradingWallet returns the trading wallet on a valid JSON 200', async () => {
    const wallet = { tradingAddress: 'bc1ptrade', userAddress: 'bc1puser', userPublicKey: '02abcd' };
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: wallet })));
    const radfi = new RadfiProvider(baseConfig);

    expect(await radfi.getTradingWallet('bc1puser')).toEqual(wallet);
  });

  it('createWithdrawTransaction returns data on a valid JSON 200', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'cHNidP8=', txId: 'abc' } })));
    const radfi = new RadfiProvider(baseConfig);

    const result = await radfi.createWithdrawTransaction(withdrawParams, 'access-token');
    expect(result).toEqual({ base64Psbt: 'cHNidP8=', txId: 'abc' });
  });

  it('createWithdrawTransaction throws a typed RadfiApiError on a 200 logical-error envelope (no data)', async () => {
    // Bound can answer HTTP 200 with { code, message } and no `data` (e.g. "2002" insufficientBTCBalance).
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ code: '2002', message: 'insufficientBTCBalance' })));
    const radfi = new RadfiProvider(baseConfig);

    let caught: unknown;
    try {
      await radfi.createWithdrawTransaction(withdrawParams, 'access-token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RadfiApiError);
    expect((caught as RadfiApiError).code).toBe('2002');
  });
});

describe('RadfiProvider — empty-credential guard (resolveAuth)', () => {
  it('createWithdrawTransaction throws a 401 RadfiApiError BEFORE any network call when no token/apiKey', async () => {
    const radfi = new RadfiProvider(baseConfig); // apiKey '' + token ''
    let caught: unknown;
    try {
      await radfi.createWithdrawTransaction(withdrawParams, '');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RadfiApiError);
    expect((caught as RadfiApiError).status).toBe(401);
    expect((caught as Error).message).toMatch(/required/i);
    // Pre-flight: we must NOT send an empty `Bearer ` to Bound (which 403s) — fail fast instead.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to config.apiKey when no access token is passed (does not over-block)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'x', txId: 't' } })));
    const radfi = new RadfiProvider({ ...baseConfig, apiKey: 'server-api-key' });

    const result = await radfi.createWithdrawTransaction(withdrawParams, '');
    expect(result).toEqual({ base64Psbt: 'x', txId: 't' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer server-api-key');
  });
});

describe('RadfiProvider — constructor seeds the session from config', () => {
  it('seeds accessToken/refreshToken from RadfiConfig so a server-side caller can inject a token', () => {
    const radfi = new RadfiProvider({ ...baseConfig, accessToken: 'seed-access', refreshToken: 'seed-refresh' });
    expect(radfi.accessToken).toBe('seed-access');
    expect(radfi.refreshToken).toBe('seed-refresh');
  });

  it('defaults to empty strings when config has no token', () => {
    const radfi = new RadfiProvider(baseConfig);
    expect(radfi.accessToken).toBe('');
    expect(radfi.refreshToken).toBe('');
  });
});

describe('RadfiProvider — signer hook (x-api-signature, gh-831)', () => {
  it('merges the signer headers onto an authenticated POST and keeps the user Authorization', async () => {
    const signer = vi.fn().mockReturnValue({ 'x-api-signature': 'sig_abc_1719396000000' });
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'cHNidP8=', txId: 'abc' } })));
    const radfi = new RadfiProvider(baseConfig, { signer });

    await radfi.createWithdrawTransaction(withdrawParams, 'user-access-token');

    expect(signer).toHaveBeenCalledWith({ method: 'POST', path: '/sodax/transaction', baseUrl: baseConfig.apiUrl });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-signature']).toBe('sig_abc_1719396000000');
    // the per-user token and the backend signature ride as separate headers on the same request
    expect(headers.Authorization).toBe('Bearer user-access-token');
  });

  it('also signs the unauthenticated GET /wallets/details', async () => {
    const signer = vi.fn().mockReturnValue({ 'x-api-signature': 'sig_get' });
    const wallet = { tradingAddress: 'bc1ptrade', userAddress: 'bc1puser', userPublicKey: '02ab' };
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: wallet })));
    const radfi = new RadfiProvider(baseConfig, { signer });

    await radfi.getTradingWallet('bc1puser');

    expect(signer).toHaveBeenCalledWith({
      method: 'GET',
      path: '/wallets/details/bc1puser',
      baseUrl: companion('auth'),
    });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-signature']).toBe('sig_get');
  });

  it('awaits an async signer', async () => {
    const signer = vi.fn().mockResolvedValue({ 'x-api-signature': 'sig_async' });
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'x', txId: 'y' } })));
    const radfi = new RadfiProvider(baseConfig, { signer });

    await radfi.createWithdrawTransaction(withdrawParams, 'tok');

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-signature']).toBe('sig_async');
  });

  it('sends no x-api-signature when no signer is configured (browser path unchanged)', async () => {
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'x', txId: 'y' } })));
    const radfi = new RadfiProvider(baseConfig); // no signer

    await radfi.createWithdrawTransaction(withdrawParams, 'tok');

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-signature']).toBeUndefined();
  });

  it('invokes the signer per request, never caching its result', async () => {
    // Bound's signature embeds a timestamp valid for 60s. A provider outlives that window, so the
    // hook must be re-invoked on every call — caching would start replaying an expired signature.
    let call = 0;
    const signer = vi.fn(() => ({ 'x-api-signature': `sig_${++call}` }));
    fetchMock.mockResolvedValue(
      makeResponse(200, JSON.stringify({ data: { tradingAddress: 'bc1ptrade', userAddress: 'bc1puser' } })),
    );
    const radfi = new RadfiProvider(baseConfig, { signer });

    await radfi.getTradingWallet('bc1puser');
    await radfi.getTradingWallet('bc1puser');

    expect(signer).toHaveBeenCalledTimes(2);
    const headerOf = (i: number) =>
      ((fetchMock.mock.calls[i]?.[1] as RequestInit).headers as Record<string, string>)['x-api-signature'];
    expect(headerOf(0)).toBe('sig_1');
    expect(headerOf(1)).toBe('sig_2');
  });

  it('propagates a throwing signer instead of sending the request unsigned', async () => {
    // A misconfigured backend credential must fail loudly here; silently dropping the header would
    // surface as an opaque 403 from Bound's gateway with no local trace of the cause.
    const signer = vi.fn(() => {
      throw new Error('credential unavailable');
    });
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'x', txId: 'y' } })));
    const radfi = new RadfiProvider(baseConfig, { signer });

    await expect(radfi.createWithdrawTransaction(withdrawParams, 'tok')).rejects.toThrow('credential unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets signer headers win over per-call headers — so a signer must not return Authorization', async () => {
    // Pinning the documented precedence: `request()` spreads the signer LAST. That is what lets a
    // signer set transport-level headers, but it also means a signer returning `Authorization` would
    // silently replace the per-user bearer. Callers own that constraint; this test makes it visible.
    const signer = vi.fn().mockReturnValue({ 'x-api-signature': 'sig', Authorization: 'Bearer signer-wins' });
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: { base64Psbt: 'x', txId: 'y' } })));
    const radfi = new RadfiProvider(baseConfig, { signer });

    await radfi.createWithdrawTransaction(withdrawParams, 'user-access-token');

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer signer-wins');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// Host routing (gh-425). The signer assertions above check the `path` handed to the signer, not
// the URL fetched — so before these, a total misroute kept the suite green.

const OK_BODY = JSON.stringify({
  data: {
    base64Psbt: 'cHNidP8=',
    txId: 'tx',
    accessToken: 'a',
    refreshToken: 'r',
    tradingAddress: 'bc1ptrade',
    userAddress: 'bc1puser',
    userPublicKey: '02ab',
    maxSatsAmt: 1,
    feeRate: 1,
    fee: 1,
  },
});

/** One invocation per `request()` call site — eleven of them, three families. */
const ROUTED_CALLS: {
  label: string;
  path: string;
  family: 'auth' | 'api' | 'transactions';
  run: (r: RadfiProvider) => Promise<unknown>;
}[] = [
  {
    label: '/auth/authenticate',
    path: '/auth/authenticate',
    family: 'auth',
    run: r => r.authenticate({ message: 'm', signature: 's', address: 'bc1puser', publicKey: '02ab' }),
  },
  {
    label: '/auth/refresh-token',
    path: '/auth/refresh-token',
    family: 'auth',
    run: r => r.refreshAccessToken('refresh-token'),
  },
  {
    label: '/wallets',
    path: '/wallets',
    family: 'auth',
    run: r => r.createTradingWallet({ walletAddress: 'bc1puser', publicKey: '02ab' }, 'tok'),
  },
  {
    label: '/wallets/details/bc1puser',
    path: '/wallets/details/bc1puser',
    family: 'auth',
    run: r => r.getTradingWallet('bc1puser'),
  },
  {
    label: '/sodax/transaction',
    path: '/sodax/transaction',
    family: 'api',
    run: r => r.createWithdrawTransaction(withdrawParams, 'tok'),
  },
  {
    label: '/sodax/transaction/sign',
    path: '/sodax/transaction/sign',
    family: 'api',
    run: r => r.requestRadfiSignature({ userAddress: 'bc1puser', signedBase64Tx: 'x' }, 'tok'),
  },
  {
    label: '/transactions',
    path: '/transactions',
    family: 'transactions',
    run: r => r.withdrawToUser({ userAddress: 'bc1puser', amount: '1', tokenId: '0:0', withdrawTo: 'bc1q' }, 'tok'),
  },
  {
    label: '/transactions/sign',
    path: '/transactions/sign',
    family: 'transactions',
    run: r => r.signAndBroadcastWithdraw({ userAddress: 'bc1puser', signedBase64Tx: 'x' }, 'tok'),
  },
  {
    label: '/transactions/max-spent',
    path: '/transactions/max-spent',
    family: 'transactions',
    run: r => r.getMaxWithdrawable({ userAddress: 'bc1puser', amount: '1', tokenId: '0:0', withdrawTo: 'bc1q' }, 'tok'),
  },
  // Separate call sites from withdraw despite sharing a path — either could be handed a
  // valid-but-wrong host and still compile.
  {
    label: '/transactions (renew-utxo)',
    path: '/transactions',
    family: 'transactions',
    run: r => r.buildRenewUtxoTransaction({ userAddress: 'bc1puser', txIdVouts: ['tx:0'] }, 'tok'),
  },
  {
    label: '/transactions/sign (renew-utxo)',
    path: '/transactions/sign',
    family: 'transactions',
    run: r => r.signAndBroadcastRenewUtxo({ userAddress: 'bc1puser', signedBase64Tx: 'x' }, 'tok'),
  },
];

/** The first URL each endpoint fetched. Parse failures are irrelevant — routing is the assertion. */
async function hostsUsed(config: RadfiConfig): Promise<Record<string, string>> {
  const radfi = new RadfiProvider(config);
  const used: Record<string, string> = {};
  for (const call of ROUTED_CALLS) {
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(makeResponse(200, OK_BODY));
    await call.run(radfi).catch(() => undefined);
    used[call.label] = String(fetchMock.mock.calls[0]?.[0]);
  }
  return used;
}

const companion = (family: 'auth' | 'transactions'): string => {
  const host = BOUND_COMPANION_HOSTS[BOUND_API_HOST]?.[family];
  if (!host) throw new Error(`no packaged companion for ${family}`);
  return host;
};

const expectAllOn = (used: Record<string, string>, host: string): void => {
  for (const call of ROUTED_CALLS) {
    expect(`${call.label} -> ${used[call.label]}`).toBe(`${call.label} -> ${host}${call.path}`);
  }
};

describe('RadfiProvider — host routing (gh-425)', () => {
  it('splits the three families across the packaged hosts when apiUrl is the packaged one', async () => {
    const used = await hostsUsed({ ...baseConfig, apiUrl: BOUND_API_HOST });

    for (const call of ROUTED_CALLS) {
      const expected = call.family === 'api' ? BOUND_API_HOST : companion(call.family);
      expect(`${call.label} -> ${used[call.label]}`).toBe(`${call.label} -> ${expected}${call.path}`);
    }
  });

  // Anti-straddle: naming your own apiUrl moves EVERY family, as the single-host SDK did.
  it.each([
    ['a signet host', 'https://signet.api.bound.exchange/api'],
    ['a private proxy', 'https://bound-proxy.internal/api'],
  ])('sends every family to %s when apiUrl names it', async (_label, apiUrl) => {
    expectAllOn(await hostsUsed({ ...baseConfig, apiUrl }), apiUrl);
  });

  it('lets an explicit companion win, without disturbing the other families', async () => {
    const used = await hostsUsed({
      ...baseConfig,
      apiUrl: BOUND_API_HOST,
      transactionsUrl: 'https://staging.api.radfi.co/api',
    });

    expect(used['/transactions']).toBe('https://staging.api.radfi.co/api/transactions');
    expect(used['/wallets']).toBe(`${companion('auth')}/wallets`);
    expect(used['/sodax/transaction']).toBe(`${BOUND_API_HOST}/sodax/transaction`);
  });

  it('strips trailing slashes, and a trailing-slash apiUrl still resolves the packaged companions', async () => {
    const used = await hostsUsed({
      ...baseConfig,
      apiUrl: `${BOUND_API_HOST}/`,
      authUrl: `${companion('auth')}/`,
    });

    expect(used['/wallets']).toBe(`${companion('auth')}/wallets`);
    expect(used['/transactions']).toBe(`${companion('transactions')}/transactions`);
  });

  // UMS calls bypass request(); routing one through it would land on auth — hence no 'ums' host.
  // An env var or a form field that comes through empty must not survive `??` and turn every
  // URL relative — blank is normalised to "unset".
  it('treats a blank companion as unset rather than as a host', async () => {
    const used = await hostsUsed({ ...baseConfig, apiUrl: BOUND_API_HOST, authUrl: '', transactionsUrl: '   ' });

    expect(used['/wallets']).toBe(`${companion('auth')}/wallets`);
    expect(used['/transactions']).toBe(`${companion('transactions')}/transactions`);
  });

  it('leaves the UMS calls on umsUrl and unsigned', async () => {
    const signer = vi.fn().mockReturnValue({ 'x-api-signature': 'sig' });
    const radfi = new RadfiProvider({ ...baseConfig, apiUrl: BOUND_API_HOST }, { signer });
    fetchMock.mockResolvedValue(makeResponse(200, JSON.stringify({ data: [] })));

    await radfi.getExpiredUtxos('bc1ptrade').catch(() => undefined);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`${baseConfig.umsUrl}/utxos`);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-signature']).toBeUndefined();
    expect(signer).not.toHaveBeenCalled();
  });

  it('signs on every routed host, not just the service host', async () => {
    const signer = vi.fn().mockReturnValue({ 'x-api-signature': 'sig' });
    const radfi = new RadfiProvider({ ...baseConfig, apiUrl: BOUND_API_HOST }, { signer });
    fetchMock.mockResolvedValue(makeResponse(200, OK_BODY));

    await radfi
      .getMaxWithdrawable({ userAddress: 'bc1puser', amount: '1', tokenId: '0:0', withdrawTo: 'bc1q' }, 'tok')
      .catch(() => undefined);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${companion('transactions')}/transactions/max-spent`);
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-signature']).toBe('sig');
  });
});

describe('RadfiProvider — retired hosts are refused (gh-425)', () => {
  const RETIRED = 'https://api.bound.exchange/api';

  it.each([
    ['apiUrl', { apiUrl: RETIRED }, BOUND_API_HOST],
    ['authUrl', { apiUrl: BOUND_API_HOST, authUrl: RETIRED }, undefined],
    ['transactionsUrl', { apiUrl: BOUND_API_HOST, transactionsUrl: RETIRED }, undefined],
  ])('refuses a retired host in %s and names that field', (field, overrides, replacement) => {
    const expected = replacement ?? (field === 'authUrl' ? companion('auth') : companion('transactions'));

    expect(() => new RadfiProvider({ ...baseConfig, ...overrides })).toThrow(
      new RegExp(
        `retired ${RETIRED.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}.*radfi\\.${field}.*${expected.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}`,
      ),
    );
  });

  it('ignores a trailing slash when matching a retired host', () => {
    expect(() => new RadfiProvider({ ...baseConfig, apiUrl: `${RETIRED}/` })).toThrow(/has retired/);
  });

  it.each([
    ['the packaged host', BOUND_API_HOST],
    ['a signet host', 'https://signet.api.bound.exchange/api'],
    ['a private proxy', 'https://bound-proxy.internal/api'],
  ])('accepts %s', (_label, apiUrl) => {
    expect(() => new RadfiProvider({ ...baseConfig, apiUrl })).not.toThrow();
  });
});
