/**
 * Tests for `TronSpokeService.deposit` / `getDeposit` / wallet balances — the places that branch on token kind.
 *
 * Tron deposits ride the MPC relay in memo mode: the SDK builds the transfer to the shared reserve
 * itself, splices in the 32-byte payload-hash memo, signs, broadcasts and notifies. Native TRX and a
 * TRC-20 differ only in how the unsigned transfer is built (`createtransaction` vs
 * `triggersmartcontract`), so what is worth pinning down is that the TRC-20 branch calls the right
 * endpoint with the right `transfer` args, and that everything downstream of the build is shared.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  spokeChainConfig,
  type Hex,
  type MpcWithdrawMessage,
  type TronRawTransaction,
  type TronRawWithdraw,
  tronSupportedTokens,
} from '@sodax/types';
import { encodeAbiParameters, getAddress, keccak256, sha256 } from 'viem';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import {
  assembleBroadcastHex,
  computeSignedMessageHash,
  encodeTrc20TransferParams,
  readTrc20TransferCall,
  spliceMemo,
  tronBase58ToHex,
  tronIdentityBytes,
} from './tron-utils.js';
import { nativeTransferRaw, trc20TransferRaw } from './tron-test-fixtures.js';

const sodax = new Sodax();
const tron = sodax.spoke.tron;

const TRON = 'tron' as const;
const NATIVE_TRX = '0x0000000000000000000000000000000000000000';
const USDT = tronSupportedTokens.USDT.address;
const SENDER = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
const RESERVE = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
// Derived independently of the SDK helper, matching the relay's computePayloadHash for `data: '0x'`.
const MEMO = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [HUB_WALLET, '0x']));
const AMOUNT = 20_000_000n;
const SIGNATURE = 'ab'.repeat(65);
const WITHDRAW_MESSAGE: MpcWithdrawMessage = {
  to: HUB_WALLET,
  data: '0x',
  nonce: '7',
  chainId: '728126428',
  sender: HUB_WALLET,
};
const WITHDRAW: TronRawWithdraw = {
  message: WITHDRAW_MESSAGE,
  digest: computeSignedMessageHash({ ...WITHDRAW_MESSAGE, nonce: 7n, chainId: 728126428n }),
  scheme: 1,
};

// The bodies an honest node returns for this deposit; the SDK decodes and checks them before signing.
const NATIVE_RAW = nativeTransferRaw(SENDER, RESERVE, AMOUNT);
const TRC20_RAW = trc20TransferRaw(SENDER, USDT, RESERVE, AMOUNT);
// The decoded bodies the node returns beside them, expiring ten minutes after the run starts.
const EXPIRATION = Date.now() + 600_000;
const NATIVE_RAW_DATA = { contract: [{ type: 'TransferContract' }], expiration: EXPIRATION };
const TRC20_RAW_DATA = { contract: [{ type: 'TriggerSmartContract' }], expiration: EXPIRATION };

type Call = { path: string; body: Record<string, unknown> };

let calls: Call[];

/** Stands in for TronGrid: records every call and answers each endpoint with its success shape. */
function stubTronGrid(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ path, body });

      const responses: Record<string, unknown> = {
        '/wallet/createtransaction': { raw_data_hex: NATIVE_RAW, raw_data: NATIVE_RAW_DATA },
        '/wallet/triggersmartcontract': {
          result: { result: true },
          transaction: { raw_data_hex: TRC20_RAW, raw_data: TRC20_RAW_DATA },
        },
        '/wallet/broadcasthex': { result: true },
        '/wallet/getaccount': { balance: 42 },
        '/wallet/triggerconstantcontract': {
          result: { result: true },
          constant_result: ['0000000000000000000000000000000000000000000000000000000000000539'],
        },
        ...overrides,
      };

      // Only `ok` and `json()` are read, so a partial stands in for the full fetch Response.
      return { ok: true, json: async () => responses[path] ?? {} } as unknown as Response;
    }),
  );
}

// Held apart from `walletProvider`, whose `as never` would erase the mock's type for assertions.
const signTransaction = vi.fn(async (tx: { txID: string; raw_data_hex: string }) => ({
  ...tx,
  signature: [SIGNATURE],
}));

const signMessage = vi.fn(async () => `0x${SIGNATURE}`);

const walletProvider = {
  chainType: 'TRON',
  signTransaction,
  signMessage,
} as never;

const depositParams = (token: string) =>
  ({
    srcChainKey: TRON,
    srcAddress: SENDER,
    to: HUB_WALLET,
    token,
    amount: AMOUNT,
    data: '0x' as Hex,
    walletProvider,
  }) as never;

const callTo = (path: string) => calls.find(c => c.path === path);

const mockSubmitOk = () =>
  vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
    ok: true,
    value: { accepted: true, trackingId: MEMO },
  });

const digestOf = (m: MpcWithdrawMessage) =>
  computeSignedMessageHash({ ...m, nonce: BigInt(m.nonce), chainId: BigInt(m.chainId) });

beforeEach(() => {
  calls = [];
  // `restoreAllMocks` leaves a plain `vi.fn`'s calls in place, so each test would read an earlier one's.
  signTransaction.mockClear();
  signMessage.mockClear();
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

describe('TronSpokeService.deposit — TRC-20', () => {
  it('builds a transfer(reserve, amount) on the token contract', async () => {
    stubTronGrid();

    await tron.deposit(depositParams(USDT));

    expect(callTo('/wallet/createtransaction')).toBeUndefined();
    // Hex addresses, and no `visible` flag — `visible: true` echoes base58 into `raw_data`, which a
    // browser wallet rejects as an owner mismatch when it compares against its own hex account.
    expect(callTo('/wallet/triggersmartcontract')?.body).toMatchObject({
      owner_address: tronBase58ToHex(SENDER),
      contract_address: tronBase58ToHex(USDT),
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(RESERVE, AMOUNT),
      call_value: 0,
    });
    expect(callTo('/wallet/triggersmartcontract')?.body).not.toHaveProperty('visible', true);
    // A contract call is rejected outright without a fee limit.
    expect(callTo('/wallet/triggersmartcontract')?.body.fee_limit).toBeGreaterThan(0);
  });

  it('hands the wallet the decoded raw_data carrying the same memo', async () => {
    // A browser wallet renders the prompt from `raw_data` (TronWeb's `sign` dereferences it), while
    // a raw-key signer only needs `txID` — omitting it throws before the user sees anything.
    stubTronGrid();

    await tron.deposit(depositParams(USDT));

    const signed = vi.mocked(signTransaction).mock.calls[0]?.[0] as {
      raw_data?: { contract?: unknown[]; data?: string };
      raw_data_hex: string;
    };
    expect(signed.raw_data?.contract).toBeDefined();
    // The decoded body must carry the memo the hex body was spliced with, or the two disagree.
    expect(signed.raw_data?.data).toBe(MEMO.slice(2));
    expect(signed.raw_data_hex).toBe(spliceMemo(TRC20_RAW, MEMO));
  });

  it('refuses a node build without raw_data, which a browser wallet signs from', async () => {
    stubTronGrid({
      '/wallet/triggersmartcontract': { result: { result: true }, transaction: { raw_data_hex: TRC20_RAW } },
    });

    await expect(tron.deposit(depositParams(USDT))).rejects.toThrow(/no decoded raw_data/);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('carries the memo, signs the spliced raw, broadcasts it and notifies the relay', async () => {
    stubTronGrid();
    const rawWithMemo = spliceMemo(TRC20_RAW, MEMO);

    const txHash = await tron.deposit(depositParams(USDT));

    expect(signTransaction).toHaveBeenCalledWith(expect.objectContaining({ raw_data_hex: rawWithMemo }));
    expect(callTo('/wallet/broadcasthex')?.body.transaction).toContain(rawWithMemo);
    // The relay keys the deposit on the txid VERBATIM, so notify must get exactly what `deposit`
    // returns — bare hex for Tron. A `0x` prefix here is notified under one id and polled under another.
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '728126428', txHash);
    expect(txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('surfaces a node-side build failure instead of broadcasting', async () => {
    stubTronGrid({ '/wallet/triggersmartcontract': { result: { result: false, message: '434f4e5452414354' } } });

    await expect(tron.deposit(depositParams(USDT))).rejects.toThrow(/triggersmartcontract failed/);
    expect(callTo('/wallet/broadcasthex')).toBeUndefined();
  });

  it('returns the checked transfer unsigned in raw mode, memo spliced in, without signing or broadcasting', async () => {
    stubTronGrid();
    const rawWithMemo = spliceMemo(TRC20_RAW, MEMO);

    const raw = await tron.deposit({ ...(depositParams(USDT) as object), raw: true } as never);

    expect(raw).toEqual({
      txID: sha256(`0x${rawWithMemo}`).slice(2),
      raw_data_hex: rawWithMemo,
      raw_data: { ...TRC20_RAW_DATA, data: MEMO.slice(2) },
      visible: false,
    });
    expect(callTo('/wallet/triggersmartcontract')).toBeDefined();
    expect(signTransaction).not.toHaveBeenCalled();
    expect(callTo('/wallet/broadcasthex')).toBeUndefined();
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });
});

describe('TronSpokeService.deposit — native TRX', () => {
  it('builds a plain value transfer to the reserve', async () => {
    stubTronGrid();

    await tron.deposit(depositParams(NATIVE_TRX));

    expect(callTo('/wallet/triggersmartcontract')).toBeUndefined();
    expect(callTo('/wallet/createtransaction')?.body).toMatchObject({
      owner_address: tronBase58ToHex(SENDER),
      to_address: tronBase58ToHex(RESERVE),
      amount: Number(AMOUNT),
    });
    expect(callTo('/wallet/createtransaction')?.body).not.toHaveProperty('visible', true);
    expect(callTo('/wallet/broadcasthex')?.body.transaction).toContain(spliceMemo(NATIVE_RAW, MEMO));
  });

  it('returns the value transfer unsigned in raw mode', async () => {
    stubTronGrid();

    const raw = await tron.deposit({ ...(depositParams(NATIVE_TRX) as object), raw: true } as never);

    expect(raw).toMatchObject({ raw_data_hex: spliceMemo(NATIVE_RAW, MEMO) });
    expect(callTo('/wallet/createtransaction')).toBeDefined();
  });
});

describe('TronSpokeService.deposit — rotated reserve', () => {
  // The relay's client contract: `reserveAddress` is not a constant, and a client must pay the
  // address from the CURRENT response. Refusing a rotation would strand deposits, so this warns.
  it('pays the reserve the relay returned even when the chain config names another, and warns', async () => {
    const rotated = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
    stubTronGrid({
      '/wallet/createtransaction': {
        raw_data_hex: nativeTransferRaw(SENDER, rotated, AMOUNT),
        raw_data: NATIVE_RAW_DATA,
      },
    });
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

    await tron.deposit(depositParams(NATIVE_TRX));

    expect(callTo('/wallet/createtransaction')?.body.to_address).toBe(tronBase58ToHex(rotated));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rotated));
  });
});

describe('TronSpokeService.deposit — node-built transfer check', () => {
  const OTHER = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';

  it.each([
    [
      'a redirected TRX recipient',
      { '/wallet/createtransaction': { raw_data_hex: nativeTransferRaw(SENDER, OTHER, AMOUNT) } },
      NATIVE_TRX,
    ],
    [
      'an altered TRX amount',
      { '/wallet/createtransaction': { raw_data_hex: nativeTransferRaw(SENDER, RESERVE, AMOUNT * 10n) } },
      NATIVE_TRX,
    ],
    [
      'a redirected TRC-20 recipient',
      {
        '/wallet/triggersmartcontract': {
          result: { result: true },
          transaction: { raw_data_hex: trc20TransferRaw(SENDER, USDT, OTHER, AMOUNT) },
        },
      },
      USDT,
    ],
  ])('refuses to sign %s', async (_label, overrides, token) => {
    stubTronGrid(overrides);

    await expect(tron.deposit(depositParams(token))).rejects.toThrow(/node-built deposit transfer rejected/);
    expect(signTransaction).not.toHaveBeenCalled();
    expect(callTo('/wallet/broadcasthex')).toBeUndefined();
  });

  it('refuses to hand out a redirected transfer in raw mode too', async () => {
    stubTronGrid({ '/wallet/createtransaction': { raw_data_hex: nativeTransferRaw(SENDER, OTHER, AMOUNT) } });

    await expect(tron.deposit({ ...(depositParams(NATIVE_TRX) as object), raw: true } as never)).rejects.toThrow(
      /node-built deposit transfer rejected/,
    );
  });
});

describe('TronSpokeService.deposit — hub wallet assertion', () => {
  it('refuses a deposit whose target disagrees with the hub wallet the relay derives', async () => {
    stubTronGrid();
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

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(/relay derives hub wallet/);
    expect(calls).toHaveLength(0);
  });
});

describe('TronSpokeService.deposit — memo commitment', () => {
  // A relay that registered other calls under the memo would have the verifiers attest those instead.
  const foreignMemo = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [HUB_WALLET, '0xdeadbeef']),
  );

  beforeEach(() => {
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValue({
      ok: true,
      value: {
        reserveAddress: RESERVE,
        memo: foreignMemo,
        payloadHash: foreignMemo,
        path: 'm/0',
        hubWallet: HUB_WALLET,
        depositMethod: 'memo',
      },
    });
  });

  it('refuses to sign a transfer whose memo commits to another payload', async () => {
    stubTronGrid();

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(/does not commit to this deposit's payload/);
    expect(calls).toHaveLength(0);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('refuses to build a raw transfer carrying that memo', async () => {
    stubTronGrid();

    await expect(tron.deposit({ ...(depositParams(NATIVE_TRX) as object), raw: true } as never)).rejects.toThrow(
      /does not commit to this deposit's payload/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('TronSpokeService.deposit — broadcast failure', () => {
  it('keeps the signed txID in the error when the node rejects the broadcast', async () => {
    stubTronGrid({ '/wallet/broadcasthex': { result: false, code: 'SIGERROR', message: '7369676e' } });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(/broadcast of [0-9a-f]{64} failed: SIGERROR/);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('treats a duplicate as broadcast, since the node already holds the signed tx', async () => {
    stubTronGrid({ '/wallet/broadcasthex': { result: false, code: 'DUP_TRANSACTION_ERROR' } });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(MpcRelayApiService.notify).toHaveBeenCalled();
  });

  it.each([
    ['a 4xx answer', 429],
    ['a 401 answer', 401],
  ])('fails on %s, which the node gave before accepting anything', async (_label, status) => {
    stubTronGrid();
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/wallet/broadcasthex') return new Response('busy', { status });
      return answer ? answer(url, init) : Promise.reject(new Error('no stub'));
    });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(/broadcast of [0-9a-f]{64} failed/);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('hands the txID on after a 5xx, which a gateway can return for a request the node took', async () => {
    stubTronGrid();
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/wallet/broadcasthex') return new Response('gateway', { status: 504 });
      return answer ? answer(url, init) : Promise.reject(new Error('no stub'));
    });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('hands the signed txID on when the broadcast reply is lost, since the tx may have landed', async () => {
    stubTronGrid();
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/wallet/broadcasthex') throw new TypeError('fetch failed');
      return answer ? answer(url, init) : Promise.reject(new Error('no stub'));
    });

    // Settlement then finds the deposit or times out; failing here would invite a second deposit.
    await expect(tron.deposit(depositParams(NATIVE_TRX))).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(MpcRelayApiService.notify).toHaveBeenCalled();
  });
});

describe('TronSpokeService.deposit — notify failure', () => {
  it('still resolves to the broadcast tx hash, leaving the re-notify to settlement', async () => {
    stubTronGrid();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    // The funds are already in the reserve: the hash is what settlement waits on and re-notifies.
    await expect(tron.deposit(depositParams(NATIVE_TRX))).resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(callTo('/wallet/broadcasthex')).toBeDefined();
    // Notifying twice is harmless, so the transient failure is retried before handing over.
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('TronSpokeService.waitForDeposit', () => {
  const TX_HASH = 'a'.repeat(64);

  it('re-notifies the relay while waiting, since the first notify can precede confirmation', async () => {
    vi.useFakeTimers();
    stubTronGrid();
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    notifySpy.mockClear();
    // Never resolves — the wait is what we are observing, not its outcome.
    vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockReturnValue(new Promise(() => undefined));

    void tron.waitForDeposit(TX_HASH);
    await vi.advanceTimersByTimeAsync(46_000);

    // `/notify` reports `accepted` without checking the tx exists and the relay does not re-check,
    // so a single notification sent before Tron confirmed the deposit strands it.
    expect(notifySpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(notifySpy).toHaveBeenCalledWith(expect.anything(), '728126428', TX_HASH);
    vi.useRealTimers();
  });

  it('stops re-notifying once the wait settles', async () => {
    vi.useFakeTimers();
    stubTronGrid();
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue({
      ok: true,
      value: { depositId: 'id', status: 'minted', createdAt: 0, txs: {} },
    } as never);

    await tron.waitForDeposit(TX_HASH);
    notifySpy.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(notifySpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('TronSpokeService hub release: submit, read, wait', () => {
  const RELEASE = {
    dstChainKey: ChainKeys.TRON_MAINNET,
    hubChainId: '146',
    hubTxHash: `0x${'b'.repeat(64)}`,
    logIndex: 2,
  };

  it('submits by notifying the hub tx as a withdrawal once, without waiting for the release', async () => {
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    notifySpy.mockClear();
    const wait = vi.spyOn(MpcRelayApiService, 'waitForHubRelease');

    expect(await tron.submitHubRelease(RELEASE)).toEqual({ ok: true, value: undefined });

    // The relay has no hub watcher: without this notify the burned tokens are never released.
    expect(notifySpy).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledWith(expect.anything(), '146', RELEASE.hubTxHash, 'withdrawal');
    expect(wait).not.toHaveBeenCalled();
  });

  it('keeps the hub tx in the error when the relay cannot be notified', async () => {
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay down') });

    const res = await tron.submitHubRelease(RELEASE);

    expect(res.ok).toBe(false);
    expect(!res.ok && String(res.error)).toContain(RELEASE.hubTxHash);
  });

  it('reads a release record once, by its lowercased id, without notifying', async () => {
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    notifySpy.mockClear();
    const record = {
      ok: true as const,
      value: { depositId: 'id', status: 'submitted' as const, createdAt: 0, txs: {} },
    };
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(record);

    const res = await tron.getHubReleaseRecord({ ...RELEASE, hubTxHash: `0x${'B'.repeat(64)}` });

    expect(res).toEqual(record);
    expect(read).toHaveBeenCalledWith(expect.anything(), `146-0x${'b'.repeat(64)}-2`);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('keeps re-notifying while it waits, since the verifier may have dropped an early notify', async () => {
    vi.useFakeTimers();
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    notifySpy.mockClear();
    // Never resolves — the wait is what we are observing, not its outcome.
    const wait = vi.spyOn(MpcRelayApiService, 'waitForHubRelease').mockReturnValue(new Promise(() => undefined));

    void tron.waitForHubRelease(RELEASE);
    await vi.advanceTimersByTimeAsync(46_000);

    expect(notifySpy).toHaveBeenCalledWith(expect.anything(), '146', RELEASE.hubTxHash, 'withdrawal');
    expect(notifySpy.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(wait).toHaveBeenCalledWith(expect.anything(), RELEASE, expect.objectContaining({ timeout: 300_000 }));
    vi.useRealTimers();
  });
});

describe('TronSpokeService withdraw-auth and deposit: submit and read', () => {
  it('reads a withdrawal record once, by its trackingId', async () => {
    const record = { ok: true as const, value: { trackingId: '0xtrack' as const, status: 'burned' as const } };
    const read = vi.spyOn(MpcRelayApiService, 'getWithdrawal').mockResolvedValue(record);

    expect(await tron.getWithdrawalRecord('0xtrack')).toEqual(record);
    expect(read).toHaveBeenCalledWith(expect.anything(), '0xtrack');
  });

  it('submits a broadcast deposit by notifying it once, without waiting for the mint', async () => {
    const notifySpy = vi.mocked(MpcRelayApiService.notify);
    notifySpy.mockClear();
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await tron.submitDeposit('ab'.repeat(32))).toEqual({ ok: true, value: undefined });

    expect(notifySpy).toHaveBeenCalledOnce();
    expect(notifySpy).toHaveBeenCalledWith(expect.anything(), '728126428', 'ab'.repeat(32));
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('TronSpokeService.deposit — expired or multi-signed', () => {
  it('surfaces the node refusing an expired transaction, and notifies nothing', async () => {
    // The node checks `raw_data.expiration` against its own head block, so the SDK leaves that to it.
    stubTronGrid({ '/wallet/broadcasthex': { result: false, message: 'TRANSACTION_EXPIRATION_ERROR' } });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(
      /broadcast of [0-9a-f]{64} failed: TRANSACTION_EXPIRATION_ERROR/,
    );
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('broadcasts every signature the wallet returns, for a multi-signature account', async () => {
    stubTronGrid();
    const signatures = [SIGNATURE, 'cd'.repeat(65)];
    signTransaction.mockImplementationOnce(async tx => ({ ...tx, signature: signatures }));

    await tron.deposit(depositParams(NATIVE_TRX));

    expect(callTo('/wallet/broadcasthex')?.body.transaction).toBe(
      assembleBroadcastHex({ rawHex: spliceMemo(NATIVE_RAW, MEMO), signatures }),
    );
  });
});

describe('TronSpokeService.deposit — raw mode, typed for the caller', () => {
  it('types a raw deposit as the unsigned transfer, with its decoded body, without a cast', async () => {
    stubTronGrid();

    const raw = await tron.deposit<true>({
      srcChainKey: ChainKeys.TRON_MAINNET,
      srcAddress: SENDER,
      to: HUB_WALLET,
      token: USDT,
      amount: AMOUNT,
      data: '0x',
      raw: true,
    });

    const tx: TronRawTransaction = raw;
    expect(tx.raw_data.expiration).toBe(EXPIRATION);
    expect(tx.txID).toBe(sha256(`0x${tx.raw_data_hex}`).slice(2));
  });

  it('types a raw withdraw-auth so its digest and the message submit without a cast', async () => {
    mockSubmitOk();

    const withdraw = await tron.sendMessage<true>({
      srcChainKey: ChainKeys.TRON_MAINNET,
      srcAddress: SENDER,
      dstChainKey: ChainKeys.SONIC_MAINNET,
      dstAddress: HUB_WALLET,
      payload: '0xdeadbeef',
      raw: true,
    });
    const signature: Hex = `0x${SIGNATURE}`;

    await expect(tron.submitSignedWithdraw({ withdraw, signature })).resolves.toBe(MEMO);
  });
});

describe('TronSpokeService.extendExpiration', () => {
  const tx = (): TronRawTransaction => {
    const raw_data_hex = spliceMemo(TRC20_RAW, MEMO);
    return {
      txID: sha256(`0x${raw_data_hex}`).slice(2),
      raw_data_hex,
      raw_data: { ...TRC20_RAW_DATA, data: MEMO.slice(2) },
      visible: false,
    };
  };

  it('rewrites the bytes, the decoded expiration and the txID together, keeping the transfer and memo', () => {
    const before = tx();
    const expiration = Date.now() + 3_600_000;

    const after = tron.extendExpiration({ tx: before, expiration });

    expect(after.raw_data).toEqual({ ...before.raw_data, expiration });
    expect(after.raw_data_hex).not.toBe(before.raw_data_hex);
    expect(after.txID).toBe(sha256(`0x${after.raw_data_hex}`).slice(2));
    expect(readTrc20TransferCall(after.raw_data_hex)).toEqual(readTrc20TransferCall(before.raw_data_hex));
    expect(after.raw_data_hex).toContain(`5220${MEMO.slice(2)}`);
  });

  it.each([
    ['not after the current one', () => EXPIRATION],
    ['more than 24 hours away', () => Date.now() + 25 * 3_600_000],
  ])('refuses an expiration %s', (_label, expiration) => {
    expect(() => tron.extendExpiration({ tx: tx(), expiration: expiration() })).toThrow(
      /must be after the current one and within 24 hours/,
    );
  });
});

describe('TronSpokeService.estimateGas', () => {
  const rawTx = (raw: string): TronRawTransaction => {
    const raw_data_hex = spliceMemo(raw, MEMO);
    return { txID: sha256(`0x${raw_data_hex}`).slice(2), raw_data_hex, raw_data: TRC20_RAW_DATA };
  };
  const bandwidthOf = (raw: string) =>
    BigInt(assembleBroadcastHex({ rawHex: spliceMemo(raw, MEMO), signatures: ['00'.repeat(65)] }).length / 2);

  it('replays the transfer for energy and sizes the given transaction for bandwidth, building nothing', async () => {
    stubTronGrid({ '/wallet/triggerconstantcontract': { result: { result: true }, energy_used: 31_895 } });

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: rawTx(TRC20_RAW) });

    expect(estimate).toEqual({ energy: 31_895n, bandwidth: bandwidthOf(TRC20_RAW) });
    expect(calls.map(c => c.path)).toEqual(['/wallet/triggerconstantcontract']);
    expect(callTo('/wallet/triggerconstantcontract')?.body).toMatchObject({
      owner_address: SENDER,
      contract_address: USDT,
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(RESERVE, AMOUNT),
      visible: true,
    });
  });

  // Shapes TronGrid returns for a transfer that cannot run: a missing contract, and a revert.
  it.each([
    [{ result: { code: 'CONTRACT_VALIDATE_ERROR', message: 'Smart contract is not exist.' } }],
    [{ result: { result: true, message: 'REVERT opcode executed' }, energy_used: 8_624, constant_result: [''] }],
  ])('rejects a failed transfer simulation instead of reporting its energy (%o)', async response => {
    stubTronGrid({ '/wallet/triggerconstantcontract': response });

    await expect(tron.estimateGas({ chainKey: TRON, tx: rawTx(TRC20_RAW) })).rejects.toThrow(
      `transfer simulation on ${USDT} failed`,
    );
  });

  it('reports zero energy for a native TRX transfer, which consumes none', async () => {
    stubTronGrid();

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: rawTx(NATIVE_RAW) });

    expect(estimate).toEqual({ energy: 0n, bandwidth: bandwidthOf(NATIVE_RAW) });
    expect(calls).toHaveLength(0);
  });

  it('reads a 0x-prefixed raw_data_hex the same way', async () => {
    stubTronGrid();
    const tx = rawTx(NATIVE_RAW);

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: { ...tx, raw_data_hex: `0x${tx.raw_data_hex}` } });

    expect(estimate).toEqual({ energy: 0n, bandwidth: bandwidthOf(NATIVE_RAW) });
  });

  it('reports no cost for a raw withdraw-auth, which is signed off chain', async () => {
    stubTronGrid();

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: WITHDRAW });

    expect(estimate).toEqual({ energy: 0n, bandwidth: 0n });
    expect(calls).toHaveLength(0);
  });
});

describe('TronSpokeService.sendMessage', () => {
  const sendParams = {
    srcChainKey: TRON,
    srcAddress: SENDER,
    dstChainKey: 'sonic',
    dstAddress: HUB_WALLET,
    payload: '0xdeadbeef' as Hex,
    walletProvider,
  } as never;

  const nonceOf = (call: number) =>
    BigInt(vi.mocked(MpcRelayApiService.submitWithdraw).mock.calls[call]?.[1].message.nonce ?? '0');

  it.each([
    ['too short', '0x1234'],
    ['too long', `${HUB_WALLET}00`],
    ['not hex', `0x${'zz'.repeat(20)}`],
  ] as const)('refuses a hub wallet that is %s before anything is signed', async (_, dstAddress) => {
    stubTronGrid();
    const submit = vi.spyOn(MpcRelayApiService, 'submitWithdraw');

    const params = {
      srcChainKey: TRON,
      srcAddress: SENDER,
      dstChainKey: 'sonic',
      dstAddress,
      payload: '0x',
      walletProvider,
    };

    await expect(tron.sendMessage(params as never)).rejects.toThrow(`invalid hub wallet address: ${dstAddress}`);
    expect(signMessage).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('accepts a checksummed hub wallet, the form a contract read returns', async () => {
    stubTronGrid();
    const submit = mockSubmitOk();
    const hubWallet = getAddress(`0x${'ab'.repeat(20)}`);
    const params = {
      srcChainKey: TRON,
      srcAddress: SENDER,
      dstChainKey: 'sonic',
      dstAddress: hubWallet,
      payload: '0x',
      walletProvider,
    };

    await tron.sendMessage(params as never);

    expect(hubWallet).not.toBe(hubWallet.toLowerCase());
    expect(submit.mock.calls[0]?.[1].message.to).toBe(hubWallet);
  });

  it('draws a fresh random nonce per withdrawal rather than reading the clock', async () => {
    stubTronGrid();
    mockSubmitOk();

    await tron.sendMessage(sendParams);
    await tron.sendMessage(sendParams);

    // Two withdrawals in the same millisecond must not collide — a clock-derived nonce would.
    expect(nonceOf(0)).not.toBe(nonceOf(1));
    for (const nonce of [nonceOf(0), nonceOf(1)]) {
      expect(nonce).toBeGreaterThan(0n);
      expect(nonce).toBeLessThan(2n ** 64n);
    }
  });

  it('keeps the nonce inside the safe-integer range the relay round-trips it through', async () => {
    stubTronGrid();
    mockSubmitOk();

    // The relay converts the nonce to a JS number before the NEAR call, so a value above
    // MAX_SAFE_INTEGER reaches the contract rounded and the signature recovers a different address.
    for (let i = 0; i < 32; i++) {
      await tron.sendMessage(sendParams);
      const nonce = nonceOf(i);
      expect(nonce).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
      expect(BigInt(Number(nonce))).toBe(nonce);
    }
  });

  it('returns the unsigned withdraw-auth in raw mode, without signing or submitting it', async () => {
    const submit = vi.spyOn(MpcRelayApiService, 'submitWithdraw');

    const raw = await tron.sendMessage<true>({
      srcChainKey: ChainKeys.TRON_MAINNET,
      srcAddress: SENDER,
      dstChainKey: ChainKeys.SONIC_MAINNET,
      dstAddress: HUB_WALLET,
      payload: '0xdeadbeef',
      raw: true,
    });

    expect(raw.message).toMatchObject({
      to: HUB_WALLET,
      data: '0xdeadbeef',
      chainId: '728126428',
      sender: tronIdentityBytes(SENDER),
    });
    // The digest must be the one the relay recomputes from the message, or the signature recovers no one.
    expect(raw.digest).toBe(digestOf(raw.message));
    expect(raw.scheme).toBe(1);
    expect(signMessage).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses an invalid hub wallet in raw mode too', async () => {
    const params = { ...(sendParams as object), dstAddress: '0x1234', raw: true };

    await expect(tron.sendMessage(params as never)).rejects.toThrow('invalid hub wallet address: 0x1234');
  });

  it('signs the digest it would hand out raw, and submits it with the message', async () => {
    const submit = mockSubmitOk();

    const trackingId = await tron.sendMessage(sendParams);

    const request = submit.mock.calls[0]?.[1];
    expect(trackingId).toBe(MEMO);
    expect(request).toMatchObject({ signature: `0x${SIGNATURE}`, scheme: 1 });
    expect(signMessage).toHaveBeenCalledWith(request && digestOf(request.message));
  });
});

describe('TronSpokeService.submitSignedWithdraw', () => {
  it('refuses a digest that no longer matches the message, before submitting', async () => {
    const submit = mockSubmitOk();
    const edited = { ...WITHDRAW, message: { ...WITHDRAW.message, nonce: '8' } };

    await expect(tron.submitSignedWithdraw({ withdraw: edited, signature: `0x${SIGNATURE}` })).rejects.toThrow(
      /digest .* does not match the message/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a scheme other than Tron's, before submitting", async () => {
    const submit = mockSubmitOk();

    await expect(
      tron.submitSignedWithdraw({ withdraw: { ...WITHDRAW, scheme: 0 }, signature: `0x${SIGNATURE}` }),
    ).rejects.toThrow("scheme 0 is not Tron's (1)");
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits a raw withdraw-auth with its signature and resolves to the trackingId', async () => {
    const submit = mockSubmitOk();

    const trackingId = await tron.submitSignedWithdraw({ withdraw: WITHDRAW, signature: `0x${SIGNATURE}` });

    expect(trackingId).toBe(MEMO);
    expect(submit).toHaveBeenCalledWith(expect.anything(), {
      message: WITHDRAW.message,
      signature: `0x${SIGNATURE}`,
      scheme: 1,
    });
  });

  it('throws the relay rejection', async () => {
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: false,
      error: new Error('mpc-relay: withdraw rejected: nonce used'),
    });

    await expect(tron.submitSignedWithdraw({ withdraw: WITHDRAW, signature: `0x${SIGNATURE}` })).rejects.toThrow(
      /nonce used/,
    );
  });
});

describe('TronSpokeService — node request budget', () => {
  it('reports a stalled node as a timeout instead of hanging', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw abort;
      }),
    );

    await expect(
      tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: NATIVE_TRX } as never),
    ).rejects.toThrow(/timed out after \d+ms/);
  });
});

describe('TronSpokeService.getDeposit', () => {
  it('reads balanceOf for a TRC-20', async () => {
    stubTronGrid();

    const balance = await tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: USDT } as never);

    expect(callTo('/wallet/triggerconstantcontract')?.body).toMatchObject({
      contract_address: USDT,
      function_selector: 'balanceOf(address)',
    });
    expect(balance).toBe(0x539n);
  });

  // A failed read still answers 200; parsing its word would show a garbage or zero balance.
  it.each([
    ['is not a contract', { result: { code: 'CONTRACT_VALIDATE_ERROR', message: 'Smart contract is not exist.' } }],
    ['reverted', { result: { result: true, message: 'REVERT opcode executed' }, constant_result: [''] }],
    [
      'reverted with one word of data',
      { result: { result: true, message: 'REVERT opcode executed' }, constant_result: [`${'0'.repeat(63)}1`] },
    ],
    ['answered with no word', { result: { result: true }, constant_result: [] }],
  ])('rejects a TRC-20 read that %s', async (_, response) => {
    stubTronGrid({ '/wallet/triggerconstantcontract': response });

    await expect(tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: USDT } as never)).rejects.toThrow(
      `balanceOf on ${USDT} failed`,
    );
  });

  it('reads the account balance for native TRX', async () => {
    stubTronGrid();

    const balance = await tron.getDeposit({ srcChainKey: TRON, srcAddress: SENDER, token: NATIVE_TRX } as never);

    expect(callTo('/wallet/triggerconstantcontract')).toBeUndefined();
    expect(balance).toBe(42n);
  });
});

describe('TronSpokeService wallet balances', () => {
  const { TRX, USDT: USDT_TOKEN } = spokeChainConfig[ChainKeys.TRON_MAINNET].supportedTokens;

  it('routes a single-token read through SpokeService to the on-chain balance', async () => {
    stubTronGrid();

    const result = await sodax.spoke.getWalletBalance({ srcChainKey: TRON, srcAddress: SENDER, token: USDT_TOKEN });

    expect(result).toEqual({ ok: true, value: 0x539n });
  });

  it('reads TRX and TRC-20 balances in one batch, keyed by token address', async () => {
    stubTronGrid();

    const result = await sodax.spoke.getWalletBalances({
      srcChainKey: TRON,
      srcAddress: SENDER,
      tokens: [TRX, USDT_TOKEN],
    });

    expect(result).toEqual({ ok: true, value: { [TRX.address]: 42n, [USDT_TOKEN.address]: 0x539n } });
  });
});
