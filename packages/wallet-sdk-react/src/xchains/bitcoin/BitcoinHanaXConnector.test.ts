import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted before the dynamic SUT import so the mock is in place when the module
// first evaluates. The connector imports `AddressPurpose` / `MessageSigningProtocols`
// statically and `request` via dynamic import — all resolve to this mock.
const request = vi.fn();

vi.mock('sats-connect', () => ({
  request,
  AddressPurpose: { Payment: 'payment', Ordinals: 'ordinals' },
  MessageSigningProtocols: { ECDSA: 'ECDSA', BIP322: 'BIP322' },
}));

const { BitcoinHanaXConnector } = await import('./BitcoinHanaXConnector.js');

const HANA_PROVIDER_ID = 'hanaWallet.bitcoin';

// The connector detects Hana via a local cast (it doesn't augment global `Window`),
// so the test casts too when planting/clearing the window surface.
type HanaWin = { hanaWallet?: { bitcoin?: unknown } };

/** Mark Hana as installed on the happy-dom window. */
function installHana(): void {
  (window as HanaWin).hanaWallet = { bitcoin: {} };
}

beforeEach(() => {
  request.mockReset();
  localStorage.clear();
});

afterEach(() => {
  // Unstub first: the SSR test stubs `window` to undefined, so clearing
  // `window.hanaWallet` must happen only after the real window is restored.
  vi.unstubAllGlobals();
  if (typeof window !== 'undefined') (window as HanaWin).hanaWallet = undefined;
});

const TAPROOT_ACCOUNT = { address: 'bc1ptaproot', publicKey: '02deadbeef', purpose: 'ordinals', addressType: 'p2tr' };

describe('BitcoinHanaXConnector — constructor + getters', () => {
  it('exposes a Bitcoin-suffixed id distinct from the ICON Hana connector, defaulting to Taproot', () => {
    const c = new BitcoinHanaXConnector();
    expect(c.id).toBe('hana-bitcoin');
    expect(c.name).toBe('Hana Wallet');
    expect(c.xChainType).toBe('BITCOIN');
    expect(c.installUrl).toContain('chromewebstore.google.com');
    expect(c.icon).toMatch(/^https?:\/\//);
    expect(c.addressPurpose).toBe('ordinals');
  });

  it('persists the purpose set via setAddressPurpose and restores it in a new connector', () => {
    const c = new BitcoinHanaXConnector();
    c.setAddressPurpose('segwit');
    expect(c.addressPurpose).toBe('payment');
    expect(localStorage.getItem('hana-address-type')).toBe('segwit');

    expect(new BitcoinHanaXConnector().addressPurpose).toBe('payment');
  });
});

describe('BitcoinHanaXConnector.isInstalled / isAvailable', () => {
  it('returns false under SSR (window undefined)', () => {
    vi.stubGlobal('window', undefined);
    expect(BitcoinHanaXConnector.isAvailable()).toBe(false);
  });

  it('reflects whether window.hanaWallet.bitcoin is present', () => {
    expect(new BitcoinHanaXConnector().isInstalled).toBe(false);
    installHana();
    expect(new BitcoinHanaXConnector().isInstalled).toBe(true);
  });
});

describe('BitcoinHanaXConnector.connect', () => {
  it('throws when Hana is not installed', async () => {
    await expect(new BitcoinHanaXConnector().connect()).rejects.toThrow('Hana wallet is not installed');
  });

  it('returns the XAccount, pins getAccounts to Hana, and holds a wallet provider until disconnect', async () => {
    installHana();
    request.mockResolvedValueOnce({ status: 'success', result: [TAPROOT_ACCOUNT] });
    const connector = new BitcoinHanaXConnector();

    const result = await connector.connect();

    expect(result).toEqual({ address: 'bc1ptaproot', publicKey: '02deadbeef', xChainType: 'BITCOIN' });
    expect(request).toHaveBeenCalledWith(
      'getAccounts',
      { purposes: ['ordinals'], message: 'Connect to Sodax' },
      HANA_PROVIDER_ID,
    );
    expect(connector.getWalletProvider()).toBeDefined();

    await connector.disconnect();
    expect(connector.getWalletProvider()).toBeUndefined();
  });

  it('throws with the wallet error message when getAccounts fails', async () => {
    installHana();
    request.mockResolvedValueOnce({ status: 'error', error: { message: 'user rejected' } });
    await expect(new BitcoinHanaXConnector().connect()).rejects.toThrow('user rejected');
  });
});

describe('BitcoinHanaWalletProvider', () => {
  it('pins every sats-connect call (message signing, PSBT signing, transfer) to Hana', async () => {
    installHana();
    request.mockResolvedValueOnce({ status: 'success', result: [TAPROOT_ACCOUNT] });
    const connector = new BitcoinHanaXConnector();
    await connector.connect();
    const provider = connector.getWalletProvider();
    if (!provider) throw new Error('expected a wallet provider after connect');

    request.mockResolvedValueOnce({ status: 'success', result: { signature: 'sig-ecdsa' } });
    expect(await provider.signEcdsaMessage('hello')).toBe('sig-ecdsa');
    expect(request).toHaveBeenLastCalledWith(
      'signMessage',
      { address: 'bc1ptaproot', message: 'hello', protocol: 'ECDSA' },
      HANA_PROVIDER_ID,
    );

    request.mockResolvedValueOnce({ status: 'success', result: { signature: 'sig-bip322' } });
    expect(await provider.signBip322Message('hello')).toBe('sig-bip322');
    expect(request).toHaveBeenLastCalledWith(
      'signMessage',
      { address: 'bc1ptaproot', message: 'hello', protocol: 'BIP322' },
      HANA_PROVIDER_ID,
    );

    request.mockResolvedValueOnce({ status: 'success', result: { psbt: 'c2lnbmVk' } });
    await provider.signTransaction('cHNidP8BAA==');
    expect(request).toHaveBeenLastCalledWith(
      'signPsbt',
      expect.objectContaining({ broadcast: false }),
      HANA_PROVIDER_ID,
    );

    request.mockResolvedValueOnce({ status: 'success', result: { txid: 'tx-hash' } });
    expect(await provider.sendBitcoin('bc1qdest', 1000n)).toBe('tx-hash');
    expect(request).toHaveBeenLastCalledWith(
      'sendTransfer',
      { recipients: [{ address: 'bc1qdest', amount: 1000 }] },
      HANA_PROVIDER_ID,
    );
  });

  it('is recreated only from an account with both address and publicKey', () => {
    const connector = new BitcoinHanaXConnector();
    expect(connector.recreateWalletProvider({ address: 'bc1ptaproot', xChainType: 'BITCOIN' })).toBeUndefined();
    expect(
      connector.recreateWalletProvider({ address: 'bc1ptaproot', publicKey: '02deadbeef', xChainType: 'BITCOIN' }),
    ).toBeDefined();
  });
});
