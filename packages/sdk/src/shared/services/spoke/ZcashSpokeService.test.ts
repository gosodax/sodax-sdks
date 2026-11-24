/**
 * Tests for `ZcashSpokeService` — transparent ZEC settling through the MPC relay in ADDRESS mode.
 *
 * What must not drift: the deposit output pays exactly the derived deposit address and sits at output 0 (the
 * relay keys the deposit on that index), the signed bytes are checked before broadcast, the txid is bare
 * lowercase hex, and withdrawals are authorized by `signmessage` (scheme 6) from the t-address hash160.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concat, keccak256, toHex, type Hex } from 'viem';
import { ChainKeys, type Result, type ZcashUnsignedTransaction } from '@sodax/types';
import { UserRejectsError } from '@tonconnect/sdk';
import { mapRelayFailure } from '../../../errors/relay-error-mapping.js';
import { Sodax } from '../../entities/Sodax.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { inspectZcashV5Deposit, zcashIdentityBytes, zcashP2pkhScript, zcashZip317Fee } from './zcash-utils.js';

const sodax = new Sodax();
const zcash = sodax.spoke.zcash;

const ZCASH = ChainKeys.ZCASH_MAINNET;
const RPC_URL = 'https://zcash-rpc.test';
const SENDER = 't1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs';
const DEPOSIT_ADDRESS = 't1TFab5a31gE6bxzatfs1KSqiportHDCE3X';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const TXID = 'ab'.repeat(32);
const AMOUNT = 1_000_000n;
const settledDeposit = {
  ok: true,
  value: {
    depositId: 'id',
    status: 'minted',
    createdAt: 0,
    txs: { hubMint: { chain: '146', hash: '0xmint', ts: 0 } },
  },
} satisfies Result<MpcRelayApiService.DepositRecord>;
const NATIVE_ZEC = '0x0000000000000000000000000000000000000000';

/** A v5 transparent transaction with no inputs — enough for the output parser. */
function v5TxHex(outputs: { value: bigint; scriptPubKey: string }[]): string {
  const u64 = (v: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    return b.toString('hex');
  };
  const body = outputs.map(
    o => `${u64(o.value)}${(o.scriptPubKey.length / 2).toString(16).padStart(2, '0')}${o.scriptPubKey}`,
  );
  return `050000800a27a7265b16a537000000000000000000${outputs.length.toString(16).padStart(2, '0')}${body.join('')}000000`;
}

type RpcCall = { method: string; params: unknown[] };
let rpcCalls: RpcCall[];
let rpcResults: Record<string, unknown>;
let signed: ZcashUnsignedTransaction | undefined;
let broadcastError: Error | undefined;

const walletProvider = {
  chainType: 'ZCASH',
  getWalletAddress: vi.fn(async () => SENDER),
  signTransaction: vi.fn(async (tx: ZcashUnsignedTransaction) => {
    signed = tx;
    return v5TxHex(tx.outputs);
  }),
  signMessage: vi.fn(async () => `0x${'cd'.repeat(65)}` as Hex),
};

const depositParams = (extra: object = {}) =>
  ({
    srcChainKey: ZCASH,
    srcAddress: SENDER,
    to: HUB_WALLET,
    token: NATIVE_ZEC,
    amount: AMOUNT,
    data: '0x' as Hex,
    walletProvider,
    ...extra,
  }) as never;

const utxo = (txid: string, satoshis: number) => ({ txid, outputIndex: 1, script: zcashP2pkhScript(SENDER), satoshis });

beforeEach(() => {
  signed = undefined;
  broadcastError = undefined;
  rpcCalls = [];
  rpcResults = {
    getblockchaininfo: { consensus: { nextblock: '4dec4df0' } },
    getaddressutxos: [utxo('11'.repeat(32), 400_000), utxo('22'.repeat(32), 2_000_000)],
  };

  const realConfig = sodax.config.getChainConfig(ZCASH);
  vi.spyOn(sodax.config, 'getChainConfig').mockReturnValue({ ...realConfig, rpcUrl: RPC_URL } as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as RpcCall;
      rpcCalls.push({ method, params });
      if (method === 'sendrawtransaction') {
        if (broadcastError) throw broadcastError;
        return Response.json({ result: inspectZcashV5Deposit(String(params[0])).txid.toUpperCase(), error: null });
      }
      return new Response(JSON.stringify({ result: rpcResults[method], error: null }));
    }),
  );

  vi.spyOn(MpcRelayApiService, 'getDepositAddress').mockResolvedValue({
    ok: true,
    value: {
      depositMethod: 'address',
      depositAddress: DEPOSIT_ADDRESS,
      payloadHash: `0x${'00'.repeat(32)}`,
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

describe('ZcashSpokeService.deposit', () => {
  it('returns the derived deposit address and amount in raw mode, touching no RPC', async () => {
    const tx = await zcash.deposit({ ...(depositParams() as object), raw: true } as never);

    expect(tx).toEqual({
      from: SENDER,
      to: DEPOSIT_ADDRESS,
      value: AMOUNT,
      data: `0x${'00'.repeat(32)}`,
      token: NATIVE_ZEC,
    });
    expect(rpcCalls).toEqual([]);
  });

  it('pays the deposit address at output 0, returns change to the sender and notifies with the bare txid', async () => {
    const txid = await zcash.deposit(depositParams());

    const sent = rpcCalls.find(c => c.method === 'sendrawtransaction');
    expect(txid).toBe(inspectZcashV5Deposit(String(sent?.params[0])).txid);
    // The largest UTXO covers amount + fee alone.
    expect(signed?.inputs.map(i => i.txid)).toEqual(['22'.repeat(32)]);
    expect(signed?.consensusBranchId).toBe(0x4dec4df0);
    expect(signed?.outputs).toEqual([
      { value: AMOUNT, scriptPubKey: zcashP2pkhScript(DEPOSIT_ADDRESS) },
      { value: 2_000_000n - AMOUNT - zcashZip317Fee(1, 2), scriptPubKey: zcashP2pkhScript(SENDER) },
    ]);
    expect(rpcCalls.find(c => c.method === 'getaddressutxos')?.params).toEqual([{ addresses: [SENDER] }]);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '133', txid);
  });

  it('preserves a wallet refusal without broadcasting or notifying the relay', async () => {
    const refusal = new UserRejectsError('rejected');
    walletProvider.signTransaction.mockRejectedValueOnce(refusal);

    await expect(zcash.deposit(depositParams())).rejects.toBe(refusal);
    expect(rpcCalls.some(call => call.method === 'sendrawtransaction')).toBe(false);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('notifies the locally derived txid when the broadcast response is lost', async () => {
    broadcastError = new Error('connection lost after broadcast');
    const result: unknown = await zcash.deposit(depositParams()).catch((error: unknown) => error);
    const sent = rpcCalls.filter(call => call.method === 'sendrawtransaction');
    expect(sent).toHaveLength(1);
    const bytes = String(sent[0]?.params[0]);
    const { txid } = inspectZcashV5Deposit(bytes);
    expect(result).toMatchObject({ name: 'IndeterminateOutcomeError', txHash: txid, cause: broadcastError });
    expect(JSON.stringify(result)).not.toContain(bytes);
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '133', txid);
    expect(walletProvider.signTransaction).toHaveBeenCalledOnce();
  });

  it('adds inputs until they cover the amount and the fee', async () => {
    rpcResults.getaddressutxos = [utxo('11'.repeat(32), 600_000), utxo('22'.repeat(32), 500_000)];

    await zcash.deposit(depositParams());

    expect(signed?.inputs).toHaveLength(2);
    expect(signed?.outputs[1]?.value).toBe(1_100_000n - AMOUNT - zcashZip317Fee(2, 2));
  });

  it('leaves change below dust to the fee rather than creating an unspendable output', async () => {
    rpcResults.getaddressutxos = [utxo('11'.repeat(32), Number(AMOUNT + zcashZip317Fee(1, 2) + 53n))];

    await zcash.deposit(depositParams());

    expect(signed?.outputs).toEqual([{ value: AMOUNT, scriptPubKey: zcashP2pkhScript(DEPOSIT_ADDRESS) }]);
  });

  it('refuses a deposit the UTXOs cannot cover, before signing anything', async () => {
    rpcResults.getaddressutxos = [utxo('11'.repeat(32), Number(AMOUNT))];

    await expect(zcash.deposit(depositParams())).rejects.toThrow(/insufficient ZEC/);
    expect(walletProvider.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses to broadcast a signed transaction that pays a different address', async () => {
    walletProvider.signTransaction.mockImplementationOnce(async tx =>
      v5TxHex([{ value: AMOUNT, scriptPubKey: `76a914${'99'.repeat(20)}88ac` }, ...tx.outputs.slice(1)]),
    );

    await expect(zcash.deposit(depositParams())).rejects.toThrow(/does not pay exactly/);
    expect(rpcCalls.some(c => c.method === 'sendrawtransaction')).toBe(false);
  });

  it('refuses to broadcast a signed transaction with an extra output', async () => {
    walletProvider.signTransaction.mockImplementationOnce(async tx =>
      v5TxHex([...tx.outputs, { value: 1n, scriptPubKey: `76a914${'99'.repeat(20)}88ac` }]),
    );

    await expect(zcash.deposit(depositParams())).rejects.toThrow(/unexpected output/);
    expect(rpcCalls.some(c => c.method === 'sendrawtransaction')).toBe(false);
  });

  it('refuses a memo-mode relay response', async () => {
    vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValueOnce({
      ok: true,
      value: {
        depositMethod: 'memo',
        reserveAddress: DEPOSIT_ADDRESS,
        memo: `0x${'00'.repeat(32)}`,
        payloadHash: `0x${'00'.repeat(32)}`,
        path: 'm/0',
        hubWallet: HUB_WALLET,
      },
    });

    await expect(zcash.deposit(depositParams())).rejects.toThrow(/expected address/);
    expect(walletProvider.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses a deposit whose target disagrees with the hub wallet the relay derives', async () => {
    await expect(zcash.deposit(depositParams({ to: '0x9999999999999999999999999999999999999999' }))).rejects.toThrow(
      /relay derives hub wallet/,
    );
    expect(walletProvider.signTransaction).not.toHaveBeenCalled();
  });

  it('still resolves to the txid when the relay cannot be notified, leaving the re-notify to settlement', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = zcash.deposit(depositParams());
    await vi.runAllTimersAsync();

    // The funds are already on chain: the txid is what settlement waits on and re-notifies.
    const sent = rpcCalls.find(call => call.method === 'sendrawtransaction');
    expect(await pending).toBe(inspectZcashV5Deposit(String(sent?.params[0])).txid);
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });

  it('explains a missing RPC endpoint instead of failing on an empty URL', async () => {
    vi.mocked(sodax.config.getChainConfig).mockReturnValue({
      ...sodax.config.sodaxConfig.chains[ZCASH],
      rpcUrl: '',
    } as never);

    await expect(zcash.deposit(depositParams())).rejects.toThrow(/no Zcash RPC configured/);
  });

  it('checks RPC configuration before requesting a deposit address or signing with a raw key', async () => {
    vi.mocked(sodax.config.getChainConfig).mockReturnValue({
      ...sodax.config.sodaxConfig.chains[ZCASH],
      rpcUrl: '',
    } as never);

    await expect(zcash.deposit(depositParams())).rejects.toThrow(/no Zcash RPC configured/);
    expect(MpcRelayApiService.getDepositAddress).not.toHaveBeenCalled();
    expect(walletProvider.signTransaction).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('ZcashSpokeService.deposit — wallet that sends the payment itself', () => {
  const DEPOSIT_SCRIPT = zcashP2pkhScript(DEPOSIT_ADDRESS);
  const browserWallet = {
    chainType: 'ZCASH',
    getWalletAddress: vi.fn(async () => SENDER),
    sendTransfer: vi.fn(async () => `0x${'cd'.repeat(32)}`),
    signMessage: vi.fn(async () => `0x${'cd'.repeat(65)}` as Hex),
  };
  const BROWSER_TXID = 'cd'.repeat(32);
  const walletTx = (deposit: { value: bigint; script: string }) => ({
    txid: BROWSER_TXID,
    vout: [
      { n: 0, valueZat: 42_000, scriptPubKey: { hex: zcashP2pkhScript(SENDER) } },
      { n: 1, valueZat: Number(deposit.value), scriptPubKey: { hex: deposit.script } },
    ],
  });

  it('lets the wallet pay the deposit address, notifies the relay and keys the deposit on the output it chose', async () => {
    rpcResults.getrawtransaction = walletTx({ value: AMOUNT, script: DEPOSIT_SCRIPT });
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settledDeposit);

    const txid = await zcash.deposit(depositParams({ walletProvider: browserWallet }));

    expect(txid).toBe(BROWSER_TXID);
    expect(browserWallet.sendTransfer).toHaveBeenCalledWith({ to: DEPOSIT_ADDRESS, amount: AMOUNT });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '133', BROWSER_TXID);
    // The sdk builds nothing: no UTXO selection and no broadcast of its own.
    expect(rpcCalls.map(c => c.method)).toEqual(['getrawtransaction']);

    await zcash.waitForDeposit(txid);
    expect(wait.mock.calls[0]?.[1]).toBe(`133-${BROWSER_TXID}-1`);
  });

  it('reports a wallet transaction that does not pay exactly the amount to the deposit address', async () => {
    rpcResults.getrawtransaction = walletTx({ value: AMOUNT - 1n, script: DEPOSIT_SCRIPT });
    browserWallet.sendTransfer.mockResolvedValueOnce(`0x${'a1'.repeat(32)}`);

    await expect(zcash.deposit(depositParams({ walletProvider: browserWallet }))).rejects.toMatchObject({
      message: expect.stringContaining(`transaction ${'a1'.repeat(32)} does not pay exactly`),
      txHash: 'a1'.repeat(32),
    });
  });

  it('checks RPC configuration before requesting a deposit address or paying', async () => {
    vi.useFakeTimers();
    vi.mocked(sodax.config.getChainConfig).mockReturnValue({
      ...sodax.config.sodaxConfig.chains[ZCASH],
      rpcUrl: '',
    } as never);

    const pending = zcash.deposit(depositParams({ walletProvider: browserWallet })).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ message: expect.stringContaining('no Zcash RPC configured') });
    expect(MpcRelayApiService.getDepositAddress).not.toHaveBeenCalled();
    expect(browserWallet.sendTransfer).not.toHaveBeenCalled();
  });

  it('warns and returns the txid promptly when the output lookup RPC fails', async () => {
    vi.useFakeTimers();
    const txid = 'ad'.repeat(32);
    browserWallet.sendTransfer.mockResolvedValueOnce(txid);
    vi.mocked(fetch).mockRejectedValue(new Error('RPC offline'));
    const warn = vi.spyOn(sodax.config.logger, 'warn');
    const finished = vi.fn();
    const pending = zcash.deposit(depositParams({ walletProvider: browserWallet })).then(finished);

    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toHaveBeenCalledWith(txid);
    expect(warn).toHaveBeenCalled();
    await pending;
  });

  it('still returns the txid when the node never sees the transaction, leaving the output to be found later', async () => {
    vi.useFakeTimers();
    const txid = 'ef'.repeat(32);
    browserWallet.sendTransfer.mockResolvedValueOnce(`0x${txid}`);
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: -5, message: 'No such mempool or main chain transaction' } })),
    );
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    const finished = vi.fn();
    const pending = zcash.deposit(depositParams({ walletProvider: browserWallet })).then(finished);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toHaveBeenCalledWith(txid);
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ txid }));
    await pending;
  });

  it('refuses a wallet provider that can neither sign nor send', async () => {
    const { signTransaction: _, ...messageOnly } = walletProvider;

    await expect(zcash.deposit(depositParams({ walletProvider: messageOnly }))).rejects.toThrow(
      /neither signTransaction nor sendTransfer/,
    );
  });
});

describe('ZcashSpokeService.waitForDeposit', () => {
  it('keys a deposit this service built on the bare lowercase txid and output 0', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settledDeposit);
    const txid = await zcash.deposit(depositParams());

    await zcash.waitForDeposit(`0x${txid.toUpperCase()}`, Number.NaN);

    expect(wait.mock.calls[0]?.[2]?.timeout).toBe(900_000);

    expect(wait.mock.calls[0]?.[1]).toBe(`133-${txid}-0`);
  });

  it('probes outputs 0 and 1 while the node has not seen the transaction', async () => {
    vi.useFakeTimers();
    const txid = '12'.repeat(32);
    let visits = 0;
    const getDeposit = vi.spyOn(MpcRelayApiService, 'getDeposit').mockImplementation(async (_url, depositId) => {
      if (depositId === `133-${txid}-0`) return { ok: false, error: new Error('404') };
      if (++visits === 1) {
        return { ok: true, value: { depositId, status: 'minted', createdAt: 0, txs: {} } };
      }
      return settledDeposit;
    });

    const pending = zcash.waitForDeposit(txid);
    await vi.advanceTimersByTimeAsync(900_000);
    const result = await pending;

    expect(result).toBe(settledDeposit);
    expect(getDeposit.mock.calls.map(c => c[1])).toContain(`133-${txid}-0`);
  });

  it('keeps polling an RPC-discovered minted output until the hub mint hash arrives', async () => {
    vi.useFakeTimers();
    const txid = '78'.repeat(32);
    rpcResults.getrawtransaction = { txid, vout: [{ n: 2 }] };
    vi.spyOn(MpcRelayApiService, 'getDeposit')
      .mockResolvedValueOnce({ ok: true, value: { depositId: 'id', status: 'minted', createdAt: 0, txs: {} } })
      .mockResolvedValue(settledDeposit);

    const pending = zcash.waitForDeposit(txid);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(settledDeposit);
  });

  it('maps an output lookup settlement timeout to RELAY_TIMEOUT', async () => {
    vi.useFakeTimers();
    vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue({ ok: false, error: new Error('404') });

    const pending = zcash.waitForDeposit('89'.repeat(32));
    await vi.advanceTimersByTimeAsync(900_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(mapRelayFailure(result.error, { feature: 'bridge' }).code).toBe('RELAY_TIMEOUT');
  });

  it('re-notifies the relay while waiting, and stops once the wait settles', async () => {
    const txid = await zcash.deposit(depositParams());
    vi.useFakeTimers();
    let settle: (value: Result<MpcRelayApiService.DepositRecord>) => void = () => undefined;
    vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockReturnValue(new Promise(resolve => (settle = resolve)));
    const notifySpy = vi.mocked(MpcRelayApiService.notify);

    notifySpy.mockClear();
    const pending = zcash.waitForDeposit(txid);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(notifySpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    settle(settledDeposit);
    await pending;
    notifySpy.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

describe('ZcashSpokeService — relay submit and read', () => {
  const HUB_RELEASE = { dstChainKey: ZCASH, hubChainId: '146', hubTxHash: '0xhub', logIndex: 3 } as const;
  const pendingRecord = {
    ok: true as const,
    value: { depositId: 'id', status: 'pending' as const, createdAt: 0, txs: {} },
  };

  it('submitDeposit notifies the relay of the bare lowercase txid on the Zcash relay id, without polling', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await zcash.submitDeposit(`0x${TXID.toUpperCase()}`)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '133', TXID);
    expect(wait).not.toHaveBeenCalled();
  });

  it('submitDeposit keeps the txid in the failure so the deposit can be re-notified', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = zcash.submitDeposit(TXID);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(!result.ok && (result.error as Error).message).toContain(`deposit ${TXID} was not notified`);
  });

  it('getDepositRecord reads a deposit this instance made by its known output index, without fetching the tx', async () => {
    const txid = await zcash.deposit(depositParams());
    rpcCalls = [];
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(settledDeposit);

    expect(await zcash.getDepositRecord(txid)).toBe(settledDeposit);
    expect(read.mock.calls[0]?.[1]).toBe(`133-${txid}-0`);
    expect(rpcCalls).toEqual([]);
  });

  it('getDepositRecord prefers a settled output when it must read every output of an unknown transaction', async () => {
    // A txid no earlier test used: the shared instance remembers the output index of those it has settled.
    const txid = '34'.repeat(32);
    rpcResults.getrawtransaction = { txid, vout: [{ n: 0 }, { n: 1 }, { n: 2 }] };
    vi.spyOn(MpcRelayApiService, 'getDeposit').mockImplementation(async (_url, depositId) => {
      if (depositId === `133-${txid}-0`) return { ok: false, error: new Error('404') };
      return depositId === `133-${txid}-1` ? pendingRecord : settledDeposit;
    });

    expect(await zcash.getDepositRecord(txid)).toBe(settledDeposit);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('probes outputs 0 and 1 when it cannot fetch the transaction', async () => {
    const txid = '45'.repeat(32);
    vi.mocked(fetch).mockRejectedValue(new Error('RPC offline'));
    const read = vi
      .spyOn(MpcRelayApiService, 'getDeposit')
      .mockResolvedValueOnce({ ok: false, error: new Error('404') })
      .mockResolvedValueOnce(settledDeposit);

    expect(await zcash.getDepositRecord(txid)).toBe(settledDeposit);
    expect(read.mock.calls.map(c => c[1])).toEqual([`133-${txid}-0`, `133-${txid}-1`]);
  });

  it('waitForHubRelease uses the settlement floor for a NaN timeout', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForHubRelease').mockResolvedValue(settledDeposit);

    await zcash.waitForHubRelease(HUB_RELEASE, Number.NaN);

    expect(wait).toHaveBeenCalledWith(expect.anything(), HUB_RELEASE, expect.objectContaining({ timeout: 900_000 }));
  });

  it('getDepositRecord reports the relay failure when no output has a record', async () => {
    const txid = '56'.repeat(32);
    rpcResults.getrawtransaction = { txid, vout: [{ n: 0 }] };
    const failure = { ok: false as const, error: new Error('404') };
    vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(failure);

    expect(await zcash.getDepositRecord(txid)).toBe(failure);
  });

  it('submitHubRelease notifies the hub tx as a withdrawal on the hub chain id', async () => {
    expect(await zcash.submitHubRelease(HUB_RELEASE)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '146', '0xhub', 'withdrawal');
  });

  it('reads a withdrawal and a hub release once each, notifying nothing', async () => {
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue(pendingRecord);
    vi.spyOn(MpcRelayApiService, 'getWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'submitted' },
    });

    expect(await zcash.getHubReleaseRecord(HUB_RELEASE)).toBe(pendingRecord);
    expect(read).toHaveBeenCalledOnce();
    expect((await zcash.getWithdrawalRecord('0xtrack')).ok).toBe(true);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('waitForWithdrawal passes the stage to stop on through to the relay poll', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForWithdrawal').mockResolvedValue({
      ok: true,
      value: { trackingId: '0xtrack', status: 'burned' },
    });

    await zcash.waitForWithdrawal('0xtrack', Number.NaN, 'burned');

    expect(wait).toHaveBeenCalledWith(
      expect.anything(),
      '0xtrack',
      expect.objectContaining({ until: 'burned', timeout: 900_000 }),
    );
  });
});

describe('ZcashSpokeService.sendMessage', () => {
  const sendParams = () =>
    ({
      srcChainKey: ZCASH,
      srcAddress: SENDER,
      dstChainKey: 'sonic',
      dstAddress: HUB_WALLET,
      payload: '0xdeadbeef' as Hex,
      walletProvider,
    }) as never;

  const submitCall = (call: number) => vi.mocked(MpcRelayApiService.submitWithdraw).mock.calls[call]?.[1];

  beforeEach(() => {
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: HUB_WALLET },
    });
  });

  it('submits scheme 6 with the relay chain id and the t-address hash160 as sender', async () => {
    const trackingId = await zcash.sendMessage(sendParams());

    expect(trackingId).toBe(HUB_WALLET);
    expect(submitCall(0)).toMatchObject({ scheme: 6, signature: `0x${'cd'.repeat(65)}` });
    expect(submitCall(0)?.message).toMatchObject({
      chainId: '133',
      sender: zcashIdentityBytes(SENDER),
      to: HUB_WALLET,
    });
    expect(submitCall(0)).not.toHaveProperty('publicKey');
  });

  it('keeps the nonce inside the safe-integer range the relay round-trips it through', async () => {
    for (let i = 0; i < 16; i++) {
      await zcash.sendMessage(sendParams());
      const nonce = BigInt(submitCall(i)?.message.nonce ?? '0');
      expect(BigInt(Number(nonce))).toBe(nonce);
    }
  });

  it.each(['accepted', 'exhausted', 'lost reply'])('first 429 through sendMessage: %s', async outcome => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.submitWithdraw).mockRestore();
    const lost = new Error('lost relay reply');
    const sender = zcashIdentityBytes(SENDER);
    const send = vi.fn(async (_url: string, init?: RequestInit) => {
      if (send.mock.calls.length === 1 || outcome === 'exhausted') return new Response(null, { status: 429 });
      if (outcome === 'lost reply') throw lost;
      const { message } = JSON.parse(String(init?.body));
      const trackingId = keccak256(concat([sender, toHex(BigInt(message.nonce), { size: 8 })]));
      return Response.json({ accepted: true, trackingId });
    });
    vi.stubGlobal('fetch', send);
    const pending = zcash.sendMessage(sendParams()).then(
      value => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    const request = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    const trackingId = keccak256(concat([sender, toHex(BigInt(request.message.nonce), { size: 8 })]));
    if (outcome === 'accepted') {
      expect(result).toEqual({ ok: true, value: trackingId });
    } else if (outcome === 'lost reply') {
      expect(result).toMatchObject({
        ok: false,
        error: { name: 'IndeterminateOutcomeError', cause: lost, trackingId },
      });
    } else {
      if (result.ok) throw new Error('expected throttling exhaustion');
      expect(result.error).toMatchObject({ message: expect.stringContaining('nothing was queued') });
      expect(result.error).not.toHaveProperty('trackingId');
    }
    expect(walletProvider.signMessage).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(outcome === 'exhausted' ? 3 : 2);
    expect(new Set(send.mock.calls.map(([, init]) => init?.body)).size).toBe(1);
  });

  it('refuses raw mode, which has no spoke transaction to return', async () => {
    await expect(zcash.sendMessage({ ...(sendParams() as object), raw: true } as never)).rejects.toThrow(
      /raw mode is not supported/,
    );
  });
});

describe('ZcashSpokeService reads', () => {
  it('reads the transparent balance of the owner', async () => {
    rpcResults.getaddressbalance = { balance: 12_345, received: 0 };

    expect(await zcash.getDeposit({ srcChainKey: ZCASH, srcAddress: SENDER, token: NATIVE_ZEC } as never)).toBe(
      12_345n,
    );
    expect(rpcCalls[0]).toEqual({ method: 'getaddressbalance', params: [{ addresses: [SENDER] }] });
  });

  it('estimates the ZIP-317 fee of a one-input deposit with change', async () => {
    expect(await zcash.estimateGas({} as never)).toEqual({ fee: 10_000n });
  });

  it('bounds a hanging RPC by the receipt wall-clock budget', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const finished = vi.fn();
    const pending = zcash
      .waitForTransactionReceipt({
        chainKey: ZCASH,
        txHash: TXID,
        pollingIntervalMs: 5,
        maxTimeoutMs: 20,
      })
      .then(finished);

    await vi.advanceTimersByTimeAsync(20);
    expect(finished).toHaveBeenCalledWith({ ok: true, value: { status: 'timeout', error: expect.any(Error) } });
    await pending;
  });

  it('reports a receipt once the transaction has a confirmation', async () => {
    rpcResults.getrawtransaction = { txid: TXID, confirmations: 1, height: 3_000_000 };

    const result = await zcash.waitForTransactionReceipt({
      chainKey: ZCASH,
      txHash: `0x${TXID}`,
      pollingIntervalMs: 1,
      maxTimeoutMs: 10,
    } as never);

    expect(result).toEqual({ ok: true, value: { status: 'success', receipt: rpcResults.getrawtransaction } });
    expect(rpcCalls[0]?.params).toEqual([TXID, 1]);
  });
});

describe('SpokeService routing for Zcash', () => {
  it('resolves Zcash to its own service', () => {
    expect(sodax.spoke.getSpokeService(ZCASH)).toBe(zcash);
  });
});
