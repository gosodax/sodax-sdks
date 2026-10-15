/**
 * Tests for `XrpSpokeService` — the places that branch on token kind or that encode something the
 * relay/ledger will reject if it drifts.
 *
 * XRPL deposits ride the MPC relay in memo mode, like Tron, but the ledger-side shapes are what
 * matter here: an IOU Payment carries a currency/issuer amount OBJECT scaled to whole units while
 * native XRP carries a drops STRING, the memo is bare uppercase hex, and only `tesSUCCESS` counts
 * as an accept. Withdrawals use auth scheme 3 (raw ed25519 + submitted public key), which is the
 * one structural difference from Tron's scheme 1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { xrpCurrencyCode, xrpIdentityBytes } from './xrp-utils.js';

const sodax = new Sodax();
const xrp = sodax.spoke.xrp;

const XRP = 'xrp' as const;
const NATIVE_XRP = '0x0000000000000000000000000000000000000000';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const SENDER = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';
const RESERVE = 'rbtWzBnJB84fKuVCg2qbKKX4EUtCWVik7';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const MEMO = '0xb07ec4b9c2d410c84fb75cb2cf00122f6316cf191ae1fe7bec45ac203c5e13fd' as Hex;
const TX_HASH = 'A'.repeat(64);
const SIGNATURE = `0x${'ab'.repeat(64)}` as Hex;
// 33 bytes, 0xED-prefixed — the only shape scheme 3 accepts.
const PUBLIC_KEY = `0xed${'11'.repeat(32)}` as Hex;

/** 6 decimals on the spoke side, so 1 RLUSD is 1_000_000 base units. */
const AMOUNT = 20_000_000n;

type Call = { method: string; params: Record<string, unknown> };

let calls: Call[];

/** Stands in for rippled: records every JSON-RPC call and answers each method with its success shape. */
function stubRippled(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as { method: string; params: [Record<string, unknown>] };
      calls.push({ method, params: params[0] });

      const responses: Record<string, unknown> = {
        submit: { engine_result: 'tesSUCCESS', tx_json: { hash: TX_HASH } },
        account_info: { account_data: { Balance: '42000000' } },
        account_lines: {
          lines: [{ currency: xrpCurrencyCode('RLUSD'), account: RLUSD_ISSUER, balance: '1.5' }],
        },
        server_info: { info: { validated_ledger: { base_fee_xrp: 0.00001 } } },
        tx: { hash: TX_HASH, validated: true, meta: { TransactionResult: 'tesSUCCESS' } },
        ...overrides,
      };

      return { ok: true, json: async () => ({ result: responses[method] ?? {} }) } as unknown as Response;
    }),
  );
}

const walletProvider = {
  chainType: 'XRP',
  signTransaction: vi.fn(async () => ({ tx_blob: '1200002280000000', hash: TX_HASH })),
  signMessage: vi.fn(async () => SIGNATURE),
  getPublicKey: vi.fn(async () => PUBLIC_KEY),
} as never;

const depositParams = (token: string) =>
  ({
    srcChainKey: XRP,
    srcAddress: SENDER,
    to: HUB_WALLET,
    token,
    amount: AMOUNT,
    data: '0x' as Hex,
    walletProvider,
  }) as never;

const callTo = (method: string) => calls.find(c => c.method === method);

beforeEach(() => {
  calls = [];
  vi.spyOn(MpcRelayApiService, 'getDepositAddress').mockResolvedValue({
    ok: true,
    value: {
      reserveAddress: RESERVE,
      memo: MEMO,
      payloadHash: MEMO,
      path: 'm/0',
      hubWallet: HUB_WALLET,
      depositMethod: 'memo',
    },
  });
  vi.spyOn(MpcRelayApiService, 'notify').mockResolvedValue({ ok: true, value: { accepted: true } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('XrpSpokeService.deposit — native XRP', () => {
  it('sends drops as a string amount to the reserve, carrying the memo as bare uppercase hex', async () => {
    stubRippled();

    await xrp.deposit(depositParams(NATIVE_XRP));

    const signed = vi.mocked(walletProvider.signTransaction).mock.calls[0]?.[0];
    expect(signed).toMatchObject({
      TransactionType: 'Payment',
      Account: SENDER,
      Destination: RESERVE,
      Amount: AMOUNT.toString(),
    });
    // The relay matches the deposit on this memo: `0x`-prefixed or lowercase would not match.
    expect(signed?.Memos).toEqual([{ Memo: { MemoData: MEMO.slice(2).toUpperCase() } }]);
  });

  it('leaves Sequence, Fee and LastLedgerSequence to the wallet', async () => {
    stubRippled();

    await xrp.deposit(depositParams(NATIVE_XRP));

    // Pinning these races the wallet for the account Sequence, and GemWallet rejects a tx that sets them.
    const signed = vi.mocked(walletProvider.signTransaction).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(signed).not.toHaveProperty('Sequence');
    expect(signed).not.toHaveProperty('Fee');
    expect(signed).not.toHaveProperty('LastLedgerSequence');
  });

  it('returns the 0x-prefixed lowercase hash and notifies the relay with it', async () => {
    stubRippled();

    const hash = await xrp.deposit(depositParams(NATIVE_XRP));

    // XRPL reports bare uppercase hex; the relay API takes the 0x-prefixed lowercase form.
    expect(hash).toBe(`0x${TX_HASH.toLowerCase()}`);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '66', hash);
  });

  it('returns an unsigned descriptor in raw mode, touching no node', async () => {
    stubRippled();

    const raw = await xrp.deposit({ ...(depositParams(NATIVE_XRP) as object), raw: true } as never);

    expect(raw).toEqual({ from: SENDER, to: RESERVE, value: AMOUNT, data: MEMO, token: NATIVE_XRP });
    expect(calls).toHaveLength(0);
    expect(walletProvider.signTransaction).not.toHaveBeenCalled();
  });
});

describe('XrpSpokeService.deposit — IOU', () => {
  it('builds a currency/issuer amount object scaled to whole units, not base units', async () => {
    stubRippled();

    await xrp.deposit(depositParams(RLUSD_ISSUER));

    // 20_000_000 base units at 6 decimals is 20 RLUSD — sending "20000000" would move 10^6 too much.
    expect(vi.mocked(walletProvider.signTransaction).mock.calls[0]?.[0]).toMatchObject({
      Amount: { currency: xrpCurrencyCode('RLUSD'), issuer: RLUSD_ISSUER, value: '20' },
    });
  });

  it('renders a fractional amount without trailing zeros', async () => {
    stubRippled();

    await xrp.deposit({ ...(depositParams(RLUSD_ISSUER) as object), amount: 1_500_000n } as never);

    expect(vi.mocked(walletProvider.signTransaction).mock.calls[0]?.[0]).toMatchObject({
      Amount: expect.objectContaining({ value: '1.5' }),
    });
  });

  it('uses the 160-bit currency form for a symbol longer than 3 characters', async () => {
    stubRippled();

    await xrp.deposit(depositParams(RLUSD_ISSUER));

    const amount = (vi.mocked(walletProvider.signTransaction).mock.calls[0]?.[0] as { Amount: { currency: string } })
      .Amount;
    expect(amount.currency).toBe('524C555344000000000000000000000000000000');
  });

  it('rejects a token that is not in supportedTokens rather than sending to an unknown issuer', async () => {
    stubRippled();

    await expect(xrp.deposit(depositParams('rUnKnOwNiSsUeR000000000000000000000'))).rejects.toThrow(
      /unknown XRPL token/,
    );
  });
});

describe('XrpSpokeService.deposit — submit results', () => {
  it('treats a tec* applied-but-failed result as a failure and does not notify', async () => {
    stubRippled({ submit: { engine_result: 'tecUNFUNDED_PAYMENT', tx_json: { hash: TX_HASH } } });

    await expect(xrp.deposit(depositParams(NATIVE_XRP))).rejects.toThrow(
      new RegExp(`submit of ${TX_HASH} failed: tecUNFUNDED_PAYMENT`),
    );
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('keeps the signed tx hash in the error when the submit call itself fails', async () => {
    stubRippled();
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      if (method === 'submit') throw new Error('aborted');
      return answer ? answer(url, init) : Promise.reject(new Error('no stub'));
    });

    const failure = await xrp.deposit(depositParams(NATIVE_XRP)).catch((error: Error) => error);

    // A signed blob may still land after a lost response; the hash is the only way to find it.
    expect((failure as Error).message).toMatch(new RegExp(`submit of ${TX_HASH} failed or timed out`));
    expect(((failure as Error).cause as Error).message).toMatch(/aborted/);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('rejects a submit that reports success but returns no hash', async () => {
    stubRippled({ submit: { engine_result: 'tesSUCCESS' } });
    vi.mocked(walletProvider.signTransaction).mockResolvedValueOnce({ tx_blob: '1200002280000000' } as never);

    await expect(xrp.deposit(depositParams(NATIVE_XRP))).rejects.toThrow(/no transaction hash returned/);
  });

  it('uses the hash of a wallet that already submitted, without submitting again, and notifies', async () => {
    stubRippled();
    // GemWallet signs and submits in one step, so it hands back a hash and no blob.
    vi.mocked(walletProvider.signTransaction).mockResolvedValueOnce({ tx_blob: '', hash: TX_HASH } as never);

    const hash = await xrp.deposit(depositParams(NATIVE_XRP));

    expect(callTo('submit')).toBeUndefined();
    expect(hash).toBe(`0x${TX_HASH.toLowerCase()}`);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '66', hash);
  });

  it('rejects a wallet that returns neither a signed blob nor a hash before touching the node', async () => {
    stubRippled();
    vi.mocked(walletProvider.signTransaction).mockResolvedValueOnce({} as never);

    await expect(xrp.deposit(depositParams(NATIVE_XRP))).rejects.toThrow(/neither a signed blob nor a hash/);
    expect(callTo('submit')).toBeUndefined();
  });
});

describe('XrpSpokeService.waitForDeposit', () => {
  const HASH = `0x${TX_HASH.toLowerCase()}`;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-notifies the relay while waiting, since the first notify can precede validation', async () => {
    vi.useFakeTimers();
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    // Never resolves — the wait is what we are observing, not its outcome.
    vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockReturnValue(new Promise(() => undefined));

    void xrp.waitForDeposit(HASH);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(notifySpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(notifySpy).toHaveBeenCalledWith(expect.anything(), '66', HASH);
  });

  it('stops re-notifying once the wait settles', async () => {
    vi.useFakeTimers();
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue({
      ok: true,
      value: { depositId: 'id', status: 'minted', createdAt: 0, txs: {} },
    } as never);

    await xrp.waitForDeposit(HASH);
    notifySpy.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('XrpSpokeService.deposit — hub wallet assertion', () => {
  it('refuses a deposit whose target disagrees with the hub wallet the relay derives', async () => {
    stubRippled();
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue({
      ok: true,
      value: {
        reserveAddress: RESERVE,
        memo: MEMO,
        payloadHash: MEMO,
        path: 'm/0',
        hubWallet: '0x9999999999999999999999999999999999999999',
        depositMethod: 'memo',
      },
    });

    await expect(xrp.deposit(depositParams(NATIVE_XRP))).rejects.toThrow(/relay derives hub wallet/);
    expect(calls).toHaveLength(0);
  });
});

describe('XrpSpokeService.deposit — rotated reserve', () => {
  // XRPL SHARDS its reserve across lanes, and a payment to a retired lane is not credited — so the
  // relay's current address wins over the chain config, loudly rather than silently.
  it('pays the reserve the relay returned even when the chain config names another, and warns', async () => {
    const rotated = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8aFWuqm9';
    stubRippled();
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue({
      ok: true,
      value: {
        reserveAddress: rotated,
        memo: MEMO,
        payloadHash: MEMO,
        path: 'm/0',
        hubWallet: HUB_WALLET,
        depositMethod: 'memo',
      },
    });
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => undefined);

    await xrp.deposit(depositParams(NATIVE_XRP));

    expect(vi.mocked(walletProvider.signTransaction).mock.calls[0]?.[0]).toMatchObject({ Destination: rotated });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rotated));
  });
});

describe('XrpSpokeService.deposit — notify failure', () => {
  it('keeps the submitted tx hash in the error so the stranded deposit can be re-notified', async () => {
    // The retry waits between attempts; on real timers that is seconds and times out under load.
    vi.useFakeTimers();
    stubRippled();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = xrp.deposit(depositParams(NATIVE_XRP)).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    const failure = await pending;
    vi.useRealTimers();

    // The funds are already in the reserve here: an error without the hash would lose them.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/0x[0-9a-f]{64} submitted but the relay was not notified/);
    // Notifying twice is harmless, so the transient failure is retried before giving up.
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('XrpSpokeService.getDeposit', () => {
  it('reads the account balance in drops for native XRP', async () => {
    stubRippled();

    const balance = await xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: NATIVE_XRP } as never);

    expect(callTo('account_info')?.params).toMatchObject({ account: SENDER, ledger_index: 'validated' });
    expect(balance).toBe(42_000_000n);
  });

  it('scales an IOU trustline balance back to base units', async () => {
    stubRippled();

    const balance = await xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: RLUSD_ISSUER } as never);

    // "1.5" at 6 decimals is 1_500_000 base units.
    expect(balance).toBe(1_500_000n);
  });

  it('reports zero when the holder has no trustline for the currency', async () => {
    stubRippled({ account_lines: { lines: [] } });

    expect(await xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: RLUSD_ISSUER } as never)).toBe(0n);
  });

  it('does not credit a line from a different issuer with the same currency code', async () => {
    stubRippled({
      account_lines: {
        lines: [{ currency: xrpCurrencyCode('RLUSD'), account: 'rImPoStErIsSuEr00000000000000000000', balance: '99' }],
      },
    });

    expect(await xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: RLUSD_ISSUER } as never)).toBe(0n);
  });
});

describe('XrpSpokeService.checkDestination', () => {
  const USDC_ISSUER = 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';
  const usdcLine = (balance: string, limit: string) => ({
    lines: [{ currency: xrpCurrencyCode('USDC'), account: USDC_ISSUER, balance, limit }],
  });
  const check = (token: string, amount = 1_000_000n) => xrp.checkDestination({ address: SENDER, token, amount });

  it('accepts native XRP to an existing account', async () => {
    stubRippled();

    expect(await check(NATIVE_XRP)).toEqual({ ready: true });
  });

  it('reports a destination account that does not exist on the ledger', async () => {
    stubRippled({ account_info: { error: 'actNotFound', error_message: 'Account not found.' } });

    // A native release below the base reserve, and any IOU release, cannot create the account.
    expect(await check(NATIVE_XRP)).toEqual({ ready: false, reason: 'account_not_found' });
    expect(await check(USDC_ISSUER)).toEqual({ ready: false, reason: 'account_not_found' });
  });

  it('reports an IOU destination with no trustline to the issuer', async () => {
    stubRippled({ account_lines: { lines: [] } });

    expect(await check(USDC_ISSUER)).toEqual({ ready: false, reason: 'no_trustline' });
    // Filtering by issuer keeps a holder with many lines from being paged past the one that matters.
    expect(callTo('account_lines')?.params).toMatchObject({ account: SENDER, peer: USDC_ISSUER });
  });

  it('does not accept a trustline to the same currency from a different issuer', async () => {
    stubRippled({
      account_lines: {
        lines: [{ currency: xrpCurrencyCode('USDC'), account: RLUSD_ISSUER, balance: '0', limit: '1000' }],
      },
    });

    expect(await check(USDC_ISSUER)).toEqual({ ready: false, reason: 'no_trustline' });
  });

  it('reports a trustline whose limit has no room for the amount', async () => {
    stubRippled({ account_lines: usdcLine('9.5', '10') });

    expect(await check(USDC_ISSUER, 1_000_000n)).toEqual({ ready: false, reason: 'trustline_limit' });
  });

  it('accepts an IOU destination whose trustline has room for the amount', async () => {
    stubRippled({ account_lines: usdcLine('9', '10') });

    expect(await check(USDC_ISSUER, 1_000_000n)).toEqual({ ready: true });
  });

  it('surfaces a node failure rather than treating it as a missing account', async () => {
    stubRippled({ account_info: { error: 'tooBusy', error_message: 'The server is too busy.' } });

    await expect(check(NATIVE_XRP)).rejects.toThrow(/tooBusy/);
  });
});

describe('XrpSpokeService.estimateGas', () => {
  const gasParams = {
    chainKey: XRP,
    tx: { from: SENDER, to: RESERVE, value: AMOUNT, data: MEMO, token: NATIVE_XRP },
  } as const;

  it('reports the ledger base fee in drops', async () => {
    stubRippled();

    const estimate = await xrp.estimateGas(gasParams);

    // 0.00001 XRP is 10 drops — XRPL charges a flat fee, so there is no gas/limit pair.
    expect(estimate).toEqual({ fee: 10n });
  });

  it('rounds a fractional drop up rather than truncating below the ledger minimum', async () => {
    stubRippled({ server_info: { info: { validated_ledger: { base_fee_xrp: 0.0000125 } } } });

    expect((await xrp.estimateGas(gasParams)).fee).toBe(13n);
  });

  it('does not depend on the transaction, since the fee is flat rather than metered', async () => {
    stubRippled();

    const iou = { ...gasParams, tx: { ...gasParams.tx, token: RLUSD_ISSUER } };
    expect(await xrp.estimateGas(iou)).toEqual(await xrp.estimateGas(gasParams));
  });

  it('rejects a node that cannot report its fee', async () => {
    stubRippled({ server_info: { info: {} } });

    await expect(xrp.estimateGas(gasParams)).rejects.toThrow(/no base_fee_xrp/);
  });
});

describe('XrpSpokeService.sendMessage', () => {
  const sendParams = {
    srcChainKey: XRP,
    srcAddress: SENDER,
    dstChainKey: 'sonic',
    dstAddress: HUB_WALLET,
    payload: '0xdeadbeef' as Hex,
    walletProvider,
  } as never;

  const submitCall = (call: number) => vi.mocked(MpcRelayApiService.submitWithdraw).mock.calls[call]?.[1];

  beforeEach(() => {
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: MEMO },
    });
  });

  it('submits scheme 3 with the public key, since ed25519 cannot recover its signer', async () => {
    const trackingId = await xrp.sendMessage(sendParams);

    expect(submitCall(0)).toMatchObject({ scheme: 3, signature: SIGNATURE, publicKey: PUBLIC_KEY });
    expect(trackingId).toBe(MEMO);
  });

  it('identifies the sender by AccountID rather than public key', async () => {
    await xrp.sendMessage(sendParams);

    // The contract derives ripemd160(sha256(pubkey)) and compares it to `sender` — the two are
    // different values and are not interchangeable.
    expect(submitCall(0)?.message.sender).toBe(xrpIdentityBytes(SENDER));
    expect(submitCall(0)?.message.sender).not.toBe(PUBLIC_KEY);
  });

  it('uses the relay chain id, not the hub chain id', async () => {
    await xrp.sendMessage(sendParams);

    expect(submitCall(0)?.message.chainId).toBe('66');
  });

  it('draws a fresh random nonce per withdrawal rather than reading the clock', async () => {
    await xrp.sendMessage(sendParams);
    await xrp.sendMessage(sendParams);

    // Two withdrawals in the same millisecond must not collide — a clock-derived nonce would.
    const nonces = [0, 1].map(i => BigInt(submitCall(i)?.message.nonce ?? '0'));
    expect(nonces[0]).not.toBe(nonces[1]);
    for (const nonce of nonces) {
      expect(nonce).toBeGreaterThan(0n);
      expect(nonce).toBeLessThan(2n ** 64n);
    }
  });

  it('keeps the nonce inside the safe-integer range the relay round-trips it through', async () => {
    // The relay converts the nonce to a JS number before the NEAR call, so a value above
    // MAX_SAFE_INTEGER reaches the contract rounded and the signature no longer verifies.
    for (let i = 0; i < 32; i++) {
      await xrp.sendMessage(sendParams);
      const nonce = BigInt(submitCall(i)?.message.nonce ?? '0');
      expect(nonce).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
      expect(BigInt(Number(nonce))).toBe(nonce);
    }
  });

  it('refuses raw mode, which has no spoke transaction to return', async () => {
    await expect(xrp.sendMessage({ ...(sendParams as object), raw: true } as never)).rejects.toThrow(
      /raw mode is not supported/,
    );
  });
});

describe('XrpSpokeService.waitForTransactionReceipt', () => {
  const receiptParams = { txHash: `0x${TX_HASH.toLowerCase()}`, chainKey: XRP, pollingIntervalMs: 1 } as never;

  it('queries rippled with the bare uppercase hash XRPL expects', async () => {
    stubRippled();

    await xrp.waitForTransactionReceipt(receiptParams);

    expect(callTo('tx')?.params).toMatchObject({ transaction: TX_HASH, binary: false });
  });

  it('reports success only for a validated tesSUCCESS transaction', async () => {
    stubRippled();

    const result = await xrp.waitForTransactionReceipt(receiptParams);

    expect(result).toMatchObject({ ok: true, value: { status: 'success', receipt: { hash: TX_HASH } } });
  });

  it('reports a validated non-tesSUCCESS result as a failure', async () => {
    stubRippled({ tx: { hash: TX_HASH, validated: true, meta: { TransactionResult: 'tecPATH_DRY' } } });

    const result = await xrp.waitForTransactionReceipt(receiptParams);

    expect(result).toMatchObject({ ok: true, value: { status: 'failure' } });
  });

  it('keeps polling an unvalidated result, which can still change', async () => {
    stubRippled({ tx: { hash: TX_HASH, validated: false, meta: { TransactionResult: 'tesSUCCESS' } } });

    const result = await xrp.waitForTransactionReceipt({ ...(receiptParams as object), maxTimeoutMs: 3 } as never);

    expect(result).toMatchObject({ ok: true, value: { status: 'timeout' } });
  });
});

describe('XrpSpokeService — node request budget', () => {
  it('reports a stalled node as a timeout instead of hanging', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abort;
      }),
    );

    await expect(xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: NATIVE_XRP } as never)).rejects.toThrow(
      /timed out after \d+ms/,
    );
  });

  it('surfaces a rippled error payload rather than treating it as a result', async () => {
    stubRippled({ account_info: { error: 'actNotFound', error_message: 'Account not found.' } });

    await expect(xrp.getDeposit({ srcChainKey: XRP, srcAddress: SENDER, token: NATIVE_XRP } as never)).rejects.toThrow(
      /actNotFound/,
    );
  });
});
