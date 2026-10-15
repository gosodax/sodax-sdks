import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concat, keccak256, recoverAddress, stringToBytes, toBytes, type Hex } from 'viem';
import type { TronSignedTransaction, TronUnsignedTransaction } from '@sodax/types';
import { TronWalletProvider } from './TronWalletProvider.js';
import type { TronProviderLike, TronWebLike } from './types.js';

// Hardhat/Anvil account #0 — a public test key, never funded on mainnet.
const PRIVATE_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// base58check(0x41 ‖ EVM_ADDRESS), derived independently of the provider.
const TRON_ADDRESS = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
const OTHER_ADDRESS = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';

const TX: TronUnsignedTransaction = { txID: 'ab'.repeat(32), raw_data_hex: '0a02abcd', visible: false };
const HASH: Hex = `0x${'cd'.repeat(32)}`;

/** Scheme-1 digest the relay recovers against: the hash's 66-char hex TEXT under the TRON prefix. */
const scheme1Digest = (hash: Hex): Hex =>
  keccak256(concat([toBytes('\x19TRON Signed Message:\n66'), stringToBytes(hash.toLowerCase())]));

function makeTronWeb(address: string | false = TRON_ADDRESS): TronWebLike {
  return {
    defaultAddress: { base58: address },
    trx: {
      sign: vi.fn(
        async (tx: TronUnsignedTransaction): Promise<TronSignedTransaction> => ({ ...tx, signature: ['sig'] }),
      ),
      signMessageV2: vi.fn(async () => 'deadbeef'),
    },
  };
}

function stubFetch(responses: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = new URL(url).pathname;
    return { ok, status: ok ? 200 : 500, json: async () => responses[path] } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TronWalletProvider — constructor', () => {
  it('accepts a private key with or without 0x', async () => {
    await expect(new TronWalletProvider({ privateKey: PRIVATE_KEY }).getWalletAddress()).resolves.toBe(TRON_ADDRESS);
    await expect(new TronWalletProvider({ privateKey: `0x${PRIVATE_KEY}` }).getWalletAddress()).resolves.toBe(
      TRON_ADDRESS,
    );
  });

  it('rejects a config that is neither private-key nor browser-extension', () => {
    expect(() => new TronWalletProvider({} as never)).toThrow(/Invalid Tron wallet configuration/);
  });
});

describe('TronWalletProvider.getWalletAddress', () => {
  it('prefers the configured address over the injected TronWeb', async () => {
    const provider = new TronWalletProvider({ tronWeb: makeTronWeb(OTHER_ADDRESS), address: TRON_ADDRESS });
    await expect(provider.getWalletAddress()).resolves.toBe(TRON_ADDRESS);
  });

  it('falls back to tronWeb.defaultAddress', async () => {
    await expect(new TronWalletProvider({ tronWeb: makeTronWeb() }).getWalletAddress()).resolves.toBe(TRON_ADDRESS);
  });

  it('throws when the wallet has no account', async () => {
    await expect(new TronWalletProvider({ tronWeb: makeTronWeb(false) }).getWalletAddress()).rejects.toThrow(
      /not connected/,
    );
  });
});

describe('TronWalletProvider.signTransaction', () => {
  it('private key: signs the txID so the signature recovers to the account (r ‖ s ‖ yParity byte)', async () => {
    const signed = await new TronWalletProvider({ privateKey: PRIVATE_KEY }).signTransaction(TX);
    const signature = signed.signature[0] ?? '';

    expect(signed.txID).toBe(TX.txID);
    expect(signature).toMatch(/^[0-9a-f]{128}0[01]$/);
    await expect(recoverAddress({ hash: `0x${TX.txID}`, signature: `0x${signature}` })).resolves.toBe(EVM_ADDRESS);
  });

  it('browser: signs through the provider resolved at call time, not the captured injected TronWeb', async () => {
    const injected = makeTronWeb();
    const live = makeTronWeb();
    const provider = new TronWalletProvider({
      tronWeb: injected,
      getProvider: (): TronProviderLike => ({ request: vi.fn(), tronWeb: live }),
    });

    await provider.signTransaction(TX);

    expect(live.trx.sign).toHaveBeenCalledWith(TX);
    expect(injected.trx.sign).not.toHaveBeenCalled();
  });

  it('browser: skips a TronWeb with no account and uses one that has one', async () => {
    const disconnected = makeTronWeb(false);
    const injected = makeTronWeb();
    const provider = new TronWalletProvider({
      tronWeb: injected,
      provider: { request: vi.fn(), tronWeb: disconnected },
    });

    await provider.signTransaction(TX);

    expect(disconnected.trx.sign).not.toHaveBeenCalled();
    expect(injected.trx.sign).toHaveBeenCalledWith(TX);
  });

  it('browser: tells the user to reconnect when no injected TronWeb has an account', async () => {
    const provider = new TronWalletProvider({ tronWeb: makeTronWeb(false), address: TRON_ADDRESS });
    await expect(provider.signTransaction(TX)).rejects.toThrow(/not connected .* Reconnect/);
  });
});

describe('TronWalletProvider.signMessage', () => {
  it('private key: signs the scheme-1 digest of the hash text, recoverable to the account', async () => {
    const signature = await new TronWalletProvider({ privateKey: PRIVATE_KEY }).signMessage(HASH);

    expect(signature).toMatch(/^0x[0-9a-f]{128}0[01]$/);
    await expect(recoverAddress({ hash: scheme1Digest(HASH), signature })).resolves.toBe(EVM_ADDRESS);
  });

  it('private key: signs the lowercased hash, so case does not change the digest', async () => {
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });
    const upper = `0x${HASH.slice(2).toUpperCase()}` as Hex;
    await expect(provider.signMessage(upper)).resolves.toBe(await provider.signMessage(HASH));
  });

  it('browser: uses signMessageV2 and returns a 0x-prefixed signature', async () => {
    const tronWeb = makeTronWeb();
    const signature = await new TronWalletProvider({ tronWeb }).signMessage(HASH);

    expect(tronWeb.trx.signMessageV2).toHaveBeenCalledWith(HASH);
    expect(signature).toBe('0xdeadbeef');
  });
});

describe('TronWalletProvider — node calls', () => {
  const signed: TronSignedTransaction = { ...TX, signature: ['sig'] };

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the configured endpoint, then defaults.rpcUrl, then TronGrid', async () => {
    const fetchMock = stubFetch({ '/wallet/broadcasttransaction': { result: true } });

    await new TronWalletProvider({ privateKey: PRIVATE_KEY, endpoint: 'https://a.example' }).sendTransaction(signed);
    await new TronWalletProvider({
      privateKey: PRIVATE_KEY,
      defaults: { rpcUrl: 'https://b.example' },
    }).sendTransaction(signed);
    await new TronWalletProvider({ privateKey: PRIVATE_KEY }).sendTransaction(signed);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://a.example/wallet/broadcasttransaction',
      'https://b.example/wallet/broadcasttransaction',
      'https://api.trongrid.io/wallet/broadcasttransaction',
    ]);
  });

  it('sendTransaction returns the txID on success and throws the node message on rejection', async () => {
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });

    stubFetch({ '/wallet/broadcasttransaction': { result: true } });
    await expect(provider.sendTransaction(signed)).resolves.toBe(TX.txID);

    stubFetch({ '/wallet/broadcasttransaction': { result: false, message: 'SIGERROR' } });
    await expect(provider.sendTransaction(signed)).rejects.toThrow(/Tron broadcast failed: SIGERROR/);
  });

  it('getBalance reads sun from getaccount and swallows failures as 0n', async () => {
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });

    stubFetch({ '/wallet/getaccount': { balance: 1_500_000 } });
    await expect(provider.getBalance(TRON_ADDRESS)).resolves.toBe(1_500_000n);

    stubFetch({}, false);
    await expect(provider.getBalance(TRON_ADDRESS)).resolves.toBe(0n);
  });

  it('waitForTransactionReceipt strips 0x and returns once the tx has a block number', async () => {
    const fetchMock = stubFetch({ '/wallet/gettransactioninfobyid': { id: TX.txID, blockNumber: 7 } });

    const receipt = await new TronWalletProvider({ privateKey: PRIVATE_KEY }).waitForTransactionReceipt(`0x${TX.txID}`);

    expect(receipt).toMatchObject({ blockNumber: 7 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { value: string };
    expect(body.value).toBe(TX.txID);
  });
});
