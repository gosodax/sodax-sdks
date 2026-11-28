/**
 * Tests for `MonadSpokeService` — an EVM chain that settles through the MPC relay in ADDRESS mode.
 *
 * What differs from the memo-mode chains (Tron, XRP) and must not drift: the deposit pays a per-payload
 * derived address rather than the reserve, an ERC-20 deposit is keyed by its Transfer log index while a
 * native one is keyed at 0, and withdrawals are authorized by EIP-191 (scheme 0).
 */

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  concat,
  decodeFunctionData,
  encodeEventTopics,
  isHex,
  keccak256,
  pad,
  recoverMessageAddress,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { SpokeServiceType } from './SpokeService.js';
import { IndeterminateOutcomeError, spokeChainConfig } from '@sodax/types';
import { Sodax } from '../../entities/Sodax.js';
import { erc20Abi } from '../../abis/index.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { computeSignedMessageHash } from './mpc-message.js';
import { HUB_WALLET, depositParamsFor } from './spoke-test-fixtures.js';

const sodax = new Sodax();
const monad = sodax.spoke.monad;

const MONAD = 'monad' as const;
const NATIVE_MON = '0x0000000000000000000000000000000000000000';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const SENDER = '0xf62fffa4d92bcdfc310dccbe943747fe8302e871' as const;
const DEPOSIT_ADDRESS = '0x2222222222222222222222222222222222222222';
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const AMOUNT = 5_000_000n;
const tokens = [spokeChainConfig.monad.supportedTokens.MON, spokeChainConfig.monad.supportedTokens.USDC];

type FakeReceipt = { status: 'success' | 'reverted'; logs: unknown[] };

let receipt: FakeReceipt;

const publicClient = {
  waitForTransactionReceipt: vi.fn(async () => receipt),
  getBalance: vi.fn(async () => 7n),
  readContract: vi.fn(async () => 9n),
  estimateGas: vi.fn(async () => 21_000n),
};

const sendTransaction = vi.fn(async () => TX_HASH);
const signMessage = vi.fn(async () => `0x${'cd'.repeat(65)}` as Hex);
const walletProvider = {
  chainType: 'EVM',
  sendTransaction,
  signMessage,
  getWalletAddress: async () => SENDER,
} as never;

const depositParams = depositParamsFor({ srcChainKey: MONAD, srcAddress: SENDER, amount: AMOUNT, walletProvider });

/** A USDC Transfer log to the deposit address, at the given block-level log index. */
const usdcTransferLog = (logIndex: number, address = USDC) => ({
  address,
  logIndex,
  data: pad(`0x${AMOUNT.toString(16)}`),
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: SENDER, to: DEPOSIT_ADDRESS } }),
  blockHash: `0x${'00'.repeat(32)}`,
  blockNumber: 1n,
  transactionHash: TX_HASH,
  transactionIndex: 0,
  removed: false,
});

beforeEach(() => {
  receipt = { status: 'success', logs: [] };
  vi.spyOn(monad, 'getPublicClient').mockReturnValue(publicClient as never);
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

describe('MonadSpokeService.deposit', () => {
  it('refuses a deposit it cannot route to the right account before sending anything', async () => {
    const zeroAddress = {
      ok: true,
      value: {
        depositMethod: 'address',
        depositAddress: NATIVE_MON,
        payloadHash: TX_HASH,
        path: 'm/0',
        hubWallet: HUB_WALLET,
      },
    } as const;
    // A memo-mode answer would pay a shared reserve without the memo that attributes it.
    const memoMode = {
      ok: true,
      value: {
        depositMethod: 'memo',
        reserveAddress: DEPOSIT_ADDRESS,
        memo: `0x${'00'.repeat(32)}`,
        payloadHash: `0x${'00'.repeat(32)}`,
        path: 'm/0',
        hubWallet: HUB_WALLET,
      },
    } as const;
    const otherAccount = { chainType: 'EVM', sendTransaction, getWalletAddress: async () => DEPOSIT_ADDRESS };
    const rows = [
      {
        label: 'zero relay deposit address (signed)',
        params: depositParams(NATIVE_MON),
        relay: zeroAddress,
        reason: /invalid deposit address/,
      },
      {
        label: 'zero relay deposit address (raw)',
        params: depositParams(NATIVE_MON, { raw: true }),
        relay: zeroAddress,
        reason: /invalid deposit address/,
      },
      { label: 'unsupported token', params: depositParams(HUB_WALLET), reason: /unsupported token/, beforeRelay: true },
      {
        label: 'memo-mode relay response',
        params: depositParams(NATIVE_MON),
        relay: memoMode,
        reason: /expected address/,
      },
      {
        label: 'target other than the derived hub wallet',
        params: depositParams(NATIVE_MON, { to: '0x9999999999999999999999999999999999999999' }),
        reason: /relay derives hub wallet/,
      },
      {
        label: 'mismatched wallet account',
        params: depositParams(NATIVE_MON, { walletProvider: otherAccount }),
        reason: /wallet account does not match/,
      },
    ];

    for (const { label, params, relay, reason, beforeRelay } of rows) {
      vi.mocked(MpcRelayApiService.getDepositAddress).mockClear();
      if (relay) vi.mocked(MpcRelayApiService.getDepositAddress).mockResolvedValueOnce(relay);
      await expect(monad.deposit(params), label).rejects.toThrow(reason);
      if (beforeRelay) expect(MpcRelayApiService.getDepositAddress, label).not.toHaveBeenCalled();
    }
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('notifies with the original signed hash when the broadcast response is lost', async () => {
    const cause = new Error('lost RPC reply');
    const failure = new IndeterminateOutcomeError('deposit broadcast unknown', { cause, txHash: TX_HASH });
    sendTransaction.mockRejectedValueOnce(failure);
    await expect(monad.deposit(depositParams(USDC))).rejects.toBe(failure);
    expect(MpcRelayApiService.notify).toHaveBeenCalledExactlyOnceWith(expect.anything(), '48', TX_HASH);
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it('propagates a wallet refusal of the send, user rejection or wrong network, without polling or notifying', async () => {
    const refusal = new Error('User rejected the request');
    sendTransaction.mockRejectedValueOnce(refusal);
    await expect(monad.deposit(depositParams(USDC))).rejects.toBe(refusal);

    const wrongNetwork = vi.fn(async (_tx: unknown, options?: { expectedChainId?: number }) => {
      if (options?.expectedChainId !== undefined && options.expectedChainId !== 1) throw new Error('wrong network');
      return TX_HASH;
    });
    const onWrongNetwork = { chainType: 'EVM', sendTransaction: wrongNetwork, getWalletAddress: async () => SENDER };
    await expect(monad.deposit(depositParams(NATIVE_MON, { walletProvider: onWrongNetwork }))).rejects.toThrow(
      'wrong network',
    );
    expect(wrongNetwork).toHaveBeenCalledWith(expect.anything(), {
      expectedChainId: 143,
      preserveDepositOutcome: true,
    });

    expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('in raw mode pays the derived deposit address, not the reserve: MON as value, an ERC-20 as a plain transfer', async () => {
    expect(await monad.deposit(depositParams(NATIVE_MON, { raw: true }))).toEqual({
      from: SENDER,
      to: DEPOSIT_ADDRESS,
      value: AMOUNT,
      data: '0x',
    });

    // The never-typed params erase `raw`, so the call is typed as returning the hash rather than the raw tx.
    const tx = (await monad.deposit(depositParams(USDC, { raw: true }))) as unknown as {
      to: string;
      value: bigint;
      data: Hex;
    };
    expect(tx.to).toBe(USDC);
    expect(tx.value).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toMatchObject({
      functionName: 'transfer',
      args: [DEPOSIT_ADDRESS, AMOUNT],
    });
  });

  it('sends the transfer on the Monad network, waits for it to land, notifies the relay and returns the tx hash', async () => {
    const hash = await monad.deposit(depositParams(NATIVE_MON));

    expect(hash).toBe(TX_HASH);
    expect(sendTransaction).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      expectedChainId: 143,
      preserveDepositOutcome: true,
    });
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH, timeout: 60_000 });
    // The relay's id for Monad is 48, not the EVM network id 143.
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '48', TX_HASH);
  });

  it('does not notify the relay about a transfer that reverted, keeping the hash in the error', async () => {
    receipt = { status: 'reverted', logs: [] };

    const error = await monad.deposit(depositParams(USDC)).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: expect.stringMatching(/reverted/) });
    expect(error).toMatchObject({ message: expect.stringContaining(TX_HASH) });
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('preserves the broadcast hash and notifies once when receipt polling fails', async () => {
    const warn = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {
      throw new Error('custom logger failed');
    });
    publicClient.waitForTransactionReceipt.mockRejectedValueOnce(new Error('RPC timeout'));
    await expect(monad.deposit(depositParams(USDC))).resolves.toBe(TX_HASH);
    expect(MpcRelayApiService.notify).toHaveBeenCalledExactlyOnceWith(expect.anything(), '48', TX_HASH);
    expect(warn).toHaveBeenCalled();
  });

  it('still resolves to the tx hash when the relay cannot be notified, leaving the re-notify to settlement', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = monad.deposit(depositParams(NATIVE_MON));
    await vi.runAllTimersAsync();

    // The funds already moved: the hash is what settlement waits on and re-notifies.
    expect(await pending).toBe(TX_HASH);
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('MonadSpokeService — relay submit and read', () => {
  const HUB_RELEASE = { dstChainKey: MONAD, hubChainId: '146', hubTxHash: '0xhub', logIndex: 3 } as const;

  it('submitDeposit notifies the relay on the Monad relay id, without polling', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit');

    expect(await monad.submitDeposit(TX_HASH)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '48', TX_HASH);
    expect(wait).not.toHaveBeenCalled();
  });

  it('submitDeposit keeps the tx hash in the failure so the deposit can be re-notified', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = monad.submitDeposit(TX_HASH);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(!result.ok && (result.error as Error).message).toContain(`deposit ${TX_HASH} was not notified`);
  });

  it('getDepositRecord reads the record by the Transfer log index without waiting for the receipt', async () => {
    const read = vi.spyOn(MpcRelayApiService, 'getDeposit').mockResolvedValue({
      ok: true,
      value: { depositId: 'id', status: 'pending', createdAt: 0, txs: {} },
    });
    receipt = { status: 'success', logs: [usdcTransferLog(5)] };
    const getReceipt = vi.fn(async () => receipt);
    vi.spyOn(monad, 'getPublicClient').mockReturnValue({ ...publicClient, getTransactionReceipt: getReceipt } as never);

    await monad.getDepositRecord(TX_HASH);

    expect(read.mock.calls[0]?.[1]).toBe(`48-${TX_HASH}-5`);
    expect(getReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
    expect(publicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('getDepositRecord reports a tx the node cannot find as a failure rather than rejecting', async () => {
    vi.spyOn(monad, 'getPublicClient').mockReturnValue({
      ...publicClient,
      getTransactionReceipt: vi.fn(async () => {
        throw new Error('not found');
      }),
    } as never);

    expect((await monad.getDepositRecord(TX_HASH)).ok).toBe(false);
  });

  it('submitHubRelease notifies the hub tx as a withdrawal on the hub chain id', async () => {
    expect(await monad.submitHubRelease(HUB_RELEASE)).toEqual({ ok: true, value: undefined });
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '146', '0xhub', 'withdrawal');
  });
});

describe('MonadSpokeService waits', () => {
  const settled = { ok: true, value: { depositId: 'id', status: 'minted', createdAt: 0, txs: {} } } as never;

  it('keys a native deposit at log index 0, ignoring unsupported-token logs, and an ERC-20 at its Transfer log index', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settled);

    // Log index 0 is how the verifier records a value transfer.
    await monad.waitForDeposit(TX_HASH);
    receipt = { status: 'success', logs: [usdcTransferLog(3, '0x3333333333333333333333333333333333333333')] };
    await monad.waitForDeposit(TX_HASH);
    receipt = { status: 'success', logs: [usdcTransferLog(7)] };
    await monad.waitForDeposit(TX_HASH);

    expect(wait.mock.calls.map(call => call[1])).toEqual([`48-${TX_HASH}-0`, `48-${TX_HASH}-0`, `48-${TX_HASH}-7`]);
  });

  it('refuses to guess a deposit id when a batch contains multiple supported transfers', async () => {
    receipt = { status: 'success', logs: [usdcTransferLog(7), usdcTransferLog(8)] };
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settled);
    const result = await monad.waitForDeposit(TX_HASH);
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('multiple supported Transfer logs') },
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it('re-notifies the relay while waiting, and stops once the wait settles', async () => {
    vi.useFakeTimers();
    let settle: (value: never) => void = () => undefined;
    vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockReturnValue(new Promise(resolve => (settle = resolve)));
    const notifySpy = vi.mocked(MpcRelayApiService.notify);

    const pending = monad.waitForDeposit(TX_HASH);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(notifySpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    settle(settled);
    await pending;
    notifySpy.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('bounds every wait by its floor when the caller supplies NaN', async () => {
    const result = { ok: true as const, value: { depositId: 'id', status: 'minted' as const, createdAt: 0, txs: {} } };
    const deposit = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(result);
    const withdrawal = vi
      .spyOn(MpcRelayApiService, 'waitForWithdrawal')
      .mockResolvedValue({ ok: true, value: { trackingId: TX_HASH, status: 'released' } });
    const hub = vi.spyOn(MpcRelayApiService, 'waitForHubRelease').mockResolvedValue(result);
    await monad.waitForDeposit(TX_HASH, Number.NaN);
    await monad.waitForWithdrawal('id', Number.NaN);
    await monad.waitForHubRelease(
      { dstChainKey: MONAD, hubChainId: '146', hubTxHash: TX_HASH, logIndex: 0 },
      Number.NaN,
    );
    for (const wait of [deposit, withdrawal, hub]) {
      expect(wait).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ timeout: 300_000 }),
      );
    }

    publicClient.waitForTransactionReceipt.mockRejectedValueOnce(new Error('timed out'));
    await monad.waitForTransactionReceipt({ chainKey: MONAD, txHash: TX_HASH, maxTimeoutMs: Number.NaN });
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60_000 }));
  });
});

describe('MonadSpokeService.sendMessage', () => {
  const sendParams = (provider: unknown = walletProvider) =>
    ({
      srcChainKey: MONAD,
      srcAddress: SENDER,
      dstChainKey: 'sonic',
      dstAddress: HUB_WALLET,
      payload: '0xdeadbeef' as Hex,
      walletProvider: provider,
    }) as never;

  const submitCall = (call: number) => vi.mocked(MpcRelayApiService.submitWithdraw).mock.calls[call]?.[1];

  beforeEach(() => {
    vi.spyOn(MpcRelayApiService, 'submitWithdraw').mockResolvedValue({
      ok: true,
      value: { accepted: true, trackingId: HUB_WALLET },
    });
  });

  it('submits scheme 0 with the relay chain id, the lowercase EVM address as sender and a safe-integer nonce', async () => {
    const trackingId = await monad.sendMessage(sendParams());

    expect(trackingId).toBe(HUB_WALLET);
    expect(submitCall(0)).toMatchObject({ scheme: 0 });
    expect(submitCall(0)?.message).toMatchObject({ chainId: '48', sender: SENDER.toLowerCase(), to: HUB_WALLET });
    expect(submitCall(0)).not.toHaveProperty('publicKey');

    // The relay round-trips the nonce through a JS number.
    for (let i = 1; i < 16; i++) await monad.sendMessage(sendParams());
    for (let i = 0; i < 16; i++) {
      const nonce = BigInt(submitCall(i)?.message.nonce ?? '0');
      expect(BigInt(Number(nonce))).toBe(nonce);
    }
  });

  it('reuses one signed request after a first 429 through sendMessage', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.submitWithdraw).mockRestore();
    const send = vi.fn(async (_url: string, init?: RequestInit) => {
      if (send.mock.calls.length === 1) return new Response(null, { status: 429 });
      const { message } = JSON.parse(String(init?.body));
      const sender: unknown = message.sender;
      if (!isHex(sender)) throw new Error('missing sender');
      const trackingId = keccak256(concat([sender, toHex(BigInt(message.nonce), { size: 8 })]));
      return Response.json({ accepted: true, trackingId });
    });
    vi.stubGlobal('fetch', send);
    const pending = monad.sendMessage(sendParams()).then(
      value => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    const request = JSON.parse(String(send.mock.calls[0]?.[1]?.body));
    const trackingId = keccak256(concat([SENDER, toHex(BigInt(request.message.nonce), { size: 8 })]));
    expect(result).toEqual({ ok: true, value: trackingId });
    expect(signMessage).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Set(send.mock.calls.map(([, init]) => init?.body)).size).toBe(1);
  });

  it('produces a signature the relay recovers to the sender, exactly as scheme 0 verifies it', async () => {
    // The relay verifies with `recoverMessageAddress({ message: { raw: messageHash } })`.
    const account = privateKeyToAccount(`0x${'42'.repeat(32)}`);
    const signer = {
      chainType: 'EVM',
      signMessage: (hash: Hex) => account.signMessage({ message: { raw: hash } }),
    };

    await monad.sendMessage({ ...(sendParams(signer) as object), srcAddress: account.address } as never);

    const sent = submitCall(0);
    const hash = computeSignedMessageHash({
      to: sent?.message.to as Hex,
      data: sent?.message.data as Hex,
      nonce: BigInt(sent?.message.nonce ?? '0'),
      chainId: BigInt(sent?.message.chainId ?? '0'),
      sender: sent?.message.sender as Hex,
    });
    const recovered = await recoverMessageAddress({ message: { raw: hash }, signature: sent?.signature as Hex });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('refuses a wallet that cannot sign messages, and raw mode, which has no spoke transaction to return', async () => {
    await expect(monad.sendMessage(sendParams({ chainType: 'EVM' }))).rejects.toThrow(/does not implement signMessage/);
    await expect(monad.sendMessage({ ...(sendParams() as object), raw: true } as never)).rejects.toThrow(
      /raw mode is not supported/,
    );
    expect(MpcRelayApiService.submitWithdraw).not.toHaveBeenCalled();
  });
});

describe('MonadSpokeService balances', () => {
  it('reads the native balance for MON and balanceOf for an ERC-20, since there is no spoke asset manager', async () => {
    expectTypeOf<SpokeServiceType>().toHaveProperty('getWalletBalance');
    expect(await monad.getDeposit({ srcChainKey: MONAD, srcAddress: SENDER, token: NATIVE_MON } as never)).toBe(7n);
    expect(await monad.getDeposit({ srcChainKey: MONAD, srcAddress: SENDER, token: USDC } as never)).toBe(9n);
    for (const token of tokens) {
      expect(await monad.getWalletBalance({ srcChainKey: MONAD, srcAddress: SENDER, token })).toBe(
        token.symbol === 'MON' ? 7n : 9n,
      );
    }
    expect(publicClient.getBalance).toHaveBeenCalledWith({ address: SENDER });
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: USDC, functionName: 'balanceOf', args: [SENDER] }),
    );
  });

  it('getWalletBalances reads a failed balance as 0n, and rejects only when every read fails', async () => {
    publicClient.readContract.mockRejectedValueOnce(new Error('RPC error'));
    expect(await monad.getWalletBalances({ srcChainKey: MONAD, srcAddress: SENDER, tokens })).toEqual({
      [NATIVE_MON]: 7n,
      [USDC]: 0n,
    });

    publicClient.getBalance.mockRejectedValueOnce(new Error('RPC error'));
    publicClient.readContract.mockRejectedValueOnce(new Error('RPC error'));
    await expect(monad.getWalletBalances({ srcChainKey: MONAD, srcAddress: SENDER, tokens })).rejects.toThrow(
      'every balance read failed',
    );
  });
});

describe('SpokeService routing for Monad', () => {
  it('resolves Monad to its own service, which takes deposits without the asset-manager simulation', async () => {
    expect(sodax.spoke.getSpokeService(MONAD)).toBe(monad);
    const deposit = vi.spyOn(monad, 'deposit').mockResolvedValue(TX_HASH as never);
    const evmDeposit = vi.spyOn(sodax.spoke.evm, 'deposit');

    const result = await sodax.spoke.deposit(depositParams(NATIVE_MON));

    expect(result.ok).toBe(true);
    expect(deposit).toHaveBeenCalledOnce();
    expect(evmDeposit).not.toHaveBeenCalled();
  });

  it('routes wallet balance reads through the Monad service', async () => {
    const params = { srcChainKey: MONAD, srcAddress: SENDER, token: spokeChainConfig.monad.supportedTokens.MON };
    const single = vi.spyOn(monad, 'getWalletBalance').mockResolvedValue(12n);
    const batch = vi.spyOn(monad, 'getWalletBalances').mockResolvedValue({ [NATIVE_MON]: 12n });
    expect(await sodax.spoke.getWalletBalance(params)).toEqual({ ok: true, value: 12n });
    expect(await sodax.spoke.getWalletBalances({ ...params, tokens })).toEqual({
      ok: true,
      value: { [NATIVE_MON]: 12n },
    });
    expect(single).toHaveBeenCalledWith(params);
    expect(batch).toHaveBeenCalledOnce();
  });
});
