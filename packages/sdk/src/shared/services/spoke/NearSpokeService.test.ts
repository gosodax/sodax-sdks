/**
 * Tests for NearSpokeService — the single NEAR spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109). NEAR has one chain
 * (`ChainKeys.NEAR_MAINNET`), so there is no `describe.each` parametrisation — one Sodax instance
 * backs every test; `sodax.spoke.near.rpcProvider` methods are spied per-test;
 * `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every address, polling interval, and timeout is
 * sourced from `spokeChainConfig[NEAR_MAINNET]`. Only user identities and tx hashes are fabricated.
 *
 * Mocking strategy:
 *   - `sleep` (shared-utils.js) is mocked at its source via `vi.mock` + `vi.hoisted` (with
 *     `vi.importActual` for the rest of the module) so polling tests don't actually wait.
 *   - `near-api-js` is NOT module-mocked: the real `JsonRpcProvider` constructor runs. Only the
 *     two methods used by the SUT (`callFunction` for queries and `viewTransactionStatus` for
 *     receipts) are spied per-test on the live instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type FTTransferCallArgs,
  type Hex,
  type INearWalletProvider,
  type SendMsgArgs,
} from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sleep: vi.fn(),
}));

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

import { Sodax } from '../../entities/Sodax.js';
import { NEAR_DEFAULT_GAS } from './NearSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const nearSpoke = sodax.spoke.near;

const NEAR = ChainKeys.NEAR_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const nearConfig = spokeChainConfig[NEAR];
const NEAR_ASSET_MGR = nearConfig.addresses.assetManager;
const NEAR_CONNECTION = nearConfig.addresses.connection;
const NEAR_RATE_LIMIT = nearConfig.addresses.rateLimit;
const NEAR_INTENT_FILLER = nearConfig.addresses.intentFiller;
const NEAR_NATIVE = nearConfig.nativeToken;
const NEAR_BNUSD = nearConfig.bnUSD;

// Deliberate cast: GetAddressType<'near…'> is declared as Address (0x-hex) in @sodax/types, but
// real NEAR accounts are names like `user.near` and the service consumes them as such at runtime.
const SRC_ADDR = 'user.near' as unknown as `0x${string}`;
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TX_HASH = '11111111111111111111111111111111';

const mockNearProvider = {
  chainType: 'NEAR',
  signAndSubmitTxn: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as INearWalletProvider;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 2. estimateGas — hardcoded NEAR_DEFAULT_GAS
// =========================================================================

describe('NearSpokeService.estimateGas', () => {
  it('returns NEAR_DEFAULT_GAS regardless of input (no on-chain estimation)', async () => {
    const result = await nearSpoke.estimateGas({ chainKey: NEAR, tx: {} as never });
    expect(result).toBe(NEAR_DEFAULT_GAS);
    // Pin the constant — a regression that drops a zero changes the gas budget by 10×.
    expect(NEAR_DEFAULT_GAS).toBe(300_000_000_000_000n);
  });
});

// =========================================================================
// 3. queryContract — delegation to rpcProvider.callFunction
// =========================================================================

describe('NearSpokeService.queryContract', () => {
  it('forwards contractId/method/args to rpcProvider.callFunction', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce('hello');

    const result = await nearSpoke.queryContract('asset.near', 'get_x', { id: 1 });

    expect(result).toBe('hello');
    expect(spy).toHaveBeenCalledWith({ contractId: 'asset.near', method: 'get_x', args: { id: 1 } });
  });
});

// =========================================================================
// 4. getRateLimit — happy + null/undefined branches
// =========================================================================

describe('NearSpokeService.getRateLimit', () => {
  it('queries the config rateLimit contract and maps snake_case fields to camelCase', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce({
      max_available: 100,
      available: 80,
      rate_per_second: 5,
    });

    const result = await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR);
    expect(result).toEqual({ maxAvailable: 100, available: 80, ratePerSecond: 5 });
    expect(spy).toHaveBeenCalledWith({
      contractId: NEAR_RATE_LIMIT,
      method: 'get_rate_limit',
      args: { token: NEAR_BNUSD },
    });
  });

  it('returns zeroes when callFunction resolves to null or undefined', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction')
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(undefined);

    const zeroes = { maxAvailable: 0, available: 0, ratePerSecond: 0 };
    expect(await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR)).toEqual(zeroes);
    expect(await nearSpoke.getRateLimit(NEAR_BNUSD, NEAR)).toEqual(zeroes);
  });
});

// =========================================================================
// 5. fillIntent — native (intentFiller / fill_intent) vs non-native (token / ft_transfer_call)
// =========================================================================

describe('NearSpokeService.fillIntent', () => {
  const baseFill = {
    amount: 1_000n,
    fill_id: 7n,
    intent_hash: '0xdeadbeef' as Hex,
    receiver: 'recv.near',
    solver: '0x4444444444444444444444444444444444444444' as Hex,
    token: NEAR_BNUSD,
  };

  it('native token → targets intentFiller with fill_intent and deposit=amount', async () => {
    const tx = await nearSpoke.fillIntent(
      { srcAddress: SRC_ADDR, srcChainKey: NEAR },
      { ...baseFill, token: NEAR_NATIVE },
    );

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_INTENT_FILLER);
    expect(tx.params.method).toBe('fill_intent');
    expect(tx.params.deposit).toBe(1_000n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);
  });

  it('non-native → targets the token contract with ft_transfer_call and deposit=1 yoctoNEAR', async () => {
    const tx = await nearSpoke.fillIntent({ srcAddress: SRC_ADDR, srcChainKey: NEAR }, baseFill);

    expect(tx.params.contractId).toBe(NEAR_BNUSD);
    expect(tx.params.method).toBe('ft_transfer_call');
    expect(tx.params.deposit).toBe(1n);
    const args = tx.params.args as FTTransferCallArgs;
    expect(args.receiver_id).toBe(NEAR_INTENT_FILLER);
    expect(args.amount).toBe('1000');
    // msg is JSON-stringified FillIntent payload
    expect(typeof args.msg).toBe('string');
  });
});

// =========================================================================
// 6. deposit — native vs non-native, raw vs walletProvider
// =========================================================================

describe('NearSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof NEAR, Raw>>,
  ): DepositParams<typeof NEAR, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: NEAR,
      to: HUB_WALLET,
      token: NEAR_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockNearProvider,
      ...overrides,
    }) as DepositParams<typeof NEAR, Raw>;

  it('native NEAR raw=true → transfer on assetManager with deposit=amount', async () => {
    const tx = (await nearSpoke.deposit(depositParams<true>({ token: NEAR_NATIVE, raw: true }))) as {
      signerId: string;
      params: { contractId: string; method: string; deposit: bigint; gas: bigint };
    };

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_ASSET_MGR);
    expect(tx.params.method).toBe('transfer');
    expect(tx.params.deposit).toBe(1_000n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);
  });

  it('non-native raw=true → ft_transfer_call on the token contract with deposit=1 yoctoNEAR', async () => {
    const tx = await nearSpoke.deposit(depositParams<true>({ token: NEAR_BNUSD, raw: true }));

    expect(tx.params.contractId).toBe(NEAR_BNUSD);
    expect(tx.params.method).toBe('ft_transfer_call');
    expect(tx.params.deposit).toBe(1n);
    const args = tx.params.args as FTTransferCallArgs;
    expect(args.receiver_id).toBe(NEAR_ASSET_MGR);
    expect(args.amount).toBe('1000');
    // msg encodes {to, data} as JSON.
    const msg = JSON.parse(args.msg ?? '');
    expect(msg).toHaveProperty('to');
    expect(msg).toHaveProperty('data');
  });

  it('raw=false → delegates to walletProvider.signAndSubmitTxn and returns hash', async () => {
    (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await nearSpoke.deposit(depositParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    expect(mockNearProvider.signAndSubmitTxn).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 7. getDeposit — native (get_balance on assetManager) vs non-native (ft_balance_of on token)
// =========================================================================

describe('NearSpokeService.getDeposit', () => {
  it('native → calls get_balance on assetManager with empty args', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce('500');

    const result = await nearSpoke.getDeposit({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      token: NEAR_NATIVE,
    });

    expect(result).toBe(500n);
    expect(spy).toHaveBeenCalledWith({ contractId: NEAR_ASSET_MGR, method: 'get_balance', args: {} });
  });

  it('non-native → calls ft_balance_of on token with account_id=assetManager, throwing on a non-string', async () => {
    const spy = vi
      .spyOn(nearSpoke.rpcProvider, 'callFunction')
      .mockResolvedValueOnce('7500')
      .mockResolvedValueOnce(123);

    const result = await nearSpoke.getDeposit({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      token: NEAR_BNUSD,
    });

    expect(result).toBe(7500n);
    expect(spy).toHaveBeenCalledWith({
      contractId: NEAR_BNUSD,
      method: 'ft_balance_of',
      args: { account_id: NEAR_ASSET_MGR },
    });

    await expect(nearSpoke.getDeposit({ srcChainKey: NEAR, srcAddress: SRC_ADDR, token: NEAR_BNUSD })).rejects.toThrow(
      'Failed to get balance',
    );
  });
});

// =========================================================================
// 7b. getWalletBalance / getWalletBalances — the user's own holdings
// =========================================================================

describe('NearSpokeService.getWalletBalance', () => {
  // Real config tokens only: a synthesised address would be classified against a nativeToken it
  // never appears next to in production, so the native/NEP-141 split would prove nothing.
  const NEAR_TOKEN = nearConfig.supportedTokens.NEAR;
  const BNUSD_TOKEN = nearConfig.supportedTokens.bnUSD;

  it('native NEAR → reads the user account amount in yoctoNEAR and issues no contract view', async () => {
    const viewAccountSpy = vi
      .spyOn(nearSpoke.rpcProvider, 'viewAccount')
      .mockResolvedValueOnce({ amount: 1_500_000_000_000_000_000_000_000n } as never);
    const callSpy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction');

    const result = await nearSpoke.getWalletBalance({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      token: NEAR_TOKEN,
    });

    expect(result).toBe(1_500_000_000_000_000_000_000_000n);
    expect(viewAccountSpy).toHaveBeenCalledWith({ accountId: SRC_ADDR });
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('NEP-141 → ft_balance_of with account_id = the user, not the assetManager getDeposit reads', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValueOnce('7500' as never);

    const result = await nearSpoke.getWalletBalance({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      token: BNUSD_TOKEN,
    });

    expect(result).toBe(7500n);
    expect(spy).toHaveBeenCalledWith({
      contractId: BNUSD_TOKEN.address,
      method: 'ft_balance_of',
      args: { account_id: SRC_ADDR },
    });
    // The inverse of the getDeposit test above — the holder is the only difference between them.
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ args: { account_id: NEAR_ASSET_MGR } }));
  });

  it('rejects a non-string ft_balance_of and propagates an RPC rejection — an unread balance never becomes 0n', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction')
      .mockResolvedValueOnce(7500 as never)
      .mockRejectedValueOnce(new Error('rpc 503'));

    await expect(
      nearSpoke.getWalletBalance({ srcChainKey: NEAR, srcAddress: SRC_ADDR, token: BNUSD_TOKEN }),
    ).rejects.toThrow('[NearSpokeService.getWalletBalance] Failed to get balance. Unexpected response type.');

    await expect(
      nearSpoke.getWalletBalance({ srcChainKey: NEAR, srcAddress: SRC_ADDR, token: BNUSD_TOKEN }),
    ).rejects.toThrow('rpc 503');
  });
});

describe('NearSpokeService.getWalletBalances', () => {
  const NEAR_TOKEN = nearConfig.supportedTokens.NEAR;
  const BNUSD_TOKEN = nearConfig.supportedTokens.bnUSD;
  const USDT_TOKEN = nearConfig.supportedTokens.USDT;

  const ftBalances = (byContractId: Record<string, string | Error>): void => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockImplementation((({ contractId }: { contractId: string }) => {
      const outcome = byContractId[contractId];
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }) as never);
  };

  it('keys every token by token.address with the balance in smallest units, and an empty list to an empty map', async () => {
    const viewAccountSpy = vi
      .spyOn(nearSpoke.rpcProvider, 'viewAccount')
      .mockResolvedValueOnce({ amount: 42n } as never);
    ftBalances({ [BNUSD_TOKEN.address]: '7500', [USDT_TOKEN.address]: '0' });
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');

    const result = await nearSpoke.getWalletBalances({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      tokens: [NEAR_TOKEN, BNUSD_TOKEN, USDT_TOKEN],
    });

    expect(result).toEqual({
      [NEAR_TOKEN.address]: 42n,
      [BNUSD_TOKEN.address]: 7500n,
      // A confirmed on-chain zero. The flat map renders it exactly like the failure below, so the
      // silence of the logger is what keeps the two apart.
      [USDT_TOKEN.address]: 0n,
    });
    expect(warnSpy).not.toHaveBeenCalled();

    vi.mocked(nearSpoke.rpcProvider.callFunction).mockClear();
    expect(await nearSpoke.getWalletBalances({ srcChainKey: NEAR, srcAddress: SRC_ADDR, tokens: [] })).toEqual({});
    expect(nearSpoke.rpcProvider.callFunction).not.toHaveBeenCalled();
    expect(viewAccountSpy).toHaveBeenCalledTimes(1);
  });

  it('isolates a failing token as a logged 0n instead of discarding the batch', async () => {
    ftBalances({ [BNUSD_TOKEN.address]: '7500', [USDT_TOKEN.address]: new Error('rpc 503') });
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');

    const result = await nearSpoke.getWalletBalances({
      srcChainKey: NEAR,
      srcAddress: SRC_ADDR,
      tokens: [BNUSD_TOKEN, USDT_TOKEN],
    });

    expect(result[BNUSD_TOKEN.address]).toBe(7500n);
    expect(result[USDT_TOKEN.address]).toBe(0n);
    // The fallback zero is only safe while it is reported — a silent one is indistinguishable
    // from an empty wallet.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: NEAR, token: USDT_TOKEN.address, error: 'rpc 503' }),
    );
  });

  it('rejects when no token in a non-empty batch could be read — a dead RPC is not an empty wallet', async () => {
    ftBalances({
      [BNUSD_TOKEN.address]: new Error('rpc 503'),
      [USDT_TOKEN.address]: new Error('rpc 503'),
    });

    await expect(
      nearSpoke.getWalletBalances({
        srcChainKey: NEAR,
        srcAddress: SRC_ADDR,
        tokens: [BNUSD_TOKEN, USDT_TOKEN],
      }),
    ).rejects.toThrow(`every balance read failed on ${NEAR}`);
  });
});

// =========================================================================
// 8. isStorageRegistered / registerStorage — NEP-141 storage registration
// =========================================================================

describe('NearSpokeService.isStorageRegistered', () => {
  it('native token → returns true without querying the RPC', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'callFunction');

    expect(await nearSpoke.isStorageRegistered(NEAR_NATIVE, SRC_ADDR)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('non-native → storage_balance_of: an object is registered, null is not', async () => {
    const spy = vi
      .spyOn(nearSpoke.rpcProvider, 'callFunction')
      .mockResolvedValueOnce({ total: '1250000000000000000000', available: '0' })
      .mockResolvedValueOnce(null as never);

    expect(await nearSpoke.isStorageRegistered(NEAR_BNUSD, SRC_ADDR)).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      contractId: NEAR_BNUSD,
      method: 'storage_balance_of',
      args: { account_id: SRC_ADDR },
    });
    expect(await nearSpoke.isStorageRegistered(NEAR_BNUSD, SRC_ADDR)).toBe(false);
  });
});

describe('NearSpokeService.registerStorage', () => {
  it('non-native raw=true → storage_deposit tx with registration_only and a 0.00125 NEAR bond unless overridden', async () => {
    const tx = await nearSpoke.registerStorage({
      token: NEAR_BNUSD,
      accountId: SRC_ADDR,
      walletProvider: mockNearProvider,
      raw: true,
    });

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_BNUSD);
    expect(tx.params.method).toBe('storage_deposit');
    expect(tx.params.args).toEqual({ account_id: SRC_ADDR, registration_only: true });
    expect(tx.params.deposit).toBe(1_250_000_000_000_000_000_000n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);

    const custom = await nearSpoke.registerStorage({
      token: NEAR_BNUSD,
      accountId: SRC_ADDR,
      walletProvider: mockNearProvider,
      deposit: 5n,
      raw: true,
    });
    expect(custom.params.deposit).toBe(5n);
  });

  it('native token → throws (no NEP-141 storage registration)', async () => {
    await expect(
      nearSpoke.registerStorage({ token: NEAR_NATIVE, accountId: SRC_ADDR, walletProvider: mockNearProvider }),
    ).rejects.toThrow('Native NEAR has no NEP-141 storage registration');
  });

  it('raw=false → delegates to walletProvider.signAndSubmitTxn and returns the hash', async () => {
    (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await nearSpoke.registerStorage({
      token: NEAR_BNUSD,
      accountId: SRC_ADDR,
      walletProvider: mockNearProvider,
      raw: false,
    });

    expect(result).toBe(TX_HASH);
    expect(mockNearProvider.signAndSubmitTxn).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 9. sendMessage — raw vs walletProvider, dstChainKey-driven relay id
// =========================================================================

describe('NearSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof NEAR, Raw>>,
  ): SendMessageParams<typeof NEAR, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: NEAR,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockNearProvider,
      ...overrides,
    }) as SendMessageParams<typeof NEAR, Raw>;

  it('raw=true → returns tx targeting the connection contract with send_message', async () => {
    const tx = await nearSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(tx.signerId).toBe(SRC_ADDR);
    expect(tx.params.contractId).toBe(NEAR_CONNECTION);
    expect(tx.params.method).toBe('send_message');
    expect(tx.params.deposit).toBe(0n);
    expect(tx.params.gas).toBe(NEAR_DEFAULT_GAS);
    // dst_chain_id is the relay id parsed to a number
    expect((tx.params.args as SendMsgArgs).dst_chain_id).toBe(Number(getIntentRelayChainId(SONIC)));
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });

  it('raw=false → delegates to walletProvider.signAndSubmitTxn and returns hash', async () => {
    (mockNearProvider.signAndSubmitTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await nearSpoke.sendMessage(sendMessageParams<false>({ raw: false }));
    expect(result).toBe(TX_HASH);
  });
});

// =========================================================================
// 10. getLimit / getAvailable — smoke via mocked getRateLimit
// =========================================================================

describe('NearSpokeService.getLimit / getAvailable', () => {
  it('getLimit returns maxAvailable and getAvailable returns available, as bigint', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'callFunction').mockResolvedValue({
      max_available: 42,
      available: 10,
      rate_per_second: 1,
    });

    expect(await nearSpoke.getLimit(NEAR_BNUSD, NEAR)).toBe(42n);
    expect(await nearSpoke.getAvailable(NEAR_BNUSD, NEAR)).toBe(10n);
  });
});

// =========================================================================
// 11. waitForTransactionReceipt — every result branch + polling defaults
// =========================================================================

describe('NearSpokeService.waitForTransactionReceipt', () => {
  it('SuccessValue and SuccessReceiptId → status:success with the outcome receipt', async () => {
    const outcome = { status: { SuccessValue: '' }, transaction: { hash: TX_HASH } };
    const receiptOutcome = { status: { SuccessReceiptId: 'abc' } };
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus')
      .mockResolvedValueOnce(outcome as never)
      .mockResolvedValueOnce(receiptOutcome as never);

    const result = await nearSpoke.waitForTransactionReceipt({ chainKey: NEAR, txHash: TX_HASH });
    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toBe(outcome);

    const viaReceipt = await nearSpoke.waitForTransactionReceipt({ chainKey: NEAR, txHash: TX_HASH });
    if (!viaReceipt.ok || viaReceipt.value.status !== 'success') throw new Error('expected ok+success');
    expect(viaReceipt.value.receipt).toBe(receiptOutcome);
  });

  it('Failure → status:failure with JSON-stringified error', async () => {
    const outcome = { status: { Failure: { code: 'oops' } } };
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockResolvedValueOnce(outcome as never);

    const result = await nearSpoke.waitForTransactionReceipt({ chainKey: NEAR, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error.message).toContain('Transaction failed');
    expect(result.value.error.message).toContain('oops');
  });

  it('pending (no recognised status) or a persistent rejection until deadline → status:timeout', async () => {
    const spy = vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus').mockResolvedValue({ status: {} } as never);
    const params = { chainKey: NEAR, txHash: TX_HASH, pollingIntervalMs: 1, maxTimeoutMs: 1 } as const;

    const pending = await nearSpoke.waitForTransactionReceipt(params);
    if (!pending.ok) throw new Error('expected ok');
    expect(pending.value.status).toBe('timeout');

    spy.mockRejectedValue(new Error('rpc 503'));
    const rejected = await nearSpoke.waitForTransactionReceipt(params);
    if (!rejected.ok) throw new Error('expected ok');
    expect(rejected.value.status).toBe('timeout');
  });

  it('transient rejection → sleeps the caller pollingIntervalMs and recovers on next poll', async () => {
    vi.spyOn(nearSpoke.rpcProvider, 'viewTransactionStatus')
      .mockRejectedValueOnce(new Error('rpc 503'))
      .mockResolvedValueOnce({ status: { SuccessValue: '' } } as never);

    const result = await nearSpoke.waitForTransactionReceipt({
      chainKey: NEAR,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 1000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
