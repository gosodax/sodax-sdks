import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TronXConnector } from './TronXConnector.js';

/**
 * TronLink is discovered over TIP-6963 (the Tron analogue of EIP-6963) and authorized with
 * `eth_requestAccounts`. These tests pin that API: the legacy `tron_requestAccounts` is deprecated
 * and answers a code rather than prompting, so it must not creep back.
 */

const ADDRESS = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
const HEX_ACCOUNT = '0x41f62fffa4d92bcdfc310dccbe943747fe8302e871';

type Provider = {
  request: ReturnType<typeof vi.fn>;
  tronWeb?: { defaultAddress?: { base58?: string | false } };
  on?: ReturnType<typeof vi.fn>;
  removeListener?: ReturnType<typeof vi.fn>;
};

const provider = (over: Partial<Provider> = {}): Provider => ({
  request: vi.fn().mockResolvedValue([HEX_ACCOUNT]),
  tronWeb: { defaultAddress: { base58: ADDRESS } },
  ...over,
});

/**
 * Install a window that answers the TIP-6963 broadcast with `announce`, and exposes `globals`
 * directly. Listener registration is real, so the connector's own add/remove is exercised.
 */
function stubWindow(
  opts: {
    announce?: { info?: { name?: string; rdns?: string }; provider: Provider }[];
    globals?: { tron?: Provider; tronLink?: Provider; tronWeb?: unknown };
  } = {},
) {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const w = {
    ...opts.globals,
    addEventListener: (type: string, fn: (e: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener: (type: string, fn: (e: Event) => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(l => l !== fn),
      );
    },
    dispatchEvent: (event: Event) => {
      if (event.type !== 'TIP6963:requestProvider') return true;
      for (const detail of opts.announce ?? []) {
        for (const fn of listeners.get('TIP6963:announceProvider') ?? []) {
          // A plain object stands in for the CustomEvent: the connector only reads `detail`.
          fn({ type: 'TIP6963:announceProvider', detail } as unknown as Event);
        }
      }
      return true;
    },
    listenerCount: (type: string) => (listeners.get(type) ?? []).length,
  };
  vi.stubGlobal('window', w);
  return w;
}

const connector = () => new TronXConnector();

/**
 * Run a connect to completion on fake timers. Discovery and the base58 wait are timer-driven, and on
 * real timers they cost seconds per test and time out on a loaded machine.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TronXConnector — identity', () => {
  it('registers as the TronLink connector for the Tron chain type', () => {
    const c = connector();

    expect(c.xChainType).toBe('TRON');
    expect(c.name).toBe('TronLink');
    expect(c.id).toBe('TronLink');
    expect(c.installUrl).toBe('https://www.tronlink.org/');
    expect(c.icon).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe('TronXConnector.isInstalled', () => {
  it('is true when a Tron provider global is present', () => {
    stubWindow({ globals: { tron: provider() } });
    expect(connector().isInstalled).toBe(true);

    stubWindow({ globals: { tronLink: provider() } });
    expect(connector().isInstalled).toBe(true);
  });

  it('is false when nothing Tron-shaped is injected', () => {
    stubWindow();

    expect(connector().isInstalled).toBe(false);
  });
});

describe('TronXConnector.connect — TIP-6963 discovery', () => {
  it('authorizes the announced TronLink provider with eth_requestAccounts', async () => {
    const p = provider();
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    await expect(settle(connector().connect())).resolves.toEqual({ address: ADDRESS, xChainType: 'TRON' });
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(p.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'tron_requestAccounts' }));
  });

  it('prefers the provider announcing as TronLink over another announcing wallet', async () => {
    const other = provider();
    const tronlink = provider();
    stubWindow({
      announce: [
        { info: { name: 'Some Multi-Chain Wallet' }, provider: other },
        { info: { name: 'TronLink' }, provider: tronlink },
      ],
    });

    await expect(settle(connector().connect())).resolves.toEqual({ address: ADDRESS, xChainType: 'TRON' });
    expect(tronlink.request).toHaveBeenCalled();
    expect(other.request).not.toHaveBeenCalled();
  });

  it('identifies TronLink by rdns as well as name', async () => {
    const p = provider();
    stubWindow({
      announce: [
        { info: { name: 'Other' }, provider: provider() },
        { info: { rdns: 'org.tronlink.wallet' }, provider: p },
      ],
    });

    await settle(connector().connect());

    expect(p.request).toHaveBeenCalled();
  });

  it('stops listening for announcements once discovery is done', async () => {
    const w = stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: provider() }] });

    await settle(connector().connect());

    expect(w.listenerCount('TIP6963:announceProvider')).toBe(0);
  });

  it('falls back to window.tron when no wallet announces', async () => {
    const p = provider();
    stubWindow({ globals: { tron: p } });

    await expect(settle(connector().connect())).resolves.toEqual({ address: ADDRESS, xChainType: 'TRON' });
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });

  it('reports a missing wallet when nothing announces and no global exists', async () => {
    stubWindow();

    await expect(settle(connector().connect())).rejects.toThrow(/not installed/);
  });
});

describe('TronXConnector.connect — address resolution', () => {
  it('prefers the base58 address from the provider tronWeb', async () => {
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: provider() }] });

    const account = await settle(connector().connect());

    // `accounts[0]` is not guaranteed to be base58, so tronWeb wins when populated.
    expect(account?.address).toBe(ADDRESS);
  });

  it('waits for the base58 address when tronWeb publishes it a tick late', async () => {
    const p = provider({ tronWeb: { defaultAddress: { base58: undefined } } });
    p.request = vi.fn().mockImplementation(async () => {
      setTimeout(() => {
        p.tronWeb = { defaultAddress: { base58: ADDRESS } };
      }, 150);
      return [HEX_ACCOUNT];
    });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    expect((await settle(connector().connect()))?.address).toBe(ADDRESS);
  });

  it('rejects a non-base58 account rather than signing with an owner the wallet disowns', async () => {
    // The address becomes the transaction's `owner_address`, which the wallet checks in base58.
    const p = provider({ tronWeb: undefined });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    await expect(settle(connector().connect())).rejects.toThrow(/non-base58 account/);
  });

  it('rejects when authorization returns no account at all', async () => {
    const p = provider({ request: vi.fn().mockResolvedValue([]), tronWeb: undefined });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    await expect(settle(connector().connect())).rejects.toThrow(/returned no account/);
  });
});

describe('TronXConnector.connect — rejection', () => {
  it('reports a user rejection from the EIP-1193 error code', async () => {
    const p = provider({
      request: vi.fn().mockRejectedValue(Object.assign(new Error('User rejected'), { code: 4001 })),
    });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    await expect(settle(connector().connect())).rejects.toThrow(/rejected in the wallet/);
  });

  it('surfaces any other wallet error with its message', async () => {
    const p = provider({ request: vi.fn().mockRejectedValue(new Error('wallet exploded')) });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    await expect(settle(connector().connect())).rejects.toThrow(/wallet exploded/);
  });
});

describe('TronXConnector.getProvider', () => {
  it('returns the provider that authorized, so signing does not go through the injected tronWeb', async () => {
    // The injected `tronWeb` is an unconnected instance (`defaultPrivateKey: false`); signing
    // through it fails with "Private key does not match address in transaction".
    const announced = provider();
    stubWindow({
      announce: [{ info: { name: 'TronLink' }, provider: announced }],
      globals: { tron: provider() },
    });
    const c = connector();

    await settle(c.connect());

    expect(c.getProvider()).toBe(announced);
  });
});

describe('TronXConnector.getTronWeb', () => {
  it('returns the tronWeb of the provider that actually authorized', async () => {
    const announced = provider();
    // A different global is present; the authorized provider must win.
    stubWindow({
      announce: [{ info: { name: 'TronLink' }, provider: announced }],
      globals: { tron: provider({ tronWeb: { defaultAddress: { base58: 'TOtherAddress' } } }) },
    });
    const c = connector();

    await settle(c.connect());

    expect(c.getTronWeb()).toBe(announced.tronWeb);
  });

  it('falls back to an injected provider global before connecting', () => {
    const p = provider();
    stubWindow({ globals: { tron: p } });

    expect(connector().getTronWeb()).toBe(p.tronWeb);
  });

  it('never returns the bare window.tronWeb, which is unconnected and cannot sign', () => {
    const globalTronWeb = { defaultAddress: { base58: false as const } };
    stubWindow({ globals: { tronWeb: globalTronWeb } });

    expect(connector().getTronWeb()).toBeUndefined();
  });

  it('is undefined when nothing is injected, so the registry builds no provider', () => {
    stubWindow();

    expect(connector().getTronWeb()).toBeUndefined();
  });
});

describe('TronXConnector.onWalletEvents', () => {
  it('subscribes to accountsChanged and chainChanged on the authorized provider', async () => {
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const p = provider({
      on: vi.fn((e: string, fn: (...a: unknown[]) => void) => handlers.set(e, fn)),
      removeListener: vi.fn((e: string) => handlers.delete(e)),
    });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });
    const c = connector();
    await settle(c.connect());

    const seen: [string, unknown][] = [];
    const unsubscribe = c.onWalletEvents((event, payload) => seen.push([event, payload]));
    handlers.get('accountsChanged')?.([ADDRESS]);
    handlers.get('chainChanged')?.('0x2b6653dc');

    expect(seen).toEqual([
      ['accountsChanged', [ADDRESS]],
      ['chainChanged', '0x2b6653dc'],
    ]);

    unsubscribe();
    expect(p.removeListener).toHaveBeenCalledTimes(2);
  });

  it('is a no-op unsubscribe when the provider emits no events', () => {
    stubWindow({ globals: { tron: provider({ on: undefined }) } });

    expect(() => connector().onWalletEvents(() => undefined)()).not.toThrow();
  });
});

describe('TronXConnector.disconnect', () => {
  it('clears the authorized provider, since TronLink has no programmatic disconnect', async () => {
    const p = provider();
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });
    const c = connector();
    await settle(c.connect());

    await expect(c.disconnect()).resolves.toBeUndefined();
  });
});
