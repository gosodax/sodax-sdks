import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GemWallet is not usable as a bare injected object — every call goes through `@gemwallet/api`,
// which talks to the extension over postMessage. Mock the module rather than a window global.
const isInstalled = vi.fn();
const getAddress = vi.fn();
const getPublicKey = vi.fn();
const signMessage = vi.fn();
const submitTransaction = vi.fn();

vi.mock('@gemwallet/api', () => ({ isInstalled, getAddress, getPublicKey, signMessage, submitTransaction }));

const { XrpXConnector } = await import('./XrpXConnector.js');

const ADDRESS = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';

const connector = () => new XrpXConnector();

beforeEach(() => {
  isInstalled.mockResolvedValue({ result: { isInstalled: true } });
  getAddress.mockResolvedValue({ result: { address: ADDRESS } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('XrpXConnector — identity', () => {
  it('registers as the GemWallet connector for the XRP chain type', () => {
    const c = connector();

    expect(c.xChainType).toBe('XRP');
    expect(c.name).toBe('GemWallet');
  });

  it('exposes a self-contained data-URI icon, avoiding a cross-origin image fetch', () => {
    expect(connector().icon).toMatch(/^data:image\/svg\+xml,/);
  });

  it('points at the extension install page', () => {
    expect(connector().installUrl).toBe('https://gemwallet.app/');
  });
});

describe('XrpXConnector.isInstalled', () => {
  it('reads the extension detection flag synchronously, since it is on the render path', () => {
    vi.stubGlobal('window', { gemWallet: true });

    expect(connector().isInstalled).toBe(true);
  });

  it('is false when the flag is absent or not exactly true', () => {
    vi.stubGlobal('window', {});
    expect(connector().isInstalled).toBe(false);

    vi.stubGlobal('window', { gemWallet: 'yes' });
    expect(connector().isInstalled).toBe(false);
  });

  it('is false in a non-browser environment rather than throwing', () => {
    vi.stubGlobal('window', undefined);

    expect(connector().isInstalled).toBe(false);
  });
});

describe('XrpXConnector.connect', () => {
  it('returns the connected classic address tagged with the chain type', async () => {
    expect(await connector().connect()).toEqual({ address: ADDRESS, xChainType: 'XRP' });
  });

  it('checks installation with the authoritative async API before prompting', async () => {
    isInstalled.mockResolvedValue({ result: { isInstalled: false } });

    await expect(connector().connect()).rejects.toThrow(/not installed/);
    expect(getAddress).not.toHaveBeenCalled();
  });

  it('tells the user to approve the popup when no address comes back', async () => {
    // The user dismissing the GemWallet prompt resolves without an address rather than throwing.
    getAddress.mockResolvedValue({ result: {} });

    await expect(connector().connect()).rejects.toThrow(/Approve the GemWallet popup/);
  });

  it('disconnects without error, since GemWallet has no programmatic disconnect', async () => {
    await expect(connector().disconnect()).resolves.toBeUndefined();
  });
});

describe('XrpXConnector.getGemWallet', () => {
  it('adapts the API to the structural shape the wallet provider expects', () => {
    const gem = connector().getGemWallet();

    // `wallet-sdk-core` takes no `@gemwallet/api` dependency of its own — this is the seam.
    expect(Object.keys(gem).sort()).toEqual(['getAddress', 'getPublicKey', 'signMessage', 'submitTransaction']);
  });

  it('forwards the hash and its hex flag to signMessage unchanged', async () => {
    const hash = 'AB'.repeat(32);
    signMessage.mockResolvedValue({ result: { signedMessage: 'CD'.repeat(64) } });

    await connector().getGemWallet().signMessage(hash, true);

    // Dropping `isHex` would make GemWallet sign the text of the hash instead of its bytes.
    expect(signMessage).toHaveBeenCalledWith(hash, true);
  });

  it('forwards a transaction payload unchanged to submitTransaction', async () => {
    const transaction = { TransactionType: 'Payment', Account: ADDRESS };
    submitTransaction.mockResolvedValue({ result: { hash: 'A'.repeat(64) } });

    await connector().getGemWallet().submitTransaction({ transaction });

    expect(submitTransaction).toHaveBeenCalledWith({ transaction });
  });

  it('delegates address and public-key reads to the API', async () => {
    getPublicKey.mockResolvedValue({ result: { publicKey: `ED${'11'.repeat(32)}` } });
    const gem = connector().getGemWallet();

    await gem.getAddress();
    await gem.getPublicKey();

    expect(getAddress).toHaveBeenCalled();
    expect(getPublicKey).toHaveBeenCalled();
  });
});
