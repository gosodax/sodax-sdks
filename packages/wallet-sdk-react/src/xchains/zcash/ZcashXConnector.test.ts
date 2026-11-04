import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZcashWalletProvider } from '@sodax/wallet-sdk-core';
import { ZcashXConnector } from './ZcashXConnector.js';
import { ZcashXService } from './ZcashXService.js';

/**
 * Noir Wallet injects `window.noirwallet.zcash`, a `request({ method, params })` provider. These tests pin the
 * method names and parameter shapes of its API, and the checks on what it returns.
 */

const ADDRESS = 't1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs';
const TXID = 'ab'.repeat(32);
const SIGNATURE = `20${'cd'.repeat(64)}`;

type Handler = (params?: unknown[]) => unknown;

function stubNoir(handlers: Record<string, Handler> = {}, extra: object = {}) {
  const defaults: Record<string, Handler> = {
    zcash_requestAccounts: () => ({ transparent: ADDRESS, shielded: 'u1shielded', accounts: [] }),
    zcash_getAddresses: () => ({ transparent: ADDRESS, shielded: 'u1shielded' }),
    zcash_sendTransaction: () => TXID,
    zcash_signMessage: () => ({ signature: SIGNATURE, pubkey: '02', address: ADDRESS, signingMode: 'current' }),
    zcash_getBalance: () => ({ transparent: '0.12345678', shielded: '1' }),
    zcash_disconnect: () => undefined,
  };
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    const handler = handlers[method] ?? defaults[method];
    if (!handler) throw new Error(`unexpected method ${method}`);
    return handler(params);
  });
  vi.stubGlobal('window', { noirwallet: { isNoirWallet: true, zcash: { request }, ...extra } });
  return request;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ZcashXConnector — identity and detection', () => {
  it('registers as the Noir Wallet connector for the ZCASH chain type', () => {
    const c = new ZcashXConnector();

    expect(c.xChainType).toBe('ZCASH');
    expect(c.name).toBe('Noir Wallet');
    expect(c.icon).toMatch(/^data:image\/svg\+xml,/);
    expect(c.installUrl).toBe('https://zknoir.com/');
  });

  it('is installed only when the injected object flags itself as Noir Wallet and exposes a Zcash provider', () => {
    stubNoir();
    expect(new ZcashXConnector().isInstalled).toBe(true);

    vi.stubGlobal('window', { noirwallet: { isNoirWallet: false, zcash: { request: vi.fn() } } });
    expect(new ZcashXConnector().isInstalled).toBe(false);

    vi.stubGlobal('window', { noirwallet: { isNoirWallet: true } });
    expect(new ZcashXConnector().isInstalled).toBe(false);

    vi.stubGlobal('window', undefined);
    expect(new ZcashXConnector().isInstalled).toBe(false);
  });
});

describe('ZcashXConnector.connect', () => {
  it('requests accounts and returns the transparent address', async () => {
    const request = stubNoir();

    expect(await new ZcashXConnector().connect()).toEqual({ address: ADDRESS, xChainType: 'ZCASH' });
    expect(request).toHaveBeenCalledWith({ method: 'zcash_requestAccounts' });
  });

  it('explains a missing extension', async () => {
    vi.stubGlobal('window', {});

    await expect(new ZcashXConnector().connect()).rejects.toThrow(/not installed/);
  });

  it('refuses a response without a mainnet transparent address', async () => {
    stubNoir({ zcash_requestAccounts: () => ({ transparent: '', shielded: 'u1shielded' }) });

    await expect(new ZcashXConnector().connect()).rejects.toThrow(/Approve the Noir Wallet popup/);
  });
});

describe('ZcashXConnector.getWallet', () => {
  it('pays from transparent funds, passing the amount as a ZEC decimal string', async () => {
    const request = stubNoir();

    const txid = await new ZcashXConnector().getWallet().sendTransfer({ to: 't1deposit', amount: 123_456_789n });

    expect(txid).toBe(TXID);
    expect(request).toHaveBeenCalledWith({
      method: 'zcash_sendTransaction',
      params: [{ to: 't1deposit', amount: '1.23456789', fundingSource: 'transparent' }],
    });
  });

  it('refuses a send that returns no transaction id', async () => {
    stubNoir({ zcash_sendTransaction: () => ({ error: 'rejected' }) });

    await expect(new ZcashXConnector().getWallet().sendTransfer({ to: 't1deposit', amount: 1n })).rejects.toThrow(
      /did not return a transaction id/,
    );
  });

  it('signs in current mode with the transparent key and returns the 65-byte signature as 0x hex', async () => {
    const request = stubNoir();

    const signature = await new ZcashXConnector().getWallet().signMessage(`0x${'ab'.repeat(32)}`);

    expect(signature).toBe(`0x${SIGNATURE}`);
    expect(request).toHaveBeenCalledWith({
      method: 'zcash_signMessage',
      params: [`0x${'ab'.repeat(32)}`, { signingMode: 'current' }],
    });
  });

  it('refuses a signature from any key other than the transparent address', async () => {
    stubNoir({
      zcash_signMessage: () => ({ signature: SIGNATURE, address: 't1Other', signingMode: 'derived' }),
    });

    await expect(new ZcashXConnector().getWallet().signMessage('0x00')).rejects.toThrow(/expected the transparent/);
  });

  it('refuses a malformed signature', async () => {
    stubNoir({ zcash_signMessage: () => ({ signature: 'abcd', address: ADDRESS }) });

    await expect(new ZcashXConnector().getWallet().signMessage('0x00')).rejects.toThrow(/malformed signature/);
  });

  it('backs a browser-mode provider that pays by sending rather than signing a transaction', async () => {
    stubNoir();
    const provider = new ZcashWalletProvider({ wallet: new ZcashXConnector().getWallet() });

    expect(provider.signTransaction).toBeUndefined();
    expect(await provider.sendTransfer?.({ to: 't1deposit', amount: 1n })).toBe(TXID);
    expect(await provider.getWalletAddress()).toBe(ADDRESS);
  });
});

describe('ZcashXService.getBalance', () => {
  it('reads the connected account transparent balance from the wallet when no node is configured', async () => {
    stubNoir();

    expect(await ZcashXService.getInstance().getBalance(ADDRESS, {} as never)).toBe(12_345_678n);
    expect(await ZcashXService.getInstance().getBalance('t1SomeoneElse', {} as never)).toBe(0n);
  });
});
