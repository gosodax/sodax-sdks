import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XToken } from '@sodax/types';
import { XrpXService } from './XrpXService.js';

const NATIVE_XRP = '0x0000000000000000000000000000000000000000';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const USER = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';

const token = (over: Partial<XToken>): XToken =>
  ({
    symbol: 'XRP',
    address: NATIVE_XRP,
    decimals: 6,
    chainKey: 'xrp',
    name: 'XRP',
    ...over,
    // A spread `Partial<XToken>` widens the literal fields, so the fixture is asserted back to `XToken`.
  }) as unknown as XToken;

const XRP_TOKEN = token({});
const RLUSD_TOKEN = token({ symbol: 'RLUSD', address: RLUSD_ISSUER, name: 'Ripple USD' });

/** The 160-bit currency form for RLUSD, which is how rippled reports a symbol longer than 3 chars. */
const RLUSD_CURRENCY = '524C555344000000000000000000000000000000';

type Call = { url: string; method: string; params: Record<string, unknown> };

let calls: Call[];

function stubRippled(responses: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as { method: string; params: [Record<string, unknown>] };
      calls.push({ url, method, params: params[0] });
      // Only `json()` is read, so a partial stands in for the full fetch Response.
      return { json: async () => ({ result: responses[method] }) } as unknown as Response;
    }),
  );
}

// The XService singleton is module-level state — reset it between tests so the `getInstance()`
// identity / rpcUrl-update behaviour is not polluted by earlier runs.
function resetSingleton() {
  (XrpXService as unknown as { instance?: unknown }).instance = undefined;
}

beforeEach(() => {
  calls = [];
  resetSingleton();
});

afterEach(() => {
  resetSingleton();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Serves one RLUSD trustline holding `balance` and returns what the service reads from it. */
async function rlusdBalance(balance: string): Promise<bigint> {
  stubRippled({ account_lines: { lines: [{ currency: RLUSD_CURRENCY, account: RLUSD_ISSUER, balance }] } });
  return XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN);
}

describe('XrpXService.getInstance', () => {
  it('shares one instance whose rpcUrl defaults to the public cluster and follows a later config', () => {
    const first = XrpXService.getInstance();
    expect(first.rpcUrl).toBe('https://xrplcluster.com');
    expect(first.xChainType).toBe('XRP');

    const second = XrpXService.getInstance({ rpcUrl: 'https://second.example' });
    expect(second).toBe(first);
    expect(second.rpcUrl).toBe('https://second.example');

    expect(XrpXService.getInstance().rpcUrl).toBe('https://second.example');
  });
});

describe('XrpXService.getBalance — native XRP', () => {
  it('reads drops from account_info at the configured endpoint against the validated ledger', async () => {
    stubRippled({ account_info: { account_data: { Balance: '42000000' } } });

    const balance = await XrpXService.getInstance({ rpcUrl: 'https://custom.example/rpc' }).getBalance(USER, XRP_TOKEN);

    expect(calls[0]).toMatchObject({
      url: 'https://custom.example/rpc',
      method: 'account_info',
      params: { account: USER, ledger_index: 'validated' },
    });
    expect(balance).toBe(42_000_000n);
  });

  it('recognises the native sentinel even under a different symbol', async () => {
    stubRippled({ account_info: { account_data: { Balance: '7' } } });

    const balance = await XrpXService.getInstance().getBalance(USER, token({ symbol: 'WXRP' }));

    expect(calls[0]?.method).toBe('account_info');
    expect(balance).toBe(7n);
  });

  it('reports zero for an unfunded account or a node answer without a result', async () => {
    stubRippled({ account_info: {} });
    expect(await XrpXService.getInstance().getBalance(USER, XRP_TOKEN)).toBe(0n);

    stubRippled({});
    expect(await XrpXService.getInstance().getBalance(USER, XRP_TOKEN)).toBe(0n);
  });
});

describe('XrpXService.getBalance — IOU', () => {
  it('reads the trustline to the issuer and converts its decimal balance to base units exactly', async () => {
    // RLUSD has 6 decimals.
    expect(await rlusdBalance('1.5')).toBe(1_500_000n);
    expect(calls[0]).toMatchObject({ method: 'account_lines', params: { peer: RLUSD_ISSUER } });
    expect(await rlusdBalance('0.25')).toBe(250_000n);
    expect(await rlusdBalance('3')).toBe(3_000_000n);
    expect(await rlusdBalance('1.1234567')).toBe(1_123_456n);
    expect(await rlusdBalance('1000000000000000e-4')).toBe(100_000_000_000_000_000n);
  });

  it('credits only a line matching both the currency and the issuer', async () => {
    stubRippled({ account_lines: { lines: [] } });
    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(0n);

    stubRippled({
      account_lines: {
        lines: [{ currency: RLUSD_CURRENCY, account: 'rImPoStErIsSuEr00000000000000000000', balance: '99' }],
      },
    });
    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(0n);
  });

  it('derives the currency from the symbol: 3 chars as ASCII, longer as the 160-bit form without a global Buffer', async () => {
    stubRippled({ account_lines: { lines: [{ currency: 'EUR', account: RLUSD_ISSUER, balance: '2' }] } });
    expect(await XrpXService.getInstance().getBalance(USER, token({ symbol: 'EUR', address: RLUSD_ISSUER }))).toBe(
      2_000_000n,
    );

    vi.stubGlobal('Buffer', undefined);
    stubRippled({
      account_lines: {
        lines: [{ currency: '5553444300000000000000000000000000000000', account: RLUSD_ISSUER, balance: '2' }],
      },
    });
    expect(await XrpXService.getInstance().getBalance(USER, token({ symbol: 'USDC', address: RLUSD_ISSUER }))).toBe(
      2_000_000n,
    );
  });

  it('finds an issuer trustline on page two', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const { params } = JSON.parse(String(init.body)) as { params: [{ peer?: string; marker?: string }] };
        expect(params[0].peer).toBe(RLUSD_ISSUER);
        return new Response(
          JSON.stringify({
            result:
              params[0].marker === 'next'
                ? { lines: [{ currency: RLUSD_CURRENCY, account: RLUSD_ISSUER, balance: '2' }] }
                : { lines: [], marker: 'next' },
          }),
        );
      }),
    );
    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(2_000_000n);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('XrpXService.getBalance — failure handling', () => {
  it('returns zero without calling the node when there is no address', async () => {
    stubRippled({});

    expect(await XrpXService.getInstance().getBalance(undefined, XRP_TOKEN)).toBe(0n);
    expect(calls).toHaveLength(0);
  });

  it('swallows a fetch failure and reports zero, matching the other XServices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Documented limitation: callers cannot distinguish "zero balance" from "fetch failed".
    expect(await XrpXService.getInstance().getBalance(USER, XRP_TOKEN)).toBe(0n);
    expect(error).toHaveBeenCalled();
  });
});

// The Robinhood stocks share ONE issuer, so their address is `<40-hex currency>:<issuer>` and the
// currency must come from that address, not from the symbol (3-letter tickers would turn into a
// standard currency) and not from the issuer alone (which cannot tell stocks apart).
describe('XrpXService.getBalance — tokens that share an issuer', () => {
  const STOCK_ISSUER = 'rhQeeggWNoaN6ttBEaSqLPJZekFYBvPxtn';
  const asciiHex = (s: string) => Buffer.from(s, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');
  const stock = (symbol: string) =>
    token({ symbol, address: `${asciiHex(symbol)}:${STOCK_ISSUER}`, decimals: 8, name: symbol });

  it('reads the line for the currency in the address, including a 3-letter ticker under its 160-bit code', async () => {
    stubRippled({
      account_lines: {
        lines: [
          { currency: asciiHex('SPCX'), account: STOCK_ISSUER, balance: '7' },
          { currency: asciiHex('NVDA'), account: STOCK_ISSUER, balance: '2.5' },
          { currency: asciiHex('GME'), account: STOCK_ISSUER, balance: '0.00000001' },
        ],
      },
    });
    const svc = XrpXService.getInstance();

    expect(await svc.getBalance(USER, stock('NVDA'))).toBe(250_000_000n); // 2.5 at 8 decimals
    expect(await svc.getBalance(USER, stock('SPCX'))).toBe(700_000_000n);
    expect(await svc.getBalance(USER, stock('GME'))).toBe(1n);
    expect(await svc.getBalance(USER, stock('UPS'))).toBe(0n);
  });
});
