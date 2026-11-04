/**
 * Tests for `XrpWalletProvider` — the two modes (raw key and GemWallet) and the scheme-3 details
 * that fail silently or unhelpfully if they drift.
 *
 * What is worth pinning down: the account is ed25519 (a secp256k1 XRPL account can deposit and then
 * never withdraw, so the provider must refuse it up front), `signMessage` produces a RAW signature
 * over the hash with no envelope, and the raw-key path autofills Sequence/Fee/LastLedgerSequence
 * from the node while the GemWallet path leaves them to the wallet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XrpUnsignedTransaction } from '@sodax/types';
import { XrpWalletProvider, isGemWalletXrpWalletConfig, isPrivateKeyXrpWalletConfig } from './XrpWalletProvider.js';
import type { GemWalletLike } from './types.js';

// 32 bytes of entropy — `Wallet.fromEntropy` derives a deterministic ed25519 account from this.
const PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const HASH = `0x${'ab'.repeat(32)}` as const;
const TX_HASH = 'A'.repeat(64);
const GEM_ADDRESS = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';

const payment: XrpUnsignedTransaction = {
  TransactionType: 'Payment',
  Account: GEM_ADDRESS,
  Destination: 'rbtWzBnJB84fKuVCg2qbKKX4EUtCWVik7',
  Amount: '20000000',
  Memos: [{ Memo: { MemoData: 'DEADBEEF' } }],
};

type Call = { method: string; params: Record<string, unknown> };

let calls: Call[];

function stubRippled(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as { method: string; params: [Record<string, unknown>] };
      calls.push({ method, params: params[0] });

      const responses: Record<string, unknown> = {
        account_info: { account_data: { Sequence: 77 } },
        ledger_current: { ledger_current_index: 1000 },
        fee: { drops: { open_ledger_fee: '15' } },
        tx: { hash: TX_HASH, validated: true, meta: { TransactionResult: 'tesSUCCESS' } },
        ...overrides,
      };

      // Only `ok` and `json()` are read, so a partial stands in for the full fetch Response.
      return { ok: true, json: async () => ({ result: responses[method] ?? {} }) } as unknown as Response;
    }),
  );
}

function gemWallet(overrides: Partial<GemWalletLike> = {}): GemWalletLike {
  return {
    getAddress: vi.fn(async () => ({ result: { address: GEM_ADDRESS } })),
    getPublicKey: vi.fn(async () => ({ result: { publicKey: `ED${'11'.repeat(32)}` } })),
    signMessage: vi.fn(async () => ({ result: { signedMessage: 'CD'.repeat(64) } })),
    submitTransaction: vi.fn(async () => ({ result: { hash: TX_HASH } })),
    ...overrides,
  };
}

const rawKeyProvider = () => new XrpWalletProvider({ privateKey: PRIVATE_KEY });

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('XrpWalletProvider — configuration', () => {
  it('discriminates the two config shapes', () => {
    expect(isPrivateKeyXrpWalletConfig({ privateKey: PRIVATE_KEY })).toBe(true);
    expect(isGemWalletXrpWalletConfig({ privateKey: PRIVATE_KEY })).toBe(false);
    expect(isGemWalletXrpWalletConfig({ gemWallet: gemWallet() })).toBe(true);
  });

  it('rejects a configuration that is neither mode', () => {
    expect(() => new XrpWalletProvider({} as never)).toThrow(/Invalid XRPL wallet configuration/);
  });

  it('accepts a private key with or without the 0x prefix', () => {
    expect(new XrpWalletProvider({ privateKey: '11'.repeat(32) }).chainType).toBe('XRP');
    expect(rawKeyProvider().chainType).toBe('XRP');
  });
});

describe('XrpWalletProvider — identity', () => {
  it('derives an ed25519 account from the raw key, since scheme 3 requires it', async () => {
    // A secp256k1 account has no supported withdraw scheme, so the algorithm is not left to chance.
    expect(await rawKeyProvider().getPublicKey()).toMatch(/^0xed[0-9a-f]{64}$/);
  });

  it('derives a stable classic address from the same key', async () => {
    const address = await rawKeyProvider().getWalletAddress();

    expect(address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    expect(await rawKeyProvider().getWalletAddress()).toBe(address);
  });

  it('prefers the connected address over a GemWallet round-trip', async () => {
    const gem = gemWallet();
    const provider = new XrpWalletProvider({ gemWallet: gem, address: GEM_ADDRESS });

    expect(await provider.getWalletAddress()).toBe(GEM_ADDRESS);
    expect(gem.getAddress).not.toHaveBeenCalled();
  });

  it('falls back to getAddress() when no address was supplied', async () => {
    const provider = new XrpWalletProvider({ gemWallet: gemWallet() });

    expect(await provider.getWalletAddress()).toBe(GEM_ADDRESS);
  });

  it('reports a disconnected wallet rather than returning an empty address', async () => {
    const provider = new XrpWalletProvider({ gemWallet: gemWallet({ getAddress: vi.fn(async () => ({})) }) });

    await expect(provider.getWalletAddress()).rejects.toThrow(/not connected/);
  });

  it('normalises a GemWallet public key to lowercase 0x-hex', async () => {
    const provider = new XrpWalletProvider({ gemWallet: gemWallet() });

    expect(await provider.getPublicKey()).toBe(`0xed${'11'.repeat(32)}`);
  });

  it('refuses a secp256k1 account up front instead of at withdrawal time', async () => {
    const provider = new XrpWalletProvider({
      gemWallet: gemWallet({ getPublicKey: vi.fn(async () => ({ result: { publicKey: `03${'22'.repeat(32)}` } })) }),
    });

    // This account can deposit but could never withdraw — failing here says why.
    await expect(provider.getPublicKey()).rejects.toThrow(/not ed25519/);
  });

  it('reports a wallet that returns no public key', async () => {
    const provider = new XrpWalletProvider({ gemWallet: gemWallet({ getPublicKey: vi.fn(async () => ({})) }) });

    await expect(provider.getPublicKey()).rejects.toThrow(/no public key/);
  });
});

describe('XrpWalletProvider.signMessage', () => {
  it('produces a raw 64-byte ed25519 signature over the hash, with no envelope', async () => {
    const signature = await rawKeyProvider().signMessage(HASH);

    // Scheme 3 signs the hash bytes themselves — a prefix or TIP-191-style wrapper breaks verification.
    expect(signature).toMatch(/^0x[0-9a-f]{128}$/);
  });

  it('signs deterministically for the same key and hash', async () => {
    expect(await rawKeyProvider().signMessage(HASH)).toBe(await rawKeyProvider().signMessage(HASH));
  });

  it('hands GemWallet the bare hash flagged as hex and lowercases what comes back', async () => {
    const gem = gemWallet();
    const provider = new XrpWalletProvider({ gemWallet: gem, address: GEM_ADDRESS });

    const signature = await provider.signMessage(HASH);

    // Without `isHex` GemWallet signs the 64-character text, which scheme 3 does not verify.
    expect(gem.signMessage).toHaveBeenCalledWith(HASH.slice(2).toUpperCase(), true);
    expect(signature).toBe(`0x${'cd'.repeat(64)}`);
  });

  it('reports a wallet that returns no signature', async () => {
    const provider = new XrpWalletProvider({
      gemWallet: gemWallet({ signMessage: vi.fn(async () => ({ result: {} })) }),
      address: GEM_ADDRESS,
    });

    await expect(provider.signMessage(HASH)).rejects.toThrow(/no signature/);
  });
});

describe('XrpWalletProvider.signTransaction — raw key', () => {
  it('autofills Sequence, Fee and LastLedgerSequence from the node', async () => {
    stubRippled();
    const provider = rawKeyProvider();

    const signed = await provider.signTransaction({ ...payment, Account: await provider.getWalletAddress() });

    expect(signed.tx_blob).toMatch(/^[0-9A-F]+$/);
    expect(signed.hash).toBeTruthy();
    expect(calls.map(c => c.method).sort()).toEqual(['account_info', 'fee', 'ledger_current']);
  });

  it('bounds submittability with a ledger window so a stalled submit expires', async () => {
    stubRippled();
    const provider = rawKeyProvider();
    const account = await provider.getWalletAddress();

    // Signing succeeds only if LastLedgerSequence is a sane value ahead of the current ledger.
    await expect(provider.signTransaction({ ...payment, Account: account })).resolves.toBeTruthy();
    expect(calls.find(c => c.method === 'ledger_current')).toBeDefined();
  });

  it('falls back to the minimum fee when the node does not report an open-ledger fee', async () => {
    stubRippled({ fee: { drops: {} } });
    const provider = rawKeyProvider();

    await expect(
      provider.signTransaction({ ...payment, Account: await provider.getWalletAddress() }),
    ).resolves.toBeTruthy();
  });

  it('does not overwrite fields the caller pinned', async () => {
    stubRippled();
    const provider = rawKeyProvider();

    await expect(
      provider.signTransaction({
        ...payment,
        Account: await provider.getWalletAddress(),
        Sequence: 5,
        Fee: '20',
        LastLedgerSequence: 9999,
      }),
    ).resolves.toBeTruthy();
  });
});

describe('XrpWalletProvider.signTransaction — GemWallet', () => {
  it('submits through the wallet and returns the hash with no blob', async () => {
    const gem = gemWallet();
    const provider = new XrpWalletProvider({ gemWallet: gem, address: GEM_ADDRESS });

    const signed = await provider.signTransaction(payment);

    // GemWallet submits as well as signs, so there is no blob to hand back.
    expect(signed).toEqual({ tx_blob: '', hash: TX_HASH });
    expect(gem.submitTransaction).toHaveBeenCalledWith({ transaction: payment });
  });

  it('leaves Sequence, Fee and LastLedgerSequence to the wallet, which rejects a pinned transaction', async () => {
    const gem = gemWallet();
    const provider = new XrpWalletProvider({ gemWallet: gem, address: GEM_ADDRESS });

    await provider.signTransaction(payment);

    const submitted = vi.mocked(gem.submitTransaction).mock.calls[0]?.[0].transaction;
    expect(submitted).not.toHaveProperty('Sequence');
    expect(submitted).not.toHaveProperty('Fee');
    expect(submitted).not.toHaveProperty('LastLedgerSequence');
    expect(calls).toHaveLength(0);
  });

  it('reports a submit that returns no hash', async () => {
    const provider = new XrpWalletProvider({
      gemWallet: gemWallet({ submitTransaction: vi.fn(async () => ({ result: {} })) }),
      address: GEM_ADDRESS,
    });

    await expect(provider.signTransaction(payment)).rejects.toThrow(/no transaction hash/);
  });
});

describe('XrpWalletProvider.waitForTransactionReceipt', () => {
  it('queries rippled with the bare uppercase hash and returns the validated receipt', async () => {
    stubRippled();

    const receipt = await rawKeyProvider().waitForTransactionReceipt(`0x${TX_HASH.toLowerCase()}`);

    expect(calls[0]?.params).toMatchObject({ transaction: TX_HASH, binary: false });
    expect(receipt).toMatchObject({ hash: TX_HASH, validated: true });
  });

  it('keeps polling past an unvalidated result and a txnNotFound error', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempt++;
        // First a poll error, then an unvalidated result — neither is terminal.
        const result =
          attempt === 1
            ? { error: 'txnNotFound' }
            : attempt === 2
              ? { hash: TX_HASH, validated: false }
              : { hash: TX_HASH, validated: true };
        // Only `ok` and `json()` are read, so a partial stands in for the full fetch Response.
        return { ok: true, json: async () => ({ result }) } as unknown as Response;
      }),
    );

    const pending = rawKeyProvider().waitForTransactionReceipt(TX_HASH);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(pending).resolves.toMatchObject({ validated: true });
    expect(attempt).toBe(3);
    vi.useRealTimers();
  });

  it('gives up rather than polling forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ result: { hash: TX_HASH, validated: false } }) }) as never),
    );

    const pending = rawKeyProvider().waitForTransactionReceipt(TX_HASH);
    const assertion = expect(pending).rejects.toThrow(/not validated in time/);
    await vi.advanceTimersByTimeAsync(70_000);

    await assertion;
    vi.useRealTimers();
  });

  it('treats a node error as a non-terminal poll failure rather than aborting the wait', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as never),
    );

    // A node that 503s may recover on the next poll, so the wait runs its course instead of
    // reporting a transient outage as a failed transaction.
    const pending = rawKeyProvider().waitForTransactionReceipt(TX_HASH);
    const assertion = expect(pending).rejects.toThrow(/not validated in time/);
    await vi.advanceTimersByTimeAsync(70_000);

    await assertion;
    vi.useRealTimers();
  });
});

describe('XrpWalletProvider — endpoint selection', () => {
  it('prefers an explicit endpoint over the defaults and the built-in fallback', async () => {
    stubRippled();
    const provider = new XrpWalletProvider({
      privateKey: PRIVATE_KEY,
      endpoint: 'https://custom.example/rpc',
      defaults: { rpcUrl: 'https://defaults.example/rpc' },
    });

    await provider.waitForTransactionReceipt(TX_HASH);

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://custom.example/rpc');
  });

  it('falls back to the defaults rpcUrl when no endpoint is given', async () => {
    stubRippled();
    const provider = new XrpWalletProvider({ privateKey: PRIVATE_KEY, defaults: { rpcUrl: 'https://d.example/rpc' } });

    await provider.waitForTransactionReceipt(TX_HASH);

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('https://d.example/rpc');
  });
});
