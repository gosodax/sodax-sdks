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
  tronWeb?: { defaultAddress?: { base58?: string | false }; trx?: { signMessageV2: ReturnType<typeof vi.fn> } };
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
    globals?: { tron?: Partial<Provider>; tronLink?: Partial<Provider>; tronWeb?: unknown };
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
  it('counts only a provider global that connect() could authorize against', () => {
    stubWindow({ globals: { tron: provider() } });
    expect(connector().isInstalled).toBe(true);

    stubWindow({ globals: { tronLink: provider() } });
    expect(connector().isInstalled).toBe(true);

    stubWindow({ globals: { tron: { tronWeb: {} }, tronLink: provider() } });
    expect(connector().isInstalled).toBe(true);

    stubWindow({ globals: { tron: { tronWeb: {} } } });
    expect(connector().isInstalled).toBe(false);

    stubWindow();
    expect(connector().isInstalled).toBe(false);
  });

  it('counts a TIP-6963 wallet once discovery answers, but only for the window that discovered it', async () => {
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: provider() }] });
    const c = connector();
    await vi.runAllTimersAsync();
    // The wallet modal checks this before connect(), so it must agree with what connect() would find.
    expect(c.isInstalled).toBe(true);

    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: provider() }] });
    connector();
    stubWindow();
    const replaced = connector();
    await vi.runAllTimersAsync();
    expect(replaced.isInstalled).toBe(false);
  });
});

describe('TronXConnector.connect — TIP-6963 discovery', () => {
  it('authorizes the announced TronLink provider with eth_requestAccounts, then stops listening', async () => {
    const p = provider();
    const w = stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: p }] });

    await expect(settle(connector().connect())).resolves.toEqual({ address: ADDRESS, xChainType: 'TRON' });
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(p.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'tron_requestAccounts' }));
    expect(w.listenerCount('TIP6963:announceProvider')).toBe(0);
  });

  it('prefers the provider announcing as TronLink, by name or rdns, over another announcing wallet', async () => {
    const other = provider();
    const byName = provider();
    stubWindow({
      announce: [
        { info: { name: 'Some Multi-Chain Wallet' }, provider: other },
        { info: { name: 'TronLink' }, provider: byName },
      ],
    });
    await settle(connector().connect());
    expect(byName.request).toHaveBeenCalled();
    expect(other.request).not.toHaveBeenCalled();

    const byRdns = provider();
    stubWindow({
      announce: [
        { info: { name: 'Other' }, provider: provider() },
        { info: { rdns: 'org.tronlink.wallet' }, provider: byRdns },
      ],
    });
    await settle(connector().connect());
    expect(byRdns.request).toHaveBeenCalled();
  });

  it('falls back to the first usable provider global when no wallet announces', async () => {
    const tron = provider();
    stubWindow({ globals: { tron } });
    await expect(settle(connector().connect())).resolves.toEqual({ address: ADDRESS, xChainType: 'TRON' });
    expect(tron.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });

    const tronLink = provider();
    stubWindow({ globals: { tron: { tronWeb: {} }, tronLink } });
    await settle(connector().connect());
    expect(tronLink.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });

  it('reports a missing wallet when nothing announces and no global exists', async () => {
    stubWindow();

    await expect(settle(connector().connect())).rejects.toThrow(/not installed/);
  });
});

describe('TronXConnector.connect — address resolution', () => {
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

  it('rejects an authorization that yields no base58 account rather than sign with an owner the wallet disowns', async () => {
    // The address becomes the transaction's `owner_address`, which the wallet checks in base58.
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: provider({ tronWeb: undefined }) }] });
    await expect(settle(connector().connect())).rejects.toThrow(/non-base58 account/);

    const empty = provider({ request: vi.fn().mockResolvedValue([]), tronWeb: undefined });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: empty }] });
    await expect(settle(connector().connect())).rejects.toThrow(/returned no account/);
  });
});

describe('TronXConnector.connect — rejection', () => {
  it('maps an EIP-1193 user rejection to a clear error and surfaces any other wallet error message', async () => {
    const rejecting = provider({
      request: vi.fn().mockRejectedValue(Object.assign(new Error('User rejected'), { code: 4001 })),
    });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: rejecting }] });
    await expect(settle(connector().connect())).rejects.toThrow(/rejected in the wallet/);

    const failing = provider({ request: vi.fn().mockRejectedValue(new Error('wallet exploded')) });
    stubWindow({ announce: [{ info: { name: 'TronLink' }, provider: failing }] });
    await expect(settle(connector().connect())).rejects.toThrow(/wallet exploded/);
  });
});

describe('TronXConnector.getProvider / getTronWeb', () => {
  it('returns the provider that authorized, not an injected global, until disconnect', async () => {
    // The injected `tronWeb` is an unconnected instance (`defaultPrivateKey: false`); signing
    // through it fails with "Private key does not match address in transaction".
    const announced = provider();
    stubWindow({
      announce: [{ info: { name: 'TronLink' }, provider: announced }],
      globals: { tron: provider({ tronWeb: { defaultAddress: { base58: 'TOtherAddress' } } }) },
    });
    const c = connector();

    await settle(c.connect());
    expect(c.getProvider()).toBe(announced);
    expect(c.getTronWeb()).toBe(announced.tronWeb);

    // TronLink has no programmatic disconnect, so only the app-side connection is cleared.
    await expect(c.disconnect()).resolves.toBeUndefined();
    stubWindow();
    expect(c.getProvider()).toBeUndefined();
  });

  it('falls back to an injected provider before connecting, never the bare unconnected window.tronWeb', () => {
    const p = provider();
    stubWindow({ globals: { tron: p } });
    expect(connector().getTronWeb()).toBe(p.tronWeb);

    stubWindow({ globals: { tronWeb: { defaultAddress: { base58: false as const } } } });
    expect(connector().getTronWeb()).toBeUndefined();
  });
});

describe('TronXConnector.signMessage', () => {
  const signing = (account: string | false, signature = 'ab12') => {
    const signMessageV2 = vi.fn().mockResolvedValue(signature);
    stubWindow({
      globals: { tron: provider({ tronWeb: { defaultAddress: { base58: account }, trx: { signMessageV2 } } }) },
    });
    return signMessageV2;
  };

  it('signs with signMessageV2 as the connected account and returns 0x-prefixed hex', async () => {
    const signMessageV2 = signing(ADDRESS);

    await expect(connector().signMessage('hello', ADDRESS)).resolves.toBe('0xab12');
    expect(signMessageV2).toHaveBeenCalledWith('hello');
  });

  it('refuses unless the wallet is unlocked on the connected account', async () => {
    const switched = signing('TGLeueT1EauJN1AupKBPmkSE76Brm1v4ow');
    await expect(connector().signMessage('hello', ADDRESS)).rejects.toThrow(`not the connected ${ADDRESS}`);
    expect(switched).not.toHaveBeenCalled();

    const locked = signing(false);
    await expect(connector().signMessage('hello', ADDRESS)).rejects.toThrow('Tron wallet is locked or not connected');
    expect(locked).not.toHaveBeenCalled();
  });
});
