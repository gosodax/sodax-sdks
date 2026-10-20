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
import { ChainKeys, spokeChainConfig, type Hex } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { assembleBroadcastHex, encodeTrc20TransferParams, spliceMemo, tronBase58ToHex } from './tron-utils.js';

const sodax = new Sodax();
const tron = sodax.spoke.tron;

const TRON = 'tron' as const;
const NATIVE_TRX = '0x0000000000000000000000000000000000000000';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SENDER = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';
const RESERVE = 'TKEsLgfqRdC9PX88hvW1WWnMhH53qCMe92';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const MEMO = '0xb07ec4b9c2d410c84fb75cb2cf00122f6316cf191ae1fe7bec45ac203c5e13fd' as Hex;
const AMOUNT = 20_000_000n;
const SIGNATURE = 'ab'.repeat(65);

// Minimal well-formed raw_data bodies: low-numbered fields plus the contract field (11) the memo
// has to be spliced ahead of.
const NATIVE_RAW = '0a02abcd40015a020102';
const TRC20_RAW = '0a02beef40025a020304';

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
        '/wallet/createtransaction': { raw_data_hex: NATIVE_RAW },
        '/wallet/triggersmartcontract': { result: { result: true }, transaction: { raw_data_hex: TRC20_RAW } },
        '/wallet/broadcasthex': { result: true },
        '/wallet/getaccount': { balance: 42 },
        '/wallet/triggerconstantcontract': {
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
const signTransaction = vi.fn(async (tx: { txID: string; raw_data_hex: string }) => ({ ...tx, signature: [SIGNATURE] }));

const walletProvider = {
  chainType: 'TRON',
  signTransaction,
  signMessage: vi.fn(async () => `0x${SIGNATURE}`),
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

beforeEach(() => {
  calls = [];
  // `restoreAllMocks` leaves a plain `vi.fn`'s calls in place, so each test would read an earlier one's.
  signTransaction.mockClear();
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
    stubTronGrid({
      '/wallet/triggersmartcontract': {
        result: { result: true },
        transaction: { raw_data_hex: TRC20_RAW, raw_data: { contract: [{ type: 'TriggerSmartContract' }] } },
      },
    });

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

  it('omits raw_data when the node does not return it, rather than inventing one', async () => {
    stubTronGrid();

    await tron.deposit(depositParams(USDT));

    const signed = vi.mocked(signTransaction).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(signed).not.toHaveProperty('raw_data');
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

  it('returns an unsigned descriptor naming the token in raw mode, touching no node', async () => {
    stubTronGrid();

    const raw = await tron.deposit({ ...(depositParams(USDT) as object), raw: true } as never);

    expect(raw).toEqual({ from: SENDER, to: RESERVE, value: AMOUNT, data: MEMO, token: USDT });
    expect(calls).toHaveLength(0);
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

  it('names the native sentinel in the raw descriptor', async () => {
    stubTronGrid();

    const raw = await tron.deposit({ ...(depositParams(NATIVE_TRX) as object), raw: true } as never);

    expect(raw).toMatchObject({ token: NATIVE_TRX, to: RESERVE });
  });
});

describe('TronSpokeService.deposit — rotated reserve', () => {
  // The relay's client contract: `reserveAddress` is not a constant, and a client must pay the
  // address from the CURRENT response. Refusing a rotation would strand deposits, so this warns.
  it('pays the reserve the relay returned even when the chain config names another, and warns', async () => {
    const rotated = 'TYBNgWfhGuNzdLtjKtxXTfskAhTbMcqbaG';
    stubTronGrid();
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

describe('TronSpokeService.deposit — broadcast failure', () => {
  it('keeps the signed txID in the error when the node rejects the broadcast', async () => {
    stubTronGrid({ '/wallet/broadcasthex': { result: false, message: 'DUP_TRANSACTION_ERROR' } });

    await expect(tron.deposit(depositParams(NATIVE_TRX))).rejects.toThrow(
      /broadcast of [0-9a-f]{64} failed: DUP_TRANSACTION_ERROR/,
    );
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('keeps the signed txID in the error when the broadcast call itself fails', async () => {
    stubTronGrid();
    const fetchMock = vi.mocked(fetch);
    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === '/wallet/broadcasthex') throw new Error('aborted');
      return answer ? answer(url, init) : Promise.reject(new Error('no stub'));
    });

    const failure = await tron.deposit(depositParams(NATIVE_TRX)).catch((error: Error) => error);

    expect((failure as Error).message).toMatch(/broadcast of [0-9a-f]{64} failed or timed out/);
    expect(((failure as Error).cause as Error).message).toMatch(/aborted/);
  });
});

describe('TronSpokeService.deposit — notify failure', () => {
  it('keeps the broadcast tx hash in the error so the stranded deposit can be re-notified', async () => {
    stubTronGrid();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const failure = await tron.deposit(depositParams(NATIVE_TRX)).catch((error: Error) => error);

    // The funds are already in the reserve at this point: an error without the hash would lose them.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/\b[0-9a-f]{64} broadcast but the relay was not notified/);
    expect(callTo('/wallet/broadcasthex')).toBeDefined();
    // Notifying twice is harmless, so the transient failure is retried before giving up.
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

describe('TronSpokeService.estimateGas', () => {
  const rawTx = (token: string) => ({ from: SENDER, to: RESERVE, value: AMOUNT, data: MEMO, token });

  it('reports energy from a constant call and bandwidth from the signed transaction size', async () => {
    stubTronGrid({ '/wallet/triggerconstantcontract': { energy_used: 31_895 } });

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: rawTx(USDT) } as never);

    const signed = assembleBroadcastHex(spliceMemo(TRC20_RAW, MEMO), '00'.repeat(65));
    expect(estimate).toEqual({ energy: 31_895n, bandwidth: BigInt(signed.length / 2) });
  });

  it('reports zero energy for a native TRX transfer, which consumes none', async () => {
    stubTronGrid();

    const estimate = await tron.estimateGas({ chainKey: TRON, tx: rawTx(NATIVE_TRX) } as never);

    expect(estimate.energy).toBe(0n);
    expect(estimate.bandwidth).toBeGreaterThan(0n);
    expect(callTo('/wallet/triggerconstantcontract')).toBeUndefined();
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

  it('draws a fresh random nonce per withdrawal rather than reading the clock', async () => {
    stubTronGrid();
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: MEMO },
    });

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
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: MEMO },
    });

    // The relay converts the nonce to a JS number before the NEAR call, so a value above
    // MAX_SAFE_INTEGER reaches the contract rounded and the signature recovers a different address.
    for (let i = 0; i < 32; i++) {
      await tron.sendMessage(sendParams);
      const nonce = nonceOf(i);
      expect(nonce).toBeLessThanOrEqual(BigInt(Number.MAX_SAFE_INTEGER));
      expect(BigInt(Number(nonce))).toBe(nonce);
    }
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
