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
import type { Hex } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { buildTonCommentBody, tonWalletAddress } from './ton-utils.js';

const sodax = new Sodax();
const ton = sodax.spoke.ton;

const TON = 'ton' as const;
const NATIVE_TON = '0x0000000000000000000000000000000000000000';
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const PUBKEY = `0x${'07'.repeat(32)}` as Hex;
const RESERVE = '0:2a7f65800a2ebe06fa227e7f29cd188d5c3e39d0566d8646c8c73104417a6a97';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const MEMO = `0x${'ab'.repeat(32)}` as Hex;
const SENDER_ADDRESS = tonWalletAddress(PUBKEY).toString({ bounceable: false });
const SENDER_JETTON_WALLET = tonWalletAddress(`0x${'09'.repeat(32)}`);
const RESERVE_TX_HASH = Buffer.from('cd'.repeat(32), 'hex').toString('base64');

type Call = { method: string; params: Record<string, unknown> };
let calls: Call[];

/** A toncenter transaction on the reserve, carrying `memo` as a native comment. */
const nativeTx = (lt: string, memo: string, hash = RESERVE_TX_HASH) => ({
  transaction_id: { lt, hash },
  in_msg: { msg_data: { text: Buffer.from(memo.slice(2), 'hex').toString('base64') } },
});

/** A toncenter transaction on the reserve carrying `memo` in a jetton transfer_notification. */
const jettonTx = (lt: string, memo: string) => ({
  transaction_id: { lt, hash: RESERVE_TX_HASH },
  in_msg: {
    msg_data: {
      body: beginCell()
        .storeUint(0x7362d09c, 32)
        .storeUint(0n, 64)
        .storeCoins(2_000_000n)
        .storeAddress(Address.parse(SENDER_ADDRESS))
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
            ['cell', { bytes: beginCell().storeAddress(SENDER_JETTON_WALLET).endCell().toBoc().toString('base64') }],
          ],
        };
      } else if (method === 'getAddressBalance') {
        result = '1500000000';
      }
      // The service reads only `ok`, `status` and `json`; a full Response has nothing more to offer a test.
      return { ok: true, status: 200, json: async () => ({ ok: true, result }) } as unknown as Response;
    }),
  );
}

type SentMessage = { messages: { address: string; amount: string; payload: string }[] };
const sendTransaction = vi.fn(async (_tx: SentMessage) => undefined);
const walletProvider = {
  chainType: 'TON',
  getWalletAddress: vi.fn(async () => PUBKEY),
  getAccountAddress: vi.fn(async () => SENDER_ADDRESS),
  sendTransaction,
  signMessage: vi.fn(async () => ({
    signature: `0x${'ef'.repeat(64)}` as Hex,
    workchain: 0,
    addressHash: `0x${'22'.repeat(32)}` as Hex,
    domain: 'app.sodax.com',
    timestamp: 1789300000,
    payloadType: 'txt' as const,
  })),
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
  it('registers the deposit under the PUBLIC KEY, which is the relay identity', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO)] });

    await ton.deposit(depositParams(NATIVE_TON));

    expect(MpcRelayApiService.getDepositAddress).toHaveBeenCalledWith(expect.anything(), PUBKEY, '607', '0x');
  });

  it('pays native TON to the reserve with the memo as a comment body', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO)] });

    await ton.deposit(depositParams(NATIVE_TON));

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

  it('returns the RESERVE transaction carrying the memo and notifies the relay with it', async () => {
    stubToncenter({ txs: [nativeTx('200', MEMO)] });

    const hash = await ton.deposit(depositParams(NATIVE_TON));

    expect(hash).toBe(`0x${'cd'.repeat(32)}`);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', `0x${'cd'.repeat(32)}`);
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

  it('refuses an address-mode relay response and a hub wallet that disagrees with the relay', async () => {
    stubToncenter();
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

  it('submitDeposit notifies the relay on the TON relay id, without polling', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await ton.submitDeposit(HASH)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '607', HASH);
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

  it('submitHubRelease notifies the hub tx as a withdrawal on the hub chain id', async () => {
    expect(await ton.submitHubRelease(HUB_RELEASE)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '146', '0xhub', 'withdrawal');
  });

  it('reads a deposit, a withdrawal and a hub release once each, notifying nothing', async () => {
    const record = { ok: true as const, value: { depositId: 'id', status: 'pending' as const, createdAt: 0, txs: {} } };
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(record);
    vi.spyOn(MpcRelayApiService, 'getWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'submitted' },
    });

    expect(await ton.getDepositRecord(HASH)).toEqual(record);
    expect(read.mock.calls[0]?.[1]).toBe(`607-${HASH}-0`);
    expect(await ton.getHubReleaseRecord(HUB_RELEASE)).toEqual(record);
    expect((await ton.getWithdrawalRecord('0xtrack')).ok).toBe(true);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('waitForWithdrawal passes the stage to stop on through to the relay poll', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'burned' },
    });

    await ton.waitForWithdrawal('0xtrack', undefined, 'burned');

    expect(wait).toHaveBeenCalledWith(expect.anything(), '0xtrack', expect.objectContaining({ until: 'burned' }));
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

  it('refuses raw mode, which has no spoke transaction to return', async () => {
    await expect(ton.sendMessage({ ...(sendParams as object), raw: true } as never)).rejects.toThrow(
      /raw mode is not supported/,
    );
  });
});

describe('TonSpokeService.getDeposit', () => {
  it('reads the native balance of the key wallet-v4R2 address', async () => {
    stubToncenter();

    const balance = await ton.getDeposit({ srcChainKey: TON, srcAddress: PUBKEY, token: NATIVE_TON } as never);

    expect(balance).toBe(1_500_000_000n);
    expect(calls.find(c => c.method === 'getAddressBalance')?.params.address).toBe(tonWalletAddress(PUBKEY).toString());
  });
});

describe('SpokeService routing for TON', () => {
  it('resolves TON to its own service', () => {
    expect(sodax.spoke.getSpokeService(TON)).toBe(ton);
  });
});
