/**
 * Tests for `MonadSpokeService` — an EVM chain that settles through the MPC relay in ADDRESS mode.
 *
 * What differs from the memo-mode chains (Tron, XRP) and must not drift: the deposit pays a per-payload
 * derived address rather than the reserve, an ERC-20 deposit is keyed by its Transfer log index while a
 * native one is keyed at 0, and withdrawals are authorized by EIP-191 (scheme 0).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeEventTopics, pad, recoverMessageAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Sodax } from '../../entities/Sodax.js';
import { erc20Abi } from '../../abis/index.js';
import * as MpcRelayApiService from '../mpcRelay/MpcRelayApiService.js';
import { computeSignedMessageHash } from './mpc-message.js';

const sodax = new Sodax();
const monad = sodax.spoke.monad;

const MONAD = 'monad' as const;
const NATIVE_MON = '0x0000000000000000000000000000000000000000';
const USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
const SENDER = '0xf62fffa4d92bcdfc310dccbe943747fe8302e871';
const DEPOSIT_ADDRESS = '0x2222222222222222222222222222222222222222';
const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Hex;
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const AMOUNT = 5_000_000n;

type FakeReceipt = { status: 'success' | 'reverted'; logs: unknown[] };

let receipt: FakeReceipt;

const publicClient = {
  waitForTransactionReceipt: vi.fn(async () => receipt),
  getBalance: vi.fn(async () => 7n),
  readContract: vi.fn(async () => 9n),
  estimateGas: vi.fn(async () => 21_000n),
};

const walletProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(async () => TX_HASH),
  signMessage: vi.fn(async () => `0x${'cd'.repeat(65)}` as Hex),
} as never;

const depositParams = (token: string, extra: object = {}) =>
  ({
    srcChainKey: MONAD,
    srcAddress: SENDER,
    to: HUB_WALLET,
    token,
    amount: AMOUNT,
    data: '0x' as Hex,
    walletProvider,
    ...extra,
  }) as never;

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
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('MonadSpokeService.deposit', () => {
  it('sends native MON straight to the derived deposit address, not the reserve', async () => {
    const tx = await monad.deposit({ ...(depositParams(NATIVE_MON) as object), raw: true } as never);

    expect(tx).toEqual({ from: SENDER, to: DEPOSIT_ADDRESS, value: AMOUNT, data: '0x' });
  });

  it('sends an ERC-20 as a plain transfer to the deposit address, needing no allowance', async () => {
    const tx = (await monad.deposit({ ...(depositParams(USDC) as object), raw: true } as never)) as {
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

  it('sends the transfer, waits for it to land, notifies the relay and returns the tx hash', async () => {
    const hash = await monad.deposit(depositParams(NATIVE_MON));

    expect(hash).toBe(TX_HASH);
    expect(vi.mocked(walletProvider.sendTransaction)).toHaveBeenCalledOnce();
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
    // The relay's id for Monad is 48, not the EVM network id 143.
    expect(MpcRelayApiService.notify).toHaveBeenCalledWith(expect.anything(), '48', TX_HASH);
  });

  it('does not notify the relay about a transfer that reverted', async () => {
    receipt = { status: 'reverted', logs: [] };

    await expect(monad.deposit(depositParams(USDC))).rejects.toThrow(/reverted/);
    expect(MpcRelayApiService.notify).not.toHaveBeenCalled();
  });

  it('refuses a memo-mode relay response rather than paying a shared reserve without a memo', async () => {
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

    await expect(monad.deposit(depositParams(NATIVE_MON))).rejects.toThrow(/expected address/);
    expect(vi.mocked(walletProvider.sendTransaction)).not.toHaveBeenCalled();
  });

  it('refuses a deposit whose target disagrees with the hub wallet the relay derives', async () => {
    await expect(
      monad.deposit(depositParams(NATIVE_MON, { to: '0x9999999999999999999999999999999999999999' })),
    ).rejects.toThrow(/relay derives hub wallet/);
    expect(vi.mocked(walletProvider.sendTransaction)).not.toHaveBeenCalled();
  });

  it('keeps the tx hash in the error when the relay cannot be notified, so the deposit can be re-notified', async () => {
    vi.useFakeTimers();
    vi.mocked(MpcRelayApiService.notify).mockResolvedValue({ ok: false, error: new Error('relay 503') });

    const pending = monad.deposit(depositParams(NATIVE_MON)).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    const failure = await pending;

    expect((failure as Error).message).toContain(`${TX_HASH} sent but the relay was not notified`);
    expect(vi.mocked(MpcRelayApiService.notify).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('MonadSpokeService.waitForDeposit', () => {
  const settled = { ok: true, value: { depositId: 'id', status: 'minted', createdAt: 0, txs: {} } } as never;

  it('keys a native deposit at log index 0, which is how the verifier records a value transfer', async () => {
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settled);

    await monad.waitForDeposit(TX_HASH);

    expect(wait.mock.calls[0]?.[1]).toBe(`48-${TX_HASH}-0`);
  });

  it('keys an ERC-20 deposit by the block-level index of its Transfer log', async () => {
    receipt = { status: 'success', logs: [usdcTransferLog(7)] };
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settled);

    await monad.waitForDeposit(TX_HASH);

    expect(wait.mock.calls[0]?.[1]).toBe(`48-${TX_HASH}-7`);
  });

  it('ignores a Transfer log from a token Monad does not support', async () => {
    receipt = { status: 'success', logs: [usdcTransferLog(3, '0x3333333333333333333333333333333333333333')] };
    const wait = vi.spyOn(MpcRelayApiService, 'waitForDeposit').mockResolvedValue(settled);

    await monad.waitForDeposit(TX_HASH);

    expect(wait.mock.calls[0]?.[1]).toBe(`48-${TX_HASH}-0`);
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

  it('submits scheme 0 with the relay chain id and the lowercase EVM address as sender', async () => {
    const trackingId = await monad.sendMessage(sendParams());

    expect(trackingId).toBe(HUB_WALLET);
    expect(submitCall(0)).toMatchObject({ scheme: 0 });
    expect(submitCall(0)?.message).toMatchObject({ chainId: '48', sender: SENDER.toLowerCase(), to: HUB_WALLET });
    expect(submitCall(0)).not.toHaveProperty('publicKey');
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

  it('keeps the nonce inside the safe-integer range the relay round-trips it through', async () => {
    for (let i = 0; i < 16; i++) {
      await monad.sendMessage(sendParams());
      const nonce = BigInt(submitCall(i)?.message.nonce ?? '0');
      expect(BigInt(Number(nonce))).toBe(nonce);
    }
  });

  it('refuses a wallet provider that cannot sign messages', async () => {
    await expect(monad.sendMessage(sendParams({ chainType: 'EVM' }))).rejects.toThrow(/does not implement signMessage/);
    expect(MpcRelayApiService.submitWithdraw).not.toHaveBeenCalled();
  });

  it('refuses raw mode, which has no spoke transaction to return', async () => {
    await expect(monad.sendMessage({ ...(sendParams() as object), raw: true } as never)).rejects.toThrow(
      /raw mode is not supported/,
    );
  });
});

describe('MonadSpokeService.getDeposit', () => {
  it('reads the native balance for MON and balanceOf for an ERC-20, since there is no spoke asset manager', async () => {
    expect(await monad.getDeposit({ srcChainKey: MONAD, srcAddress: SENDER, token: NATIVE_MON } as never)).toBe(7n);
    expect(publicClient.getBalance).toHaveBeenCalledWith({ address: SENDER });

    expect(await monad.getDeposit({ srcChainKey: MONAD, srcAddress: SENDER, token: USDC } as never)).toBe(9n);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: USDC, functionName: 'balanceOf', args: [SENDER] }),
    );
  });
});

describe('SpokeService routing for Monad', () => {
  it('resolves Monad to its own service, never the EVM spoke service', () => {
    expect(sodax.spoke.getSpokeService(MONAD)).toBe(monad);
  });

  it('deposits through the MPC service, skipping the asset-manager simulation', async () => {
    const deposit = vi.spyOn(monad, 'deposit').mockResolvedValue(TX_HASH as never);
    const evmDeposit = vi.spyOn(sodax.spoke.evm, 'deposit');

    const result = await sodax.spoke.deposit(depositParams(NATIVE_MON));

    expect(result.ok).toBe(true);
    expect(deposit).toHaveBeenCalledOnce();
    expect(evmDeposit).not.toHaveBeenCalled();
  });
});
