/**
 * Tests for IconSpokeService — the single ICON spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109). ICON has one chain
 * (`ChainKeys.ICON_MAINNET`), so there is no `describe.each` parametrisation — one Sodax instance
 * backs every test; `sodax.spoke.icon.iconService` methods are spied per-test;
 * `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every address, nid, polling interval, and timeout
 * is sourced from `spokeChainConfig[ICON_MAINNET]` rather than fake constants. That catches a
 * class of regressions where a hardcoded value happens to match a test fixture but diverges from
 * production config (wrong wICX, wrong nid, etc.). Only user identities (`SRC_ADDR`, `HUB_WALLET`,
 * `DST_ADDR`) and tx hashes are fabricated.
 *
 * Mocking strategy:
 *   - `estimateStepCost` (icon-utils.js) and `sleep` (shared-utils.js) are mocked at their source
 *     paths via `vi.mock` + `vi.hoisted`, using `vi.importActual` to keep the rest of each module
 *     real. The `estimateStepCost` mock makes gas tests deterministic; the `sleep` no-op keeps
 *     `waitForTransactionReceipt` tests from hanging on real polling intervals.
 *   - `icon-sdk-js` is NOT module-mocked: real `Converter`, `CallTransactionBuilder`, and
 *     `CallBuilder` run. Only the two `iconService` chain methods that hit the network
 *     (`call(...).execute()` and `getTransactionResult(...).execute()`) are spied per-test by
 *     returning a `{ execute: () => Promise<T> }` shim that mimics icon-sdk-js's HttpCall<T>.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, getIntentRelayChainId, spokeChainConfig, type Hex } from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  estimateStepCost: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('../../utils/icon-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/icon-utils.js');
  return { ...actual, estimateStepCost: mocks.estimateStepCost };
});

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

import { Sodax } from '../../entities/Sodax.js';
import { IconSpokeService } from './IconSpokeService.js';
import { encodeAddress } from '../../utils/shared-utils.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const iconSpoke = sodax.spoke.icon;

const ICON = ChainKeys.ICON_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const iconConfig = spokeChainConfig[ICON];
const ICON_ASSET_MGR = iconConfig.addresses.assetManager;
const ICON_CONNECTION = iconConfig.addresses.connection;
const ICON_WICX = iconConfig.addresses.wICX;
const ICON_NID = iconConfig.nid;
const ICON_NATIVE = iconConfig.nativeToken;
const ICON_BNUSD = iconConfig.bnUSD;
const ICON_POLLING_MS = iconConfig.pollingConfig.pollingIntervalMs;
const ICON_TIMEOUT_MS = iconConfig.pollingConfig.maxTimeoutMs;

// User identities / hash — no config source.
const SRC_ADDR = 'hx0000000000000000000000000000000000000001';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// IIconWalletProvider stub — only `sendTransaction` is exercised. The `as unknown as` shim
// satisfies the broad-union provider type without pulling in the full ICoreWallet interface.
const mockIconProvider = {
  chainType: 'ICON' as const,
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
};

// Helper: icon-sdk-js HttpCall<T> is `{ execute(): Promise<T> }`. Spying on the chain entry
// (`iconService.call(...)` or `.getTransactionResult(...)`) requires returning an object with an
// `execute` method. This helper builds that shim.
//
// T must match what a real node sends: `call()` registers no result converter, so `execute()`
// resolves the RAW JSON-RPC `result` — a bare hex string for an int-returning SCORE method
// (`balanceOf`), an object only for a struct-returning one (`tryAggregate`). A `{ value }` wrapper
// is not a shape icon-sdk-js ever produces.
const httpCall = <T>(value: T) => ({ execute: () => Promise.resolve(value) });
const httpCallReject = (err: unknown) => ({ execute: () => Promise.reject(err) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor
// =========================================================================

describe('IconSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.icon with the expected method surface', () => {
    expect(iconSpoke).toBeInstanceOf(IconSpokeService);
    expect(typeof iconSpoke.estimateGas).toBe('function');
    expect(typeof iconSpoke.deposit).toBe('function');
    expect(typeof iconSpoke.getDeposit).toBe('function');
    expect(typeof iconSpoke.sendMessage).toBe('function');
    expect(typeof iconSpoke.encodeSimulationParams).toBe('function');
    expect(typeof iconSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires an IconService with the methods the rest of the class consumes', () => {
    expect(iconSpoke.iconService).toBeDefined();
    expect(typeof iconSpoke.iconService.call).toBe('function');
    expect(typeof iconSpoke.iconService.getTransactionResult).toBe('function');
  });

  it('exposes the per-chain debugRpcUrl from config', () => {
    expect(iconSpoke.debugRpcUrl).toBe(iconConfig.debugRpcUrl);
  });
});

// =========================================================================
// 2. estimateGas — delegation to estimateStepCost
// =========================================================================

describe('IconSpokeService.estimateGas', () => {
  it('delegates to estimateStepCost with the per-chain debug RPC URL', async () => {
    mocks.estimateStepCost.mockResolvedValueOnce(123_456n);

    const rawTx = { from: SRC_ADDR, to: ICON_ASSET_MGR };
    const result = await iconSpoke.estimateGas({ chainKey: ICON, tx: rawTx });

    expect(result).toBe(123_456n);
    expect(mocks.estimateStepCost).toHaveBeenCalledWith(rawTx, iconConfig.debugRpcUrl);
  });
});

// =========================================================================
// 3. deposit — native (ICX→wICX substitution) vs non-native, raw vs walletProvider
// =========================================================================

describe('IconSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof ICON, Raw>>,
  ): DepositParams<typeof ICON, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: ICON,
      to: HUB_WALLET,
      token: ICON_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockIconProvider,
      ...overrides,
    }) as DepositParams<typeof ICON, Raw>;

  it("native ICX raw=true → 'to' is substituted with wICX and value is BigIntToHex(amount)", async () => {
    const result = (await iconSpoke.deposit(depositParams<true>({ token: ICON_NATIVE, raw: true }))) as Record<
      string,
      unknown
    >;

    // Native path resolves `to` to wICX; non-native uses the token address directly.
    expect(result.to).toBe(ICON_WICX);
    // BigIntToHex(1000n) === '0x3e8'
    expect(result.value).toBe('0x3e8');
    expect(result.from).toBe(SRC_ADDR);
    expect(result.nid).toBe(ICON_NID);
  });

  it('non-native token raw=true → `to` is the token address and value is 0x0', async () => {
    const result = (await iconSpoke.deposit(depositParams<true>({ token: ICON_BNUSD, raw: true }))) as Record<
      string,
      unknown
    >;

    expect(result.to).toBe(ICON_BNUSD);
    expect(result.value).toBe('0x0');
  });

  it('raw=false → walletProvider.sendTransaction receives the right payload (non-native)', async () => {
    (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await iconSpoke.deposit(depositParams<false>({ raw: false, token: ICON_BNUSD }));

    expect(result).toBe(TX_HASH);
    expect(mockIconProvider.sendTransaction).toHaveBeenCalledTimes(1);
    const sent = (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      from: SRC_ADDR,
      to: ICON_BNUSD,
      value: '0x0',
      nid: ICON_NID,
      method: 'transfer',
    });
    // `params` is the inner `_to` / `_value` / `_data` triplet built by deposit.
    expect((sent as { params: Record<string, unknown> }).params._to).toBe(ICON_ASSET_MGR);
    expect((sent as { params: Record<string, unknown> }).params._value).toBe('0x3e8');
  });

  it('raw=false native → walletProvider.sendTransaction gets wICX as `to` and amount as value', async () => {
    (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    await iconSpoke.deposit(depositParams<false>({ raw: false, token: ICON_NATIVE }));

    const sent = (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sent).toMatchObject({ to: ICON_WICX, value: '0x3e8' });
  });
});

// =========================================================================
// 4. getDeposit — balanceOf(_owner=assetManager) on the token contract
// =========================================================================

describe('IconSpokeService.getDeposit', () => {
  it('reads balanceOf with _owner=assetManager via iconService.call(...).execute()', async () => {
    const callSpy = vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(httpCall('0x1d4c') as never);

    const result = await iconSpoke.getDeposit({
      srcChainKey: ICON,
      srcAddress: SRC_ADDR,
      token: ICON_BNUSD,
    });

    expect(result).toBe(7500n); // 0x1d4c
    expect(callSpy).toHaveBeenCalledTimes(1);
    // The argument is a CallBuilder.build() output; assert via the relevant shape fields.
    const arg = callSpy.mock.calls[0]?.[0] as { to: string; data: { method: string; params: Record<string, string> } };
    expect(arg.to).toBe(ICON_BNUSD);
    expect(arg.data.method).toBe('balanceOf');
    expect(arg.data.params._owner).toBe(ICON_ASSET_MGR);
  });

  it('rejects when the node returns a non-string result', async () => {
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(httpCall({ value: '0x1d4c' }) as never);

    await expect(
      iconSpoke.getDeposit({ srcChainKey: ICON, srcAddress: SRC_ADDR, token: ICON_BNUSD }),
    ).rejects.toThrow(/Unexpected balanceOf response/);
  });
});

// =========================================================================
// 4b. getWalletBalance — balanceOf(_owner=user) / native ICX
// =========================================================================

describe('IconSpokeService.getWalletBalance', () => {
  const ICX_TOKEN = iconConfig.supportedTokens.ICX;
  const BNUSD_TOKEN = iconConfig.supportedTokens.bnUSD;

  it('reads native ICX via iconService.getBalance and never issues a SCORE call', async () => {
    const balanceSpy = vi
      .spyOn(iconSpoke.iconService, 'getBalance')
      .mockReturnValueOnce(httpCall({ toFixed: () => '12345' }) as never);
    const callSpy = vi.spyOn(iconSpoke.iconService, 'call');

    const result = await iconSpoke.getWalletBalance({ srcChainKey: ICON, srcAddress: SRC_ADDR, token: ICX_TOKEN });

    expect(result).toBe(12345n);
    expect(balanceSpy).toHaveBeenCalledWith(SRC_ADDR);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('decodes the bare hex string an IRC-2 balanceOf resolves to, with the USER as _owner', async () => {
    const callSpy = vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(httpCall('0x1d4c') as never);

    const result = await iconSpoke.getWalletBalance({ srcChainKey: ICON, srcAddress: SRC_ADDR, token: BNUSD_TOKEN });

    expect(result).toBe(7500n);
    const arg = callSpy.mock.calls[0]?.[0] as { to: string; data: { method: string; params: Record<string, string> } };
    expect(arg.to).toBe(BNUSD_TOKEN.address);
    expect(arg.data.method).toBe('balanceOf');
    // The user, NOT the asset manager — the one field that distinguishes this from getDeposit.
    expect(arg.data.params._owner).toBe(SRC_ADDR);
  });

  it('rejects on a `{ value }` wrapper, the shape icon-sdk-js never sends', async () => {
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(httpCall({ value: '0x1d4c' }) as never);

    await expect(
      iconSpoke.getWalletBalance({ srcChainKey: ICON, srcAddress: SRC_ADDR, token: BNUSD_TOKEN }),
    ).rejects.toThrow(/Unexpected balanceOf response/);
  });
});

// =========================================================================
// 4c. getWalletBalances — one getBalance for ICX + one tryAggregate for every IRC-2
// =========================================================================

describe('IconSpokeService.getWalletBalances', () => {
  const ICX_TOKEN = iconConfig.supportedTokens.ICX;
  const BNUSD_TOKEN = iconConfig.supportedTokens.bnUSD;
  const BALN_TOKEN = iconConfig.supportedTokens.BALN;

  // The `to`/`data` shape a CallBuilder.build() produces, narrowed to the fields under assertion.
  type AggregateCall = { to: string; data: { method: string; params: { requireSuccess: string; calls: unknown[] } } };

  const aggregated = (entries: readonly { returnData: string; success: string }[]) => ({ returnData: entries });

  it('batches every IRC-2 read into a single tryAggregate and reads ICX once', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    const balanceSpy = vi
      .spyOn(iconSpoke.iconService, 'getBalance')
      .mockReturnValueOnce(httpCall({ toFixed: () => '12345' }) as never);
    const callSpy = vi
      .spyOn(iconSpoke.iconService, 'call')
      .mockReturnValueOnce(
        httpCall(
          aggregated([
            { returnData: '0x1d4c', success: '0x1' },
            { returnData: '0x0', success: '0x1' },
          ]),
        ) as never,
      );

    const result = await iconSpoke.getWalletBalances({
      srcChainKey: ICON,
      srcAddress: SRC_ADDR,
      tokens: [ICX_TOKEN, BNUSD_TOKEN, BALN_TOKEN],
    });

    expect(result).toEqual({
      [ICX_TOKEN.address]: 12345n,
      [BNUSD_TOKEN.address]: 7500n,
      // A confirmed on-chain zero: it counts as a successful read, so it must not trip the
      // "every read failed" rule that guards a dead RPC.
      [BALN_TOKEN.address]: 0n,
    });
    expect(warnSpy).not.toHaveBeenCalled();

    // The batching invariant: two IRC-2 tokens must cost one round-trip, not two.
    expect(balanceSpy).toHaveBeenCalledTimes(1);
    expect(balanceSpy).toHaveBeenCalledWith(SRC_ADDR);
    expect(callSpy).toHaveBeenCalledTimes(1);

    const arg = callSpy.mock.calls[0]?.[0] as AggregateCall;
    expect(arg.to).toBe('cxa4aa9185e23558cff990f494c1fd2845f6cbf741');
    expect(arg.data.method).toBe('tryAggregate');
    // requireSuccess=0x0 is what keeps one reverting balanceOf from discarding the whole batch.
    expect(arg.data.params.requireSuccess).toBe('0x0');
    expect(arg.data.params.calls).toEqual([
      // The user, NOT the asset manager — the one field that distinguishes this from getDeposit.
      { target: BNUSD_TOKEN.address, method: 'balanceOf', params: [SRC_ADDR] },
      { target: BALN_TOKEN.address, method: 'balanceOf', params: [SRC_ADDR] },
    ]);
  });

  it("reports a success:'0x0' entry as 0n, logs the failure, and leaves its siblings intact", async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(
      httpCall(
        aggregated([
          { returnData: '0x', success: '0x0' },
          { returnData: '0x1d4c', success: '0x1' },
        ]),
      ) as never,
    );

    const result = await iconSpoke.getWalletBalances({
      srcChainKey: ICON,
      srcAddress: SRC_ADDR,
      tokens: [BNUSD_TOKEN, BALN_TOKEN],
    });

    // A failed read is indistinguishable from an empty wallet in the flat map, so the log is the
    // only surviving signal — assert it fired so a silent zero cannot regress.
    expect(result[BNUSD_TOKEN.address]).toBe(0n);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({
        chainKey: ICON,
        token: BNUSD_TOKEN.address,
        error: expect.stringContaining(BNUSD_TOKEN.address),
      }),
    );
    expect(result[BALN_TOKEN.address]).toBe(7500n);
  });

  it('rejects when tryAggregate returns fewer entries than tokens rather than zeroing the tail', async () => {
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(
      httpCall(aggregated([{ returnData: '0x1d4c', success: '0x1' }])) as never,
    );

    await expect(
      iconSpoke.getWalletBalances({
        srcChainKey: ICON,
        srcAddress: SRC_ADDR,
        tokens: [BNUSD_TOKEN, BALN_TOKEN],
      }),
    ).rejects.toThrow(/tryAggregate returned 1 entries for 2 tokens/);
  });

  it('rejects when the response carries no returnData array at all', async () => {
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(httpCall({}) as never);

    await expect(
      iconSpoke.getWalletBalances({
        srcChainKey: ICON,
        srcAddress: SRC_ADDR,
        tokens: [BNUSD_TOKEN, BALN_TOKEN],
      }),
    ).rejects.toThrow(/tryAggregate returned no entries for 2 tokens/);
  });

  it('isolates a failing native ICX read to the native entry and logs it', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    const rpcError = new Error('icx rpc unavailable');
    vi.spyOn(iconSpoke.iconService, 'getBalance').mockReturnValueOnce(httpCallReject(rpcError) as never);
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(
      httpCall(aggregated([{ returnData: '0x1d4c', success: '0x1' }])) as never,
    );

    const result = await iconSpoke.getWalletBalances({
      srcChainKey: ICON,
      srcAddress: SRC_ADDR,
      tokens: [ICX_TOKEN, BNUSD_TOKEN],
    });

    expect(result[ICX_TOKEN.address]).toBe(0n);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: ICON, token: ICX_TOKEN.address, error: rpcError.message }),
    );
    expect(result[BNUSD_TOKEN.address]).toBe(7500n);
  });

  it('rejects when no token in the batch could be read, so a dead RPC never looks like an empty wallet', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(iconSpoke.iconService, 'getBalance').mockReturnValueOnce(
      httpCallReject(new Error('icx rpc unavailable')) as never,
    );
    vi.spyOn(iconSpoke.iconService, 'call').mockReturnValueOnce(
      httpCall(aggregated([{ returnData: '0x', success: '0x0' }])) as never,
    );

    await expect(
      iconSpoke.getWalletBalances({
        srcChainKey: ICON,
        srcAddress: SRC_ADDR,
        tokens: [ICX_TOKEN, BNUSD_TOKEN],
      }),
    ).rejects.toThrow(`every balance read failed on ${ICON} (2/2)`);

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// 5. sendMessage — connection contract, dst-relay-id derivation
// =========================================================================

describe('IconSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof ICON, Raw>>,
  ): SendMessageParams<typeof ICON, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: ICON,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockIconProvider,
      ...overrides,
    }) as SendMessageParams<typeof ICON, Raw>;

  it("raw=true → returns a rawTx targeting the connection contract with method='sendMessage'", async () => {
    const result = (await iconSpoke.sendMessage(sendMessageParams<true>({ raw: true }))) as Record<string, unknown>;

    expect(result.to).toBe(ICON_CONNECTION);
    expect(result.from).toBe(SRC_ADDR);
    expect(result.nid).toBe(ICON_NID);
    const data = result.data as { method: string; params: Record<string, unknown> };
    expect(data.method).toBe('sendMessage');
    expect(data.params.dstChainId).toBe(getIntentRelayChainId(SONIC));
    expect(data.params.dstAddress).toBe(DST_ADDR);
    expect(data.params.payload).toBe('0xdeadbeef');
  });

  it('raw=false → walletProvider.sendTransaction receives the connection payload', async () => {
    (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_HASH);

    const result = await iconSpoke.sendMessage(sendMessageParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    const sent = (mockIconProvider.sendTransaction as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      from: SRC_ADDR,
      to: ICON_CONNECTION,
      nid: ICON_NID,
      value: '0x0',
      method: 'sendMessage',
    });
  });

  it('pins getIntentRelayChainId(SONIC) === 146n (defensive against table drift)', () => {
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 6. encodeSimulationParams — native ICX→wICX substitution before encodeAddress
// =========================================================================

describe('IconSpokeService.encodeSimulationParams', () => {
  it('native ICX is substituted with wICX before encodeAddress', async () => {
    const { encodedToken, encodedSrcAddress } = iconSpoke.encodeSimulationParams(ICON_NATIVE, ICON_ASSET_MGR);

    // The substitution must match what `deposit()` does — wICX is the wrapped form registered
    // in the hub's asset manager. A regression that skipped the substitution would produce a
    // token address that doesn't exist in the hub.
    expect(encodedToken).toBe(encodeAddress(ICON, ICON_WICX));
    expect(encodedSrcAddress).toBe(encodeAddress(ICON, ICON_ASSET_MGR));
  });

  it('non-native token passes through unchanged', () => {
    const { encodedToken, encodedSrcAddress } = iconSpoke.encodeSimulationParams(ICON_BNUSD, ICON_ASSET_MGR);

    expect(encodedToken).toBe(encodeAddress(ICON, ICON_BNUSD));
    expect(encodedSrcAddress).toBe(encodeAddress(ICON, ICON_ASSET_MGR));
  });
});

// =========================================================================
// 7. waitForTransactionReceipt — every result branch + polling defaults
// =========================================================================

describe('IconSpokeService.waitForTransactionReceipt', () => {
  it('maps status===1 to status:success with the receipt', async () => {
    const receipt = { status: 1, txHash: TX_HASH, blockHeight: 42 };
    vi.spyOn(iconSpoke.iconService, 'getTransactionResult').mockReturnValueOnce(httpCall(receipt) as never);

    const result = await iconSpoke.waitForTransactionReceipt({ chainKey: ICON, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    expect(result.value.receipt).toBe(receipt);
  });

  it('maps status!==1 to status:failure with a JSON-stringified error message', async () => {
    const receipt = { status: 0, failure: 'reverted', txHash: TX_HASH };
    vi.spyOn(iconSpoke.iconService, 'getTransactionResult').mockReturnValueOnce(httpCall(receipt) as never);

    const result = await iconSpoke.waitForTransactionReceipt({ chainKey: ICON, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'failure') throw new Error('expected failure');
    expect(result.value.error.message).toContain('Transaction failed:');
    expect(result.value.error.message).toContain('"status":0');
  });

  it('transient rejection retries — second call succeeds', async () => {
    const receipt = { status: 1 };
    vi.spyOn(iconSpoke.iconService, 'getTransactionResult')
      .mockReturnValueOnce(httpCallReject(new Error('pending')) as never)
      .mockReturnValueOnce(httpCall(receipt) as never);

    const result = await iconSpoke.waitForTransactionReceipt({ chainKey: ICON, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    // sleep is invoked before the retry — defensive check that the polling path actually engaged.
    expect(mocks.sleep).toHaveBeenCalled();
  });

  it('persistent rejection past deadline → status:timeout', async () => {
    vi.spyOn(iconSpoke.iconService, 'getTransactionResult').mockReturnValue(
      httpCallReject(new Error('not found')) as never,
    );

    const result = await iconSpoke.waitForTransactionReceipt({
      chainKey: ICON,
      txHash: TX_HASH,
      // Tight deadline so the loop exits quickly under fake sleep.
      maxTimeoutMs: 1,
      pollingIntervalMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error.message).toContain('Timed out');
    expect(result.value.error.message).toContain(TX_HASH);
  });

  it('forwards real config-driven polling/timeout defaults when caller omits them', async () => {
    // The function reads `pollingIntervalMs` / `maxTimeoutMs` from constructor-stored config when
    // params don't supply them. We can't observe the timeout-deadline directly, but we can verify
    // sleep is called with the default polling interval on retry.
    vi.spyOn(iconSpoke.iconService, 'getTransactionResult')
      .mockReturnValueOnce(httpCallReject(new Error('pending')) as never)
      .mockReturnValueOnce(httpCall({ status: 1 }) as never);

    await iconSpoke.waitForTransactionReceipt({ chainKey: ICON, txHash: TX_HASH });

    expect(mocks.sleep).toHaveBeenCalledWith(ICON_POLLING_MS);
    // Pin the config values themselves to catch a renamed/dropped field.
    expect(ICON_POLLING_MS).toBe(2000);
    expect(ICON_TIMEOUT_MS).toBe(90_000);
  });

  it('forwards caller-supplied pollingIntervalMs to sleep on retry', async () => {
    vi.spyOn(iconSpoke.iconService, 'getTransactionResult')
      .mockReturnValueOnce(httpCallReject(new Error('pending')) as never)
      .mockReturnValueOnce(httpCall({ status: 1 }) as never);

    await iconSpoke.waitForTransactionReceipt({
      chainKey: ICON,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 60_000,
    });

    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
