import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the bundled libs subpath the SUT imports — same pattern as
// StacksWalletProvider.test.ts. Hoisted before the dynamic SUT import so
// the mock is in place when the module first evaluates.
const request = vi.fn();
const disconnect = vi.fn();

vi.mock('@sodax/libs/stacks/connect', () => ({ request, disconnect }));

const { StacksXConnector } = await import('./StacksXConnector.js');
const { STACKS_PROVIDERS } = await import('./constants.js');
const { WALLET_METADATA } = await import('@/constants.js');

const CONFIG = {
  id: 'LeatherProvider',
  name: 'Leather',
  icon: 'leather.svg',
  installUrl: 'https://leather.io/install',
};

afterEach(() => {
  // Clean up any `window.*` we set during the test so neighbouring tests start clean.
  for (const key of ['LeatherProvider', 'XverseProviders', 'hanaWallet']) {
    if (key in globalThis) {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  vi.unstubAllGlobals();
});

describe('StacksXConnector — constructor + getters', () => {
  it('exposes the config-driven id / name / icon / installUrl', () => {
    const c = new StacksXConnector(CONFIG);
    expect(c.id).toBe('LeatherProvider');
    expect(c.name).toBe('Leather');
    expect(c.icon).toBe('leather.svg');
    expect(c.installUrl).toBe('https://leather.io/install');
    expect(c.xChainType).toBe('STACKS');
  });
});

describe('StacksXConnector.isInstalled / getProvider — window dot-walk', () => {
  const XVERSE = { id: 'XverseProviders.StacksProvider', name: 'Xverse', icon: 'xverse.svg' };

  it('reports not installed and no provider when window, the provider or an intermediate path object is missing', () => {
    vi.stubGlobal('window', undefined);
    expect(new StacksXConnector(CONFIG).isInstalled).toBe(false);
    expect(new StacksXConnector(CONFIG).getProvider()).toBeUndefined();

    vi.stubGlobal('window', {});
    expect(new StacksXConnector(CONFIG).isInstalled).toBe(false);

    // The dot-walk should bail out cleanly, not crash.
    vi.stubGlobal('window', { XverseProviders: undefined });
    expect(new StacksXConnector(XVERSE).isInstalled).toBe(false);
    expect(new StacksXConnector(XVERSE).getProvider()).toBeUndefined();
  });

  it('resolves top-level and nested dot-separated ids to the injected provider', () => {
    // Leather injects window.LeatherProvider; Xverse uses a nested path (window.XverseProviders.StacksProvider).
    const leather = { reqHandler: () => undefined };
    vi.stubGlobal('window', { LeatherProvider: leather });
    expect(new StacksXConnector(CONFIG).isInstalled).toBe(true);
    expect(new StacksXConnector(CONFIG).getProvider()).toBe(leather);

    const xverse = { fake: true };
    vi.stubGlobal('window', { XverseProviders: { StacksProvider: xverse } });
    expect(new StacksXConnector(XVERSE).isInstalled).toBe(true);
    expect(new StacksXConnector(XVERSE).getProvider()).toBe(xverse);
  });
});

describe('StacksXConnector.connect', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('throws a meaningful error when the extension is not installed', async () => {
    vi.stubGlobal('window', {});
    const c = new StacksXConnector(CONFIG);

    await expect(c.connect()).rejects.toThrow('Leather is not installed. Install the extension and reload the page.');
  });

  it('returns the XAccount when stx_getAddresses yields an entry with purpose="stacks"', async () => {
    vi.stubGlobal('window', { LeatherProvider: { fake: true } });
    request.mockResolvedValueOnce({
      addresses: [
        { address: 'bc1q...', purpose: 'payment' },
        { address: 'SP1USERSTACKS', purpose: 'stacks', publicKey: '02deadbeef' },
      ],
    });

    const result = await new StacksXConnector(CONFIG).connect();

    expect(result).toEqual({ address: 'SP1USERSTACKS', publicKey: '02deadbeef', xChainType: 'STACKS' });
    // `request` should be called with the provider bound and the JSON-RPC method name.
    expect(request).toHaveBeenCalledWith({ provider: { fake: true } }, 'stx_getAddresses');
  });

  it('logs a warning and returns undefined when no entry has purpose="stacks"', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', { LeatherProvider: { fake: true } });
    request.mockResolvedValueOnce({
      addresses: [
        { address: 'bc1q...', purpose: 'payment' },
        { address: 'bc1p...', purpose: 'ordinals' },
      ],
    });

    const result = await new StacksXConnector(CONFIG).connect();

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[StacksXConnector] Leather: no address with purpose="stacks"'),
      expect.any(Array),
    );
    warnSpy.mockRestore();
  });
});

describe('STACKS_PROVIDERS — Hana entry', () => {
  const hana = STACKS_PROVIDERS.find(p => p.id === 'hanaWallet.stacks');

  it('is registered with the shared Hana metadata and resolves to window.hanaWallet.stacks', () => {
    if (!hana) throw new Error('Hana entry missing from STACKS_PROVIDERS');
    expect(hana.name).toBe('Hana Wallet');
    expect(hana.icon).toBe(WALLET_METADATA.hana.icon);
    expect(hana.installUrl).toBe(WALLET_METADATA.hana.installUrl);

    const provider = { fake: true };
    vi.stubGlobal('window', { hanaWallet: { stacks: provider } });
    const c = new StacksXConnector(hana);
    expect(c.isInstalled).toBe(true);
    expect(c.getProvider()).toBe(provider);
  });
});

describe('StacksXConnector.disconnect', () => {
  it('delegates to the libs/stacks/connect `disconnect()` export', async () => {
    disconnect.mockClear();
    await new StacksXConnector(CONFIG).disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
