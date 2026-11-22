import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concat, keccak256, recoverAddress, sha256, stringToBytes, toBytes, type Hex } from 'viem';
import type { TronRawTransaction, TronSignedTransaction, TronUnsignedTransaction } from '@sodax/types';
import { TronWalletProvider } from './TronWalletProvider.js';
import type { TronProviderLike, TronWebLike } from './types.js';

// Hardhat/Anvil account #0 — a public test key, never funded on mainnet.
const PRIVATE_KEY = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EVM_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// base58check(0x41 ‖ EVM_ADDRESS), derived independently of the provider.
const TRON_ADDRESS = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
const OTHER_ADDRESS = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';

// txID is sha256 of the raw_data_hex bytes, computed outside the provider.
const TX: TronUnsignedTransaction = {
  txID: '10e3bd490fb65f1b4416c2e861a45dc1ac46ae9b62eca48e2f0c1c14fa0c583e',
  raw_data_hex: '0a02abcd',
  visible: false,
};
const HASH: Hex = `0x${'cd'.repeat(32)}`;
// The same transaction as a raw deposit hands it out: with its decoded body, expiring in ten minutes.
const RAW_TX: TronRawTransaction = { ...TX, raw_data: { contract: [], expiration: Date.now() + 600_000 } };

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

  it('private key: accepts an uppercase txID that matches the bytes', async () => {
    const signed = await new TronWalletProvider({ privateKey: PRIVATE_KEY }).signTransaction({
      ...TX,
      txID: TX.txID.toUpperCase(),
    });
    await expect(recoverAddress({ hash: `0x${TX.txID}`, signature: `0x${signed.signature[0]}` })).resolves.toBe(
      EVM_ADDRESS,
    );
  });

  it('private key: refuses a txID that is not sha256(raw_data_hex)', async () => {
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });
    await expect(provider.signTransaction({ ...TX, txID: 'ab'.repeat(32) })).rejects.toThrow(
      /is not sha256\(raw_data_hex\)/,
    );
    await expect(provider.signTransaction({ ...TX, raw_data_hex: '0a02abce' })).rejects.toThrow(
      /is not sha256\(raw_data_hex\)/,
    );
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

  it('browser: refuses a txID that is not sha256(raw_data_hex) before the wallet signs', async () => {
    const tronWeb = makeTronWeb();

    await expect(new TronWalletProvider({ tronWeb }).signTransaction({ ...TX, txID: 'ff'.repeat(32) })).rejects.toThrow(
      /is not sha256\(raw_data_hex\)/,
    );
    expect(tronWeb.trx.sign).not.toHaveBeenCalled();
  });

  it('browser: built from getProvider alone, signs with a wallet discovered after construction', async () => {
    let discovered: TronProviderLike | undefined;
    const provider = new TronWalletProvider({ getProvider: () => discovered, address: TRON_ADDRESS });

    await expect(provider.getWalletAddress()).resolves.toBe(TRON_ADDRESS);
    await expect(provider.signTransaction(TX)).rejects.toThrow(
      /no Tron wallet found to sign with\. Unlock it, or reconnect it/,
    );

    const live = makeTronWeb();
    discovered = { request: vi.fn(), tronWeb: live };
    await provider.signTransaction(TX);
    expect(live.trx.sign).toHaveBeenCalledWith(TX);
  });

  it('browser: asks a wallet with no account for one, then signs, as after a reload or an unlock', async () => {
    const tronWeb = makeTronWeb(false);
    const request = vi.fn(async () => {
      tronWeb.defaultAddress = { base58: TRON_ADDRESS };
      return [TRON_ADDRESS];
    });
    const provider = new TronWalletProvider({ getProvider: () => ({ request, tronWeb }), address: TRON_ADDRESS });

    await provider.signTransaction(TX);

    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
    expect(tronWeb.trx.sign).toHaveBeenCalledWith(TX);
  });

  it('browser: passes on the wallet refusing to connect, without signing', async () => {
    const tronWeb = makeTronWeb(false);
    const rejected = Object.assign(new Error('User rejected'), { code: 4001 });
    const provider = new TronWalletProvider({
      getProvider: () => ({ request: vi.fn().mockRejectedValue(rejected), tronWeb }),
      address: TRON_ADDRESS,
    });

    await expect(provider.signTransaction(TX)).rejects.toBe(rejected);
    expect(tronWeb.trx.sign).not.toHaveBeenCalled();
  });

  it('browser: tells the user to reconnect when no injected TronWeb has an account', async () => {
    const provider = new TronWalletProvider({ tronWeb: makeTronWeb(false), address: TRON_ADDRESS });
    await expect(provider.signTransaction(TX)).rejects.toThrow(/locked or not connected\. Unlock it, or reconnect it/);
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

describe('TronWalletProvider.signAndSendTransaction', () => {
  const broadcastBody = (fetchMock: ReturnType<typeof stubFetch>) =>
    (JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { transaction: string }).transaction;

  it('private key: broadcasts the signed raw bytes as hex and returns their txID', async () => {
    const fetchMock = stubFetch({ '/wallet/broadcasthex': { result: true } });
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });
    const [signature] = (await provider.signTransaction(RAW_TX)).signature;

    const txID = await provider.signAndSendTransaction(RAW_TX);

    expect(txID).toBe(TX.txID);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.trongrid.io/wallet/broadcasthex');
    // Field 1 (`0a`, 4 bytes) then field 2 (`12`, 65 bytes = `41`): the bytes the key signed, unchanged.
    expect(broadcastBody(fetchMock)).toBe(`0a04${TX.raw_data_hex}1241${signature}`);
  });

  it('browser: encodes a raw body over 127 bytes with a two-byte length, and every signature returned', async () => {
    const fetchMock = stubFetch({ '/wallet/broadcasthex': { result: true } });
    const raw = 'ab'.repeat(200);
    const tronWeb = makeTronWeb();
    // A multi-signature account's wallet returns one signature per signer, with or without `0x`.
    vi.mocked(tronWeb.trx.sign).mockImplementation(async tx => ({
      ...tx,
      signature: ['cd'.repeat(65), `0x${'ef'.repeat(65)}`],
    }));

    await new TronWalletProvider({ tronWeb }).signAndSendTransaction({
      ...RAW_TX,
      txID: sha256(`0x${raw}`).slice(2),
      raw_data_hex: raw,
    });

    // 200 = 0xc8: varint `c8 01`; each 65-byte signature is its own field 2.
    expect(broadcastBody(fetchMock)).toBe(`0ac801${raw}1241${'cd'.repeat(65)}1241${'ef'.repeat(65)}`);
  });

  it('refuses a transaction without raw_data, which a browser wallet signs from', async () => {
    const tronWeb = makeTronWeb();

    // A raw tx parsed from JSON can arrive without the field the type requires.
    await expect(new TronWalletProvider({ tronWeb }).signAndSendTransaction(TX as TronRawTransaction)).rejects.toThrow(
      /carries no raw_data/,
    );
    expect(tronWeb.trx.sign).not.toHaveBeenCalled();
  });

  it('refuses a wallet that returns no signature, without broadcasting', async () => {
    const fetchMock = stubFetch({ '/wallet/broadcasthex': { result: true } });
    const tronWeb = makeTronWeb();
    vi.mocked(tronWeb.trx.sign).mockImplementation(async tx => ({ ...tx, signature: [] }));

    await expect(new TronWalletProvider({ tronWeb }).signAndSendTransaction(RAW_TX)).rejects.toThrow(/no signature/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws the node message when the broadcast is rejected, e.g. for an expired transaction', async () => {
    // The node checks `raw_data.expiration` against its own head block, so the wallet leaves that to it.
    stubFetch({ '/wallet/broadcasthex': { result: false, message: 'TRANSACTION_EXPIRATION_ERROR' } });

    await expect(new TronWalletProvider({ privateKey: PRIVATE_KEY }).signAndSendTransaction(RAW_TX)).rejects.toThrow(
      /Tron broadcast failed: TRANSACTION_EXPIRATION_ERROR/,
    );
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

  it('getBalance reads sun from getaccount, and 0n when the account has no balance field', async () => {
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });

    stubFetch({ '/wallet/getaccount': { balance: 1_500_000 } });
    await expect(provider.getBalance(TRON_ADDRESS)).resolves.toBe(1_500_000n);

    // What TronGrid answers for an unactivated account.
    stubFetch({ '/wallet/getaccount': {} });
    await expect(provider.getBalance(TRON_ADDRESS)).resolves.toBe(0n);
  });

  it('getBalance rejects a failed read instead of reporting 0n', async () => {
    const provider = new TronWalletProvider({ privateKey: PRIVATE_KEY });

    stubFetch({}, false);
    await expect(provider.getBalance(TRON_ADDRESS)).rejects.toThrow('tron rpc /wallet/getaccount: 500');

    // TronGrid's HTTP 200 answer to a malformed address.
    stubFetch({
      '/wallet/getaccount': {
        Error:
          'class org.tron.core.services.http.JsonFormat$ParseException : 1:12: invalid address for field: protocol.Account.address',
      },
    });
    await expect(provider.getBalance('TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaH')).rejects.toThrow(/invalid address/);
  });

  it('waitForTransactionReceipt strips 0x and returns once the tx has a block number', async () => {
    const fetchMock = stubFetch({ '/wallet/gettransactioninfobyid': { id: TX.txID, blockNumber: 7 } });

    const receipt = await new TronWalletProvider({ privateKey: PRIVATE_KEY }).waitForTransactionReceipt(`0x${TX.txID}`);

    expect(receipt).toMatchObject({ blockNumber: 7 });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { value: string };
    expect(body.value).toBe(TX.txID);
  });
});
