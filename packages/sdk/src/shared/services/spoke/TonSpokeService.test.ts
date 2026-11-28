/**
 * Tests for `TonSpokeService` — TON over the MPC relay in memo mode, addressed by public key.
 *
 * What must not drift: the relay owner and withdraw sender are the PUBLIC KEY, a native deposit carries
 * the memo as a comment while a jetton carries it in `forward_payload` with enough TON forwarded to notify
 * the reserve, the deposit hash is the RESERVE transaction found by memo (TonConnect returns none), and
 * withdrawals submit scheme 5 with the key and the signData envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Address, beginCell, Cell } from '@ton/core';
import { UserRejectsError } from '@tonconnect/sdk';
import { isIndeterminateOutcomeError, tonSupportedTokens, type Hex } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { concat, keccak256, toHex } from 'viem';
import { computePayloadHash } from '../mpcRelay/MpcRelayApiService.js';
import { buildTonCommentBody, tonWalletAddress } from './ton-utils.js';

let sodax = new Sodax();
let ton = sodax.spoke.ton;

const TON = 'ton' as const;
const NATIVE_TON = '0x0000000000000000000000000000000000000000';
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const PUBKEY = `0x${'07'.repeat(32)}` as Hex;
const RESERVE = '0:2a7f65800a2ebe06fa227e7f29cd188d5c3e39d0566d8646c8c73104417a6a97';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const MEMO = computePayloadHash(HUB_WALLET, '0x');
const SENDER_ADDRESS = tonWalletAddress(PUBKEY).toString({ bounceable: false });
const SENDER_JETTON_WALLET = tonWalletAddress(`0x${'09'.repeat(32)}`);
const RESERVE_JETTON_WALLET = tonWalletAddress(`0x${'08'.repeat(32)}`);
const RESERVE_TX_HASH = Buffer.from('cd'.repeat(32), 'hex').toString('base64');

type Call = { method: string; params: Record<string, unknown> };
let calls: Call[];

/** A toncenter transaction on the reserve, carrying `memo` as a native comment. */
const nativeTx = (lt: string, memo: string, hash = RESERVE_TX_HASH) => ({
  transaction_id: { lt, hash },
  in_msg: {
    source: SENDER_ADDRESS,
    value: '2000000',
    msg_data: { text: Buffer.from(memo.slice(2), 'hex').toString('base64') },
  },
});

/** A toncenter transaction on the reserve carrying `memo` in a jetton transfer_notification. */
const jettonTx = (lt: string, memo: string, amount = 2_000_000n, sender = SENDER_ADDRESS, hash = RESERVE_TX_HASH) => ({
  transaction_id: { lt, hash },
  in_msg: {
    source: RESERVE_JETTON_WALLET.toString(),
    msg_data: {
      body: beginCell()
        .storeUint(0x7362d09c, 32)
        .storeUint(0n, 64)
        .storeCoins(amount)
        .storeAddress(Address.parse(sender))
        .storeBit(1)
        .storeRef(buildTonCommentBody(memo))
        .endCell()
        .toBoc()
        .toString('base64'),
    },
  },
});

/** Stands in for toncenter: records every call and answers each method with its success shape. */
function stubToncenter(opts: { baselineLt?: string; txs?: unknown[] } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as Call;
      calls.push({ method, params });
      let result: unknown;
      if (method === 'getTransactions') {
        result =
          params.limit === 1 ? [{ transaction_id: { lt: opts.baselineLt ?? '100', hash: 'x' } }] : (opts.txs ?? []);
      } else if (method === 'runGetMethod') {
        result = {
          exit_code: 0,
          stack: [
            [
              'cell',
              {
                bytes: beginCell()
                  .storeAddress(
                    JSON.stringify(params.stack).includes(
                      beginCell().storeAddress(Address.parse(RESERVE)).endCell().toBoc().toString('base64'),
                    )
                      ? RESERVE_JETTON_WALLET
                      : SENDER_JETTON_WALLET,
                  )
                  .endCell()
                  .toBoc()
                  .toString('base64'),
              },
            ],
          ],
        };
      } else if (method === 'getAddressState') {
        result = 'uninitialized';
      } else if (method === 'getAddressBalance') {
        result = '1500000000';
      }
      // The service reads only `ok`, `status` and `json`; a full Response has nothing more to offer a test.
      return { ok: true, status: 200, json: async () => ({ ok: true, result }) } as unknown as Response;
    }),
  );
}

type SentMessage = { validUntil: number; messages: { address: string; amount: string; payload: string }[] };
const sendTransaction = vi.fn(async (_tx: SentMessage) => undefined);
const signMessage = vi.fn(async () => ({
  signature: `0x${'ef'.repeat(64)}` as Hex,
  workchain: 0,
  addressHash: `0x${'22'.repeat(32)}` as Hex,
  domain: 'app.sodax.com',
  timestamp: 1789300000,
  payloadType: 'txt' as const,
}));
const walletProvider = {
  chainType: 'TON',
  getWalletAddress: vi.fn(async () => PUBKEY),
  getAccountAddress: vi.fn(async () => SENDER_ADDRESS),
  sendTransaction,
  signMessage,
} as never;

const depositParams = (token: string, extra: object = {}) =>
  ({
    srcChainKey: TON,
    srcAddress: PUBKEY,
    to: HUB_WALLET,
    token,
    amount: 2_000_000n,
    data: '0x' as Hex,
    walletProvider,
    ...extra,
  }) as never;

const sentMessage = (): SentMessage => {
  const sent = sendTransaction.mock.calls[0]?.[0];
  if (!sent) throw new Error('no TonConnect transaction was sent');
  return sent;
};

beforeEach(() => {
  sodax = new Sodax();
  ton = sodax.spoke.ton;
  calls = [];
  vi.spyOn(MpcRelayApiService, 'getDepositAddress').mockResolvedValue({
    ok: true,
    value: {
      depositMethod: 'memo',
      reserveAddress: RESERVE,
      memo: MEMO,
      payloadHash: MEMO,
      path: 'm/0',
      hubWallet: HUB_WALLET,
    },
  });
  vi.spyOn(MpcRelayApiService, 'notify').mockResolvedValue({ ok: true, value: { accepted: true } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('TonSpokeService.deposit', () => {
  it('recovers from a lost response after the wallet accepted the original send', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO)] });
    const cause = new Error('wallet response lost');
    sendTransaction.mockRejectedValueOnce(cause);

    const error: unknown = await ton.deposit(depositParams(NATIVE_TON)).catch((error: unknown) => error);
    expect(isIndeterminateOutcomeError(error)).toBe(true);
    expect(error).toMatchObject({
      cause,
      txHash: undefined,
      recovery: { broadcastId: expect.any(String), validUntil: sentMessage().validUntil, sinceLt: '100' },
    });
    if (!isIndeterminateOutcomeError(error) || !error.recovery) throw new Error('expected TON deposit recovery');
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
    // The test asserted the recovery came from TonSpokeService.deposit above.
    const txHash = await ton.resumeDeposit(error.recovery as import('./TonSpokeService.js').TonDepositRecovery);
    expect(txHash).toBe(`0x${'cd'.repeat(32)}`);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', txHash);
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it('does not treat an explicit wallet refusal as an indeterminate send', async () => {
    stubToncenter();
    const refusal = new UserRejectsError('rejected');
    sendTransaction.mockRejectedValueOnce(refusal);
    await expect(ton.deposit(depositParams(NATIVE_TON))).rejects.toBe(refusal);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('ignores jetton notifications from another jetton wallet, depositor or amount', async () => {
    const other = jettonTx('201', MEMO, 2_000_000n, SENDER_ADDRESS, 'aa'.repeat(32));
    other.in_msg.source = SENDER_JETTON_WALLET.toString();
    stubToncenter({
      txs: [
        other,
        jettonTx('202', MEMO, 2_000_000n, RESERVE, 'aa'.repeat(32)),
        jettonTx('203', MEMO, 1n, SENDER_ADDRESS, 'bb'.repeat(32)),
        jettonTx('200', MEMO),
      ],
    });
    const txHash = await ton.deposit(depositParams(USDT_MASTER));
    expect(txHash).toBe(`0x${'cd'.repeat(32)}`);
    expect(MpcRelayApiService.notify).toHaveBeenCalledOnce();
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', txHash);
  });

  it('registers under the PUBLIC KEY, pays native TON with a memo comment and returns the RESERVE tx it notifies', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO)] });

    const hash = await ton.deposit(depositParams(NATIVE_TON));

    expect(MpcRelayApiService.getDepositAddress).toHaveBeenCalledWith(expect.anything(), PUBKEY, '607', '0x');
    expect(hash).toBe(`0x${'cd'.repeat(32)}`);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', hash);

    const [message] = sentMessage().messages;
    expect(Address.parse(message?.address ?? '').toRawString()).toBe(RESERVE);
    expect(message?.amount).toBe('2000000');
    const body = Cell.fromBoc(Buffer.from(message?.payload ?? '', 'base64'))[0];
    expect(body?.equals(buildTonCommentBody(MEMO))).toBe(true);
  });

  it('sends a jetton through the sender own jetton wallet, forwarding enough TON to notify the reserve', async () => {
    stubToncenter({ txs: [jettonTx('200', MEMO)] });

    await ton.deposit(depositParams(USDT_MASTER));

    const [message] = sentMessage().messages;
    expect(Address.parse(message?.address ?? '').equals(SENDER_JETTON_WALLET)).toBe(true);
    // 0.2 TON attached, 0.1 forwarded: a 1-nanoton forward bounces the jettons back.
    expect(message?.amount).toBe('200000000');
    const s = Cell.fromBoc(Buffer.from(message?.payload ?? '', 'base64'))[0]?.beginParse();
    expect(s?.loadUint(32)).toBe(0x0f8a7ea5);
    s?.loadUintBig(64);
    expect(s?.loadCoins()).toBe(2_000_000n);
    expect(s?.loadAddress().toRawString()).toBe(RESERVE);
    expect(s?.loadAddress().toString({ bounceable: false })).toBe(SENDER_ADDRESS);
    expect(s?.loadBit()).toBe(false);
    expect(s?.loadCoins()).toBe(100_000_000n);
    // The jetton wallet is looked up for the address the wallet actually sends from.
    expect(calls.find(c => c.method === 'runGetMethod')?.params).toMatchObject({
      address: USDT_MASTER,
      method: 'get_wallet_address',
    });
  });

  it('reads the reserve baseline before sending, and ignores an older deposit that reused the memo', async () => {
    vi.useFakeTimers();
    const older = nativeTx('90', MEMO, Buffer.from('aa'.repeat(32), 'hex').toString('base64'));
    const fresh = nativeTx('200', MEMO);
    stubToncenter({ baselineLt: '100', txs: [older, fresh] });

    const pending = ton.deposit(depositParams(NATIVE_TON));
    await vi.runAllTimersAsync();

    expect(await pending).toBe(`0x${'cd'.repeat(32)}`);
    const baselineCall = calls.findIndex(c => c.method === 'getTransactions' && c.params.limit === 1);
    expect(baselineCall).toBeGreaterThanOrEqual(0);
    expect(sendTransaction.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it('returns the unsigned message in raw mode, sent from the key wallet-v4R2 address', async () => {
    stubToncenter();

    const raw = await ton.deposit({ ...(depositParams(NATIVE_TON) as object), raw: true } as never);

    expect(raw).toMatchObject({ from: tonWalletAddress(PUBKEY).toString(), value: 2_000_000n, token: NATIVE_TON });
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('refuses a memo mismatch (even raw), an address-mode relay response and a hub wallet the relay disagrees with', async () => {
    stubToncenter();
    const relay = await MpcRelayApiService.getDepositAddress('https://example.com', PUBKEY, '607', '0x');
    if (!relay.ok || relay.value.depositMethod !== 'memo') throw new Error('expected a memo deposit');
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValueOnce({
      ok: true,
      value: { ...relay.value, memo: `0x${'00'.repeat(32)}` },
    });
    await expect(ton.deposit(depositParams(NATIVE_TON, { raw: true }))).rejects.toThrow(/memo does not match/);

    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValueOnce({
      ok: true,
      value: {
        depositMethod: 'address',
        depositAddress: RESERVE,
        payloadHash: MEMO,
        path: 'm/0',
        hubWallet: HUB_WALLET,
      },
    });
    await expect(ton.deposit(depositParams(NATIVE_TON))).rejects.toThrow(/expected memo/);

    await expect(
      ton.deposit(depositParams(NATIVE_TON, { to: '0x9999999999999999999999999999999999999999' })),
    ).rejects.toThrow(/relay derives hub wallet/);
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('still resolves to the reserve tx hash when the relay cannot be notified, leaving the re-notify to settlement', async () => {
    vi.useFakeTimers();
    stubToncenter({ txs: [nativeTx('200', MEMO)] });
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = ton.deposit(depositParams(NATIVE_TON));
    await vi.runAllTimersAsync();

    // The funds already landed on the reserve: the hash is what settlement waits on and re-notifies.
    expect(await pending).toBe(`0x${'cd'.repeat(32)}`);
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('TonSpokeService — relay submit and read', () => {
  const HASH = `0x${'cd'.repeat(32)}`;
  const HUB_RELEASE = { dstChainKey: 'ton', hubChainId: '146', hubTxHash: '0xhub', logIndex: 3 } as const;

  it('submitDeposit notifies on the TON relay id, and submitHubRelease the hub tx as a withdrawal, without polling', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await ton.submitDeposit(HASH)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', HASH);
    expect(await ton.submitHubRelease(HUB_RELEASE)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '146', '0xhub', 'withdrawal');
    expect(wait).not.toHaveBeenCalled();
  });

  it('submitDeposit keeps the tx hash in the failure so the deposit can be re-notified', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = ton.submitDeposit(HASH);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(!result.ok && (result.error as Error).message).toContain(`deposit ${HASH} was not notified`);
  });

  it('waitForWithdrawal passes the stage through and uses the settlement floor for a NaN timeout', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'burned' },
    });

    await ton.waitForWithdrawal('0xtrack', undefined, 'burned');
    expect(wait).toHaveBeenCalledWith(expect.anything(), '0xtrack', expect.objectContaining({ until: 'burned' }));

    await ton.waitForWithdrawal('x', Number.NaN);
    expect(wait).toHaveBeenCalledWith(expect.anything(), 'x', expect.objectContaining({ timeout: 300_000 }));
  });
});

describe('TonSpokeService.waitForDeposit', () => {
  it('keys the deposit on the reserve tx hash at index 0, and re-notifies while waiting', async () => {
    vi.useFakeTimers();
    let settle: (v: never) => void = () => undefined;
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockReturnValue(new Promise(r => (settle = r)));
    const hash = `0x${'cd'.repeat(32)}`;

    const pending = ton.waitForDeposit(hash);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(wait.mock.calls[0]?.[1]).toBe(`607-${hash}-0`);
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThanOrEqual(3);
    settle({ ok: true, value: { depositId: 'id', status: 'minted', createdAt: 0, txs: {} } } as never);
    await pending;
  });
});

describe('TonSpokeService.sendMessage', () => {
  const sendParams = {
    srcChainKey: TON,
    srcAddress: PUBKEY,
    dstChainKey: 'sonic',
    dstAddress: HUB_WALLET,
    payload: '0xdeadbeef' as Hex,
    walletProvider,
  } as never;

  beforeEach(() => {
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: MEMO },
    });
  });

  it('submits scheme 5 with the public key as sender and publicKey, plus the signData envelope', async () => {
    await ton.sendMessage(sendParams);

    const request = vi.mocked(MpcRelayApiService.submitWithdraw).mock.calls[0]?.[1];
    expect(request).toMatchObject({
      scheme: 5,
      publicKey: PUBKEY,
      signature: `0x${'ef'.repeat(64)}`,
      tonSignData: {
        workchain: 0,
        addressHash: `0x${'22'.repeat(32)}`,
        domain: 'app.sodax.com',
        timestamp: 1789300000,
        payloadType: 'txt',
      },
    });
    expect(request?.message).toMatchObject({ sender: PUBKEY, chainId: '607' });
    const nonce = BigInt(request?.message.nonce ?? '0');
    expect(BigInt(Number(nonce))).toBe(nonce);
  });

  it('reuses one signed request after a first 429 through sendMessage', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.submitWithdraw).mockRestore();
    const send = vi.fn(async (_url: string, init?: RequestInit) => {
      if (send.mock.calls.length === 1) return new Response(null, { status: 429 });
      const { message } = JSON.parse(String(init?.body));
      const trackingId = keccak256(concat([PUBKEY, toHex(BigInt(message.nonce), { size: 8 })]));
      return Response.json({ accepted: true, trackingId });
    });
    vi.stubGlobal('fetch', send);
    const pending = ton.sendMessage(sendParams).then(
      value => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    const request = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    const trackingId = keccak256(concat([PUBKEY, toHex(BigInt(request.message.nonce), { size: 8 })]));
    expect(result).toEqual({ ok: true, value: trackingId });
    expect(signMessage).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Set(send.mock.calls.map(([, init]) => init?.body)).size).toBe(1);
  });

  it('refuses raw mode, which has no spoke transaction to return', async () => {
    await expect(ton.sendMessage({ ...(sendParams as object), raw: true } as never)).rejects.toThrow(
      /raw mode is not supported/,
    );
  });
});

describe('TonSpokeService balances', () => {
  it('reads the key wallet-v4R2 address by default, else the supplied account, for native, jetton and wallet balances', async () => {
    stubToncenter();
    const balance = await ton.getDeposit({ srcChainKey: TON, srcAddress: PUBKEY, token: NATIVE_TON } as never);
    expect(balance).toBe(1_500_000_000n);
    expect(calls.find(c => c.method === 'getAddressBalance')?.params.address).toBe(tonWalletAddress(PUBKEY).toString());

    calls = [];
    const accountAddress = Address.parse(RESERVE).toString();
    await ton.getDeposit({ srcChainKey: TON, srcAddress: PUBKEY, token: NATIVE_TON, accountAddress });
    expect(calls[0]?.params.address).toBe(accountAddress);
    await ton.getDeposit({ srcChainKey: TON, srcAddress: PUBKEY, token: USDT_MASTER, accountAddress });
    const stack = calls.find(c => c.method === 'runGetMethod')?.params.stack as [string, string][];
    const cell = Cell.fromBoc(Buffer.from(stack[0]?.[1] ?? '', 'base64'))[0];
    expect(cell?.beginParse().loadAddress().equals(Address.parse(accountAddress))).toBe(true);

    calls = [];
    const token = tonSupportedTokens.TON;
    await ton.getWalletBalance({ srcChainKey: TON, srcAddress: PUBKEY, token, accountAddress: RESERVE });
    await ton.getWalletBalances({ srcChainKey: TON, srcAddress: PUBKEY, tokens: [token], accountAddress: RESERVE });
    expect(calls.filter(c => c.method === 'getAddressBalance').map(c => c.params.address)).toEqual([RESERVE, RESERVE]);
  });
});

describe('SpokeService routing for TON', () => {
  it('resolves TON to its own service', () => {
    expect(sodax.spoke.getSpokeService(TON)).toBe(ton);
  });
});

describe('TON review regressions', () => {
  const hash = `0x${'cd'.repeat(32)}`;
  const recovery = {
    broadcastId: 'first-broadcast',
    reserveAddress: RESERVE,
    memo: MEMO,
    sinceLt: '100',
    sender: SENDER_ADDRESS,
    amount: '2000000',
    token: NATIVE_TON,
    validUntil: 1_789_300_000,
  };

  it('retries a transient discovery 503 after sending only once', async () => {
    vi.useFakeTimers();
    stubToncenter({ txs: [nativeTx('200', MEMO)] });
    const fetchOk = fetch;
    let failed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const call = JSON.parse(String(init.body)) as Call;
        if (call.params.limit === 16 && !failed) {
          failed = true;
          return new Response('', { status: 503 });
        }
        return fetchOk(url, init);
      }),
    );
    const pending = ton.deposit(depositParams(NATIVE_TON));
    const result = expect(pending).resolves.toBe(hash);
    await vi.runAllTimersAsync();
    await result;
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(MpcRelayApiService.notify).toHaveBeenCalledTimes(1);
  });

  it('preserves recovery after discovery times out without resending', async () => {
    vi.useFakeTimers();
    stubToncenter();
    const pending = ton.deposit(depositParams(NATIVE_TON));
    const result = expect(pending).rejects.toMatchObject({
      name: 'IndeterminateOutcomeError',
      recovery: { ...recovery, broadcastId: expect.any(String), validUntil: expect.any(Number) },
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await result;
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('resumes discovery and notification without sending, idempotently, but not for a different deposit', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO)] });
    expect(await ton.resumeDeposit(recovery)).toBe(hash);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', hash);

    // The same recovery returns the hash it already claimed; another deposit cannot take it.
    expect(await ton.resumeDeposit(recovery, 1_000)).toBe(hash);
    expect(MpcRelayApiService.notify).toHaveBeenCalledTimes(2);
    await expect(ton.resumeDeposit({ ...recovery, broadcastId: 'second-broadcast' }, 1_000)).rejects.toMatchObject({
      name: 'IndeterminateOutcomeError',
    });
  });

  /** toncenter's getTransactions over `txs` (newest first): pages of `limit`, starting at the lt/hash cursor. */
  function stubPagedReserve(txs: ReturnType<typeof nativeTx>[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method, params } = JSON.parse(init.body) as Call;
        calls.push({ method, params });
        let result: unknown = [];
        if (method === 'getTransactions') {
          const start =
            params.lt === undefined
              ? 0
              : txs.findIndex(t => t.transaction_id.lt === params.lt && t.transaction_id.hash === params.hash);
          result = start < 0 ? [] : txs.slice(start, start + Number(params.limit));
        }
        // The service reads only `ok`, `status` and `json`; a full Response has nothing more to offer a test.
        return { ok: true, status: 200, json: async () => ({ ok: true, result }) } as unknown as Response;
      }),
    );
  }

  const newerUnrelated = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      nativeTx(
        String(1000 - i),
        `0x${'99'.repeat(32)}`,
        Buffer.from(i.toString(16).padStart(64, '0'), 'hex').toString('base64'),
      ),
    );

  it.each([16, 40])('recovers a deposit behind %i newer reserve transactions', async count => {
    stubPagedReserve([...newerUnrelated(count), nativeTx('200', MEMO), nativeTx('50', MEMO, 'old')]);
    expect(await ton.resumeDeposit(recovery, 1_000)).toBe(hash);
  });

  it('stops paging once it is past sinceLt', async () => {
    vi.useFakeTimers();
    stubPagedReserve([...newerUnrelated(40), nativeTx('90', MEMO)]);
    const pending = ton.resumeDeposit(recovery, 1_000);
    const result = expect(pending).rejects.toMatchObject({ name: 'IndeterminateOutcomeError' });
    await vi.advanceTimersByTimeAsync(2_000);
    await result;
    const cursors = calls.filter(c => c.method === 'getTransactions').map(c => c.params.lt ?? 'head');
    // One poll reads the head page and pages back until it reaches lt 90; nothing older is requested.
    expect(new Set(cursors).size).toBeLessThanOrEqual(4);
  });

  it('resumes deposits with identical transfer details to distinct hashes', async () => {
    const olderHash = `0x${'de'.repeat(32)}`;
    const olderHashBase64 = Buffer.from(olderHash.slice(2), 'hex').toString('base64');
    stubToncenter({ txs: [nativeTx('300', MEMO), nativeTx('200', MEMO, olderHashBase64)] });

    const secondRecovery = { ...recovery, broadcastId: 'second-broadcast' };
    expect(await ton.resumeDeposit(recovery, 1_000)).toBe(hash);
    expect(await ton.resumeDeposit(secondRecovery, 1_000)).toBe(olderHash);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', hash);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', olderHash);
  });

  it('ignores native transactions from another sender or amount', async () => {
    const stranger = nativeTx('201', MEMO, Buffer.from('aa'.repeat(32), 'hex').toString('base64'));
    stranger.in_msg.source = RESERVE;
    const wrongAmount = nativeTx('202', MEMO, Buffer.from('bb'.repeat(32), 'hex').toString('base64'));
    wrongAmount.in_msg.value = '1';
    stubToncenter({ txs: [stranger, wrongAmount, nativeTx('203', MEMO)] });
    expect(await ton.deposit(depositParams(NATIVE_TON))).toBe(hash);
  });

  it('finds receipts on the relay reserve, including a NaN timeout', async () => {
    const rotatedReserve = `0:${'33'.repeat(32)}`;
    const relayResult = await MpcRelayApiService.getDepositAddress('https://example.com', PUBKEY, '607', '0x');
    if (!relayResult.ok || relayResult.value.depositMethod !== 'memo') throw new Error('expected a memo deposit');
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValueOnce({
      ok: true,
      value: { ...relayResult.value, reserveAddress: rotatedReserve },
    });
    stubToncenter({ txs: [nativeTx('200', MEMO)] });
    await ton.deposit(depositParams(NATIVE_TON));
    calls = [];
    const result = await ton.waitForTransactionReceipt({ chainKey: TON, txHash: hash, maxTimeoutMs: Number.NaN });
    expect(result).toMatchObject({ ok: true, value: { status: 'success' } });
    expect(calls[0]?.params.address).toBe(rotatedReserve);
  });

  it('bounds a hanging receipt RPC and a rate-limit backoff by the remaining budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    let settled = false;
    const pending = ton.waitForTransactionReceipt({ chainKey: TON, txHash: hash, maxTimeoutMs: 100 }).then(result => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ ok: true, value: { status: 'timeout' } });

    const rpc = vi.fn(async () => new Response('', { status: 429 }));
    vi.stubGlobal('fetch', rpc);
    let throttledSettled = false;
    const throttled = ton
      .waitForTransactionReceipt({ chainKey: TON, txHash: '0x12', maxTimeoutMs: 100 })
      .then(result => {
        throttledSettled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(100);
    expect(throttledSettled).toBe(true);
    expect(await throttled).toMatchObject({ ok: true, value: { status: 'timeout' } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('TON correlation and budget edge cases', () => {
  it('holds the same-memo lock until discovery ends and skips a claimed hash', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO), nativeTx('201', MEMO, 'de'.repeat(32))] });
    const fetchOk = fetch;
    let release = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let polls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const call = JSON.parse(String(init.body)) as Call;
        if (call.params.limit === 16 && polls++ === 0) await gate;
        return fetchOk(url, init);
      }),
    );
    const first = ton.deposit(depositParams(NATIVE_TON));
    const second = ton.deposit(depositParams(NATIVE_TON));
    await vi.waitFor(() => expect(polls).toBe(1));
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    release();
    expect(await Promise.all([first, second])).toEqual([`0x${'cd'.repeat(32)}`, `0x${'de'.repeat(32)}`]);
    expect(MpcRelayApiService.notify).toHaveBeenCalledTimes(2);
  });
});
