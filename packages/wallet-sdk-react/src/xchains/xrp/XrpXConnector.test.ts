import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// GemWallet is not usable as a bare injected object — every call goes through `@gemwallet/api`,
// which talks to the extension over postMessage. Mock the module rather than a window global.
const isInstalled = vi.fn();
const getAddress = vi.fn();
const getPublicKey = vi.fn();
const signMessage = vi.fn();
const submitTransaction = vi.fn();
const getNetwork = vi.fn();

vi.mock('@gemwallet/api', () => ({
  isInstalled,
  getAddress,
  getPublicKey,
  signMessage,
  submitTransaction,
  getNetwork,
}));

const { XrpXConnector } = await import('./XrpXConnector.js');

const ADDRESS = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';

const PAYMENT = { TransactionType: 'Payment', Account: ADDRESS, Destination: ADDRESS, Amount: '1' } as const;

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
    expect(c.icon).toMatch(/^data:image\/svg\+xml,/);
    expect(c.installUrl).toBe('https://gemwallet.app/');
  });
});

describe('XrpXConnector.isInstalled', () => {
  it('reads the extension detection flag synchronously, true only when it is exactly true', () => {
    vi.stubGlobal('window', { gemWallet: true });
    expect(connector().isInstalled).toBe(true);

    vi.stubGlobal('window', {});
    expect(connector().isInstalled).toBe(false);

    vi.stubGlobal('window', { gemWallet: 'yes' });
    expect(connector().isInstalled).toBe(false);
  });
});

describe('XrpXConnector.detect', () => {
  it("returns the extension's own answer, which is what sets the flag isInstalled reads", async () => {
    isInstalled.mockResolvedValueOnce({ result: { isInstalled: false } });

    expect(await XrpXConnector.detect()).toBe(false);
    expect(await XrpXConnector.detect()).toBe(true);
  });

  it('reports not installed in a non-browser environment, without throwing or asking the extension', async () => {
    vi.stubGlobal('window', undefined);

    expect(connector().isInstalled).toBe(false);
    expect(await XrpXConnector.detect()).toBe(false);
    expect(isInstalled).not.toHaveBeenCalled();
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

// `wallet-sdk-core` takes no `@gemwallet/api` dependency of its own — getGemWallet is the seam.
describe('XrpXConnector.getGemWallet', () => {
  it('forwards the hash and its hex flag to signMessage unchanged', async () => {
    const hash = 'AB'.repeat(32);
    signMessage.mockResolvedValue({ result: { signedMessage: 'CD'.repeat(64) } });

    await connector().getGemWallet().signMessage(hash, true);

    // Dropping `isHex` would make GemWallet sign the text of the hash instead of its bytes.
    expect(signMessage).toHaveBeenCalledWith(hash, true);
  });

  it('routes Payment and TrustSet payloads unchanged through submitTransaction, passing a refusal back', async () => {
    const trustSet = {
      TransactionType: 'TrustSet' as const,
      Account: ADDRESS,
      LimitAmount: { currency: 'USD', issuer: 'rbtWzBnJB84fKuVCg2qbKKX4EUtCWVik7', value: '9999999999999999e80' },
    };
    const refusal = { type: 'reject' } as const;
    submitTransaction.mockResolvedValueOnce(refusal).mockResolvedValueOnce({ result: { hash: 'A'.repeat(64) } });
    const gem = connector().getGemWallet();

    await expect(gem.submitTransaction({ transaction: PAYMENT })).resolves.toBe(refusal);
    await gem.submitTrustSet?.({ transaction: trustSet });

    expect(submitTransaction).toHaveBeenNthCalledWith(1, { transaction: PAYMENT });
    expect(submitTransaction).toHaveBeenNthCalledWith(2, { transaction: trustSet });
  });

  it('delegates address, public-key and network reads to the API', async () => {
    getPublicKey.mockResolvedValue({ result: { publicKey: `ED${'11'.repeat(32)}` } });
    // The provider refuses a ledger other than the XRPL Mainnet, so the network must pass through as is.
    getNetwork.mockResolvedValue({ result: { chain: 'XAHAU', network: 'Mainnet' } });
    const gem = connector().getGemWallet();

    await gem.getAddress();
    await gem.getPublicKey();

    expect(getAddress).toHaveBeenCalled();
    expect(getPublicKey).toHaveBeenCalled();
    expect(await gem.getNetwork?.()).toEqual({ result: { chain: 'XAHAU', network: 'Mainnet' } });
  });
});
