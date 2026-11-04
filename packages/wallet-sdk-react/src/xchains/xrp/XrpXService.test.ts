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

describe('XrpXService.getInstance', () => {
  it('returns the same instance and defaults to the public cluster', () => {
    const first = XrpXService.getInstance();

    expect(XrpXService.getInstance()).toBe(first);
    expect(first.rpcUrl).toBe('https://xrplcluster.com');
    expect(first.xChainType).toBe('XRP');
  });

  it('takes the rpcUrl from the first call', () => {
    expect(XrpXService.getInstance({ rpcUrl: 'https://first.example' }).rpcUrl).toBe('https://first.example');
  });

  it('updates the rpcUrl of the existing instance rather than replacing it', () => {
    const first = XrpXService.getInstance({ rpcUrl: 'https://first.example' });

    const second = XrpXService.getInstance({ rpcUrl: 'https://second.example' });

    expect(second).toBe(first);
    expect(second.rpcUrl).toBe('https://second.example');
  });

  it('keeps the existing rpcUrl when called again with no config', () => {
    XrpXService.getInstance({ rpcUrl: 'https://first.example' });

    expect(XrpXService.getInstance().rpcUrl).toBe('https://first.example');
  });
});

describe('XrpXService.getBalance — native XRP', () => {
  it('reads drops from account_info against the validated ledger', async () => {
    stubRippled({ account_info: { account_data: { Balance: '42000000' } } });

    const balance = await XrpXService.getInstance().getBalance(USER, XRP_TOKEN);

    expect(calls[0]).toMatchObject({
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

  it('reports zero for an unfunded account that has no Balance field', async () => {
    stubRippled({ account_info: {} });

    expect(await XrpXService.getInstance().getBalance(USER, XRP_TOKEN)).toBe(0n);
  });
});

describe('XrpXService.getBalance — IOU', () => {
  it('reads the trustline to the issuer and scales the decimal balance to base units', async () => {
    stubRippled({
      account_lines: { lines: [{ currency: RLUSD_CURRENCY, account: RLUSD_ISSUER, balance: '1.5' }] },
    });

    const balance = await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN);

    expect(calls[0]?.method).toBe('account_lines');
    // "1.5" at 6 decimals is 1_500_000 base units.
    expect(balance).toBe(1_500_000n);
  });

  it('pads a short fraction rather than misreading its scale', async () => {
    stubRippled({
      account_lines: { lines: [{ currency: RLUSD_CURRENCY, account: RLUSD_ISSUER, balance: '0.25' }] },
    });

    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(250_000n);
  });

  it('truncates a fraction finer than the token decimals', async () => {
    stubRippled({
      account_lines: { lines: [{ currency: RLUSD_CURRENCY, account: RLUSD_ISSUER, balance: '1.1234567' }] },
    });

    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(1_123_456n);
  });

  it('handles a whole-number balance with no decimal point', async () => {
    stubRippled({
      account_lines: { lines: [{ currency: RLUSD_CURRENCY, account: RLUSD_ISSUER, balance: '3' }] },
    });

    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(3_000_000n);
  });

  it('reports zero when there is no trustline for the currency', async () => {
    stubRippled({ account_lines: { lines: [] } });

    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(0n);
  });

  it('does not credit a line from a different issuer with the same currency code', async () => {
    stubRippled({
      account_lines: {
        lines: [{ currency: RLUSD_CURRENCY, account: 'rImPoStErIsSuEr00000000000000000000', balance: '99' }],
      },
    });

    expect(await XrpXService.getInstance().getBalance(USER, RLUSD_TOKEN)).toBe(0n);
  });

  it('uses the 3-character ASCII currency form for a short symbol', async () => {
    stubRippled({
      account_lines: { lines: [{ currency: 'EUR', account: RLUSD_ISSUER, balance: '2' }] },
    });

    const eur = token({ symbol: 'EUR', address: RLUSD_ISSUER, decimals: 6 });
    expect(await XrpXService.getInstance().getBalance(USER, eur)).toBe(2_000_000n);
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

  it('reports zero when the node answers without a result', async () => {
    stubRippled({});

    expect(await XrpXService.getInstance().getBalance(USER, XRP_TOKEN)).toBe(0n);
  });
});

describe('XrpXService — endpoint', () => {
  it('queries the configured rpcUrl', async () => {
    stubRippled({ account_info: { account_data: { Balance: '1' } } });

    await XrpXService.getInstance({ rpcUrl: 'https://custom.example/rpc' }).getBalance(USER, XRP_TOKEN);

    expect(calls[0]?.url).toBe('https://custom.example/rpc');
  });
});
