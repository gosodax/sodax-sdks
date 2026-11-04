/**
 * Tests for InjectiveSpokeService — the single Injective spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (issue #109). Injective has one chain
 * (`ChainKeys.INJECTIVE_MAINNET`), so there is no `describe.each`. One Sodax instance backs every
 * test; `sodax.spoke.injective.txClient` / `.chainGrpcWasmApi` methods are spied per-test;
 * `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every address, networkId, polling interval, and
 * timeout is sourced from `spokeChainConfig[INJECTIVE_MAINNET]`. Only user identities and tx
 * hashes are fabricated.
 *
 * Mocking strategy:
 *   - `sleep` (shared-utils.js) is module-mocked at its source via `vi.mock` + `vi.hoisted`
 *     (with `vi.importActual` for the rest) so polling-loop tests don't actually wait.
 *   - The deposit/sendMessage tests spy on the spoke service's own `getRawTransaction` per-test to
 *     avoid network I/O; the dedicated `getRawTransaction` block instead mocks `ChainRestAuthApi`,
 *     `BaseAccount`, and `createTransaction` from `@injectivelabs/sdk-ts` to assert its
 *     account-fetch / fee / funds / accountNumber wiring directly.
 *   - `chainGrpcWasmApi.fetchSmartContractState` and `txClient.simulate`/`.fetchTx` are spied on
 *     the live instances.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Hex,
  type IInjectiveWalletProvider,
  type InjectiveRawTransaction,
} from '@sodax/types';
import { toBase64 } from '@injectivelabs/sdk-ts';

// --- hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sleep: vi.fn(),
  // `TxRaw` is imported directly from cosmjs-types because the @injectivelabs namespace export
  // does not expose the codec-style `fromPartial` helper in this runtime.
  txRawFromPartial: vi.fn(),
  // Stub the account fetch + (pure) tx builder + msg constructor so `getRawTransaction` can be
  // exercised directly (without spying on it) and its fee/funds/accountNumber wiring asserted.
  fetchCosmosAccount: vi.fn(),
  chainRestAuthApiEndpoints: [] as string[],
  baseAccountFromRest: vi.fn(),
  createTx: vi.fn(),
  msgExecFromJSON: vi.fn(),
}));

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return { ...actual, sleep: mocks.sleep };
});

vi.mock('@injectivelabs/sdk-ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@injectivelabs/sdk-ts');
  return {
    ...actual,
    createTransaction: mocks.createTx,
    ChainRestAuthApi: class {
      constructor(endpoint: string) {
        mocks.chainRestAuthApiEndpoints.push(endpoint);
      }
      fetchCosmosAccount = mocks.fetchCosmosAccount;
    },
    BaseAccount: { fromRestCosmosApi: mocks.baseAccountFromRest },
    MsgExecuteContract: {
      ...(actual.MsgExecuteContract as Record<string, unknown>),
      fromJSON: mocks.msgExecFromJSON,
    },
  };
});

vi.mock('cosmjs-types/cosmos/tx/v1beta1/tx.js', () => ({
  TxRaw: { fromPartial: mocks.txRawFromPartial },
}));

import { Sodax } from '../../entities/Sodax.js';
import { InjectiveSpokeService } from './InjectiveSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const injSpoke = sodax.spoke.injective;

const INJ = ChainKeys.INJECTIVE_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

const injConfig = spokeChainConfig[INJ];
const INJ_ASSET_MGR = injConfig.addresses.assetManager;
const INJ_CONNECTION = injConfig.addresses.connection;
const INJ_BNUSD = injConfig.bnUSD;
const INJ_NATIVE = injConfig.nativeToken;
const INJ_NETWORK_ID = injConfig.networkId;
const INJ_POLLING_MS = injConfig.pollingConfig.pollingIntervalMs;
const INJ_TIMEOUT_MS = injConfig.pollingConfig.maxTimeoutMs;

const SRC_ADDR = 'inj1pmdvtjvy9pxr9krx0e8v9q3v7m8q4u0aaaaaaa';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const TX_HASH = '7C0A0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789AB';

const mockInjProvider = {
  chainType: 'INJECTIVE',
  execute: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as IInjectiveWalletProvider;

// A canned rawTx shape that `getRawTransaction` returns; reused across tests to avoid hitting
// the real gRPC endpoint inside `createTransactionForAddressAndMsg`.
const makeRawTx = (to: string): InjectiveRawTransaction =>
  ({
    from: SRC_ADDR as Hex,
    to: to as Hex,
    signedDoc: {
      bodyBytes: new Uint8Array([1, 2, 3]),
      chainId: INJ_NETWORK_ID,
      accountNumber: 0n,
      authInfoBytes: new Uint8Array([4, 5, 6]),
    },
  }) as InjectiveRawTransaction;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sleep.mockResolvedValue(undefined);
  mocks.txRawFromPartial.mockReturnValue({ __fakeTxRaw: true });
  mocks.msgExecFromJSON.mockImplementation((args: unknown) => ({ __msg: args }));
  mocks.chainRestAuthApiEndpoints.length = 0;
  mocks.fetchCosmosAccount.mockResolvedValue({ account: 'raw' });
  mocks.baseAccountFromRest.mockReturnValue({ accountNumber: 7, sequence: 3, pubKey: { key: 'pk', type: '' } });
  // `createTransaction` is pure; echo the accountNumber into signDoc so the test verifies the
  // fetched account number flows through to the returned `signedDoc.accountNumber`.
  mocks.createTx.mockImplementation((args: { accountNumber: number }) => ({
    txRaw: { bodyBytes: new Uint8Array([10]), authInfoBytes: new Uint8Array([20]) },
    signDoc: { accountNumber: BigInt(args.accountNumber) },
  }));
  (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor
// =========================================================================

describe('InjectiveSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.injective with the expected method surface', () => {
    expect(injSpoke).toBeInstanceOf(InjectiveSpokeService);
    expect(typeof injSpoke.estimateGas).toBe('function');
    expect(typeof injSpoke.deposit).toBe('function');
    expect(typeof injSpoke.getDeposit).toBe('function');
    expect(typeof injSpoke.getWalletBalance).toBe('function');
    expect(typeof injSpoke.getWalletBalances).toBe('function');
    expect(typeof injSpoke.getRawTransaction).toBe('function');
    expect(typeof injSpoke.getState).toBe('function');
    expect(typeof injSpoke.sendMessage).toBe('function');
    expect(typeof injSpoke.receiveMessage).toBe('function');
    expect(typeof injSpoke.setRateLimit).toBe('function');
    expect(typeof injSpoke.setConnection).toBe('function');
    expect(typeof injSpoke.setOwner).toBe('function');
    expect(typeof injSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires chainGrpcWasmApi/indexerGrpcAccountPortfolioApi/txClient/endpoints', () => {
    expect(injSpoke.chainGrpcWasmApi).toBeDefined();
    expect(injSpoke.indexerGrpcAccountPortfolioApi).toBeDefined();
    expect(injSpoke.txClient).toBeDefined();
    expect(injSpoke.endpoints).toBeDefined();
  });
});

// =========================================================================
// 2. estimateGas — txClient.simulate delegation
// =========================================================================

describe('InjectiveSpokeService.estimateGas', () => {
  it('simulates a TxRaw built from the signedDoc and returns {gasWanted, gasUsed}', async () => {
    vi.spyOn(injSpoke.txClient, 'simulate').mockResolvedValueOnce({
      gasInfo: { gasWanted: 200_000, gasUsed: 150_000, gasFee: { amount: [], gasLimit: 0 } },
    } as never);

    const rawTx = makeRawTx(INJ_ASSET_MGR);
    const result = await injSpoke.estimateGas({ chainKey: INJ, tx: rawTx });

    expect(result).toEqual({ gasWanted: 200_000, gasUsed: 150_000 });
    // TxRaw.fromPartial receives the signedDoc bytes; we can assert against the mock because
    // the SUT funnels both bodyBytes and authInfoBytes through it.
    expect(mocks.txRawFromPartial).toHaveBeenCalledWith({
      bodyBytes: rawTx.signedDoc.bodyBytes,
      authInfoBytes: rawTx.signedDoc.authInfoBytes,
      signatures: [],
    });
  });
});

// =========================================================================
// 2b. getRawTransaction — self-broadcastable raw tx (accountNumber, fee, funds)
// =========================================================================

describe('InjectiveSpokeService.getRawTransaction', () => {
  const GAS_USED = 500_000;
  const EXPECTED_GAS = Math.ceil(GAS_USED * 1.2); // GAS_BUFFER_MULTIPLIER
  // injConfig.gasPrice is '500000000inj' → price 500000000, denom 'inj'.
  const EXPECTED_FEE_AMOUNT = (BigInt(EXPECTED_GAS) * 500_000_000n).toString();
  const FUNDS = [{ amount: '1000', denom: INJ_BNUSD }];

  beforeEach(() => {
    vi.spyOn(injSpoke.txClient, 'simulate').mockResolvedValue({
      gasInfo: { gasWanted: 600_000, gasUsed: GAS_USED, gasFee: { amount: [], gasLimit: 0 } },
    } as never);
  });

  it('returns the real accountNumber threaded from the fetched account (not the hardcoded 0)', async () => {
    const raw = await injSpoke.getRawTransaction(
      INJ_NETWORK_ID,
      SRC_ADDR,
      INJ_ASSET_MGR,
      { transfer: {} },
      undefined,
      FUNDS,
    );

    expect(raw.signedDoc.accountNumber).toBe(7n);
    expect(raw.from).toBe(SRC_ADDR);
    expect(raw.to).toBe(INJ_ASSET_MGR);
  });

  it('fetches the account once and threads sequence + pubKey into createTransaction', async () => {
    await injSpoke.getRawTransaction(INJ_NETWORK_ID, SRC_ADDR, INJ_ASSET_MGR, { transfer: {} }, undefined, FUNDS);

    expect(mocks.fetchCosmosAccount).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCosmosAccount).toHaveBeenCalledWith(SRC_ADDR);
    expect(mocks.chainRestAuthApiEndpoints).toEqual([injSpoke.endpoints.rest]);
    expect(mocks.createTx.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ pubKey: 'pk', sequence: 3, accountNumber: 7, chainId: INJ_NETWORK_ID }),
    );
  });

  it('simulates once and rebuilds with an explicit self-pay fee from simulated gas + chain gasPrice', async () => {
    await injSpoke.getRawTransaction(INJ_NETWORK_ID, SRC_ADDR, INJ_ASSET_MGR, { transfer: {} }, undefined, FUNDS);

    expect(injSpoke.txClient.simulate).toHaveBeenCalledTimes(1);
    // draft (no fee) then final (with fee) — both pure, single account fetch
    expect(mocks.createTx).toHaveBeenCalledTimes(2);
    expect(mocks.createTx.mock.calls[0]?.[0]?.fee).toBeUndefined();
    expect(mocks.createTx.mock.calls[1]?.[0]?.fee).toEqual({
      amount: [{ denom: 'inj', amount: EXPECTED_FEE_AMOUNT }],
      gas: EXPECTED_GAS.toString(),
    });
  });

  it('attaches the funds to the contract message', async () => {
    await injSpoke.getRawTransaction(INJ_NETWORK_ID, SRC_ADDR, INJ_ASSET_MGR, { transfer: {} }, undefined, FUNDS);

    expect(mocks.msgExecFromJSON).toHaveBeenCalledWith(expect.objectContaining({ funds: FUNDS }));
  });

  it('defaults funds to [] when not provided (e.g. sendMessage)', async () => {
    await injSpoke.getRawTransaction(INJ_NETWORK_ID, SRC_ADDR, INJ_CONNECTION, { send_message: {} });

    expect(mocks.msgExecFromJSON).toHaveBeenCalledWith(expect.objectContaining({ funds: [] }));
  });

  it('throws when the account has no on-chain pubKey', async () => {
    mocks.baseAccountFromRest.mockReturnValueOnce({ accountNumber: 7, sequence: 3, pubKey: { key: '', type: '' } });

    await expect(
      injSpoke.getRawTransaction(INJ_NETWORK_ID, SRC_ADDR, INJ_ASSET_MGR, { transfer: {} }, undefined, FUNDS),
    ).rejects.toThrow(/pubKey for .* is missing/);
  });
});

// =========================================================================
// 3. deposit — raw vs walletProvider, msg shape
// =========================================================================

describe('InjectiveSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof INJ, Raw>>,
  ): DepositParams<typeof INJ, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: INJ,
      to: HUB_WALLET,
      token: INJ_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockInjProvider,
      ...overrides,
    }) as DepositParams<typeof INJ, Raw>;

  it('raw=true → delegates to getRawTransaction with the asset-manager target and transfer msg', async () => {
    const fake = makeRawTx(INJ_ASSET_MGR);
    const spy = vi.spyOn(injSpoke, 'getRawTransaction').mockResolvedValueOnce(fake);

    const result = await injSpoke.deposit(depositParams<true>({ raw: true }));

    expect(result).toBe(fake);
    expect(spy).toHaveBeenCalledTimes(1);
    const [chainId, sender, contract, msg] = spy.mock.calls[0] ?? [];
    expect(chainId).toBe(INJ_NETWORK_ID);
    expect(sender).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_ASSET_MGR);
    expect(msg).toMatchObject({
      transfer: {
        token: INJ_BNUSD,
        amount: '1000',
      },
    });
    // `to` and `data` are byte arrays derived from the hex inputs.
    expect(Array.isArray((msg as { transfer: { to: unknown } }).transfer.to)).toBe(true);
    expect(Array.isArray((msg as { transfer: { data: unknown } }).transfer.data)).toBe(true);
  });

  it('raw=false → walletProvider.execute receives the funds + msg and returns transactionHash', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      transactionHash: TX_HASH,
    });

    const result = await injSpoke.deposit(depositParams<false>({ raw: false }));

    expect(result).toBe(TX_HASH);
    expect(mockInjProvider.execute).toHaveBeenCalledTimes(1);
    const [from, contract, msg, funds] = (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(from).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_ASSET_MGR);
    expect(msg).toHaveProperty('transfer');
    expect(funds).toEqual([{ amount: '1000', denom: INJ_BNUSD }]);
  });

  it('defaults data to "0x" when omitted (no `data: undefined` in msg)', async () => {
    const spy = vi.spyOn(injSpoke, 'getRawTransaction').mockResolvedValueOnce(makeRawTx(INJ_ASSET_MGR));

    const params = {
      srcAddress: SRC_ADDR,
      srcChainKey: INJ,
      to: HUB_WALLET,
      token: INJ_BNUSD,
      amount: 1_000n,
      raw: true,
    } as unknown as DepositParams<typeof INJ, true>;

    await injSpoke.deposit(params);

    const msg = spy.mock.calls[0]?.[3] as { transfer: { data: number[] } };
    expect(msg.transfer.data).toEqual([]); // '0x' → empty byte array
  });
});

// =========================================================================
// 4. getDeposit — fetchSmartContractState + base64 query
// =========================================================================

describe('InjectiveSpokeService.getDeposit', () => {
  it('queries the asset manager with a base64({get_balance: {denom: token}}) message', async () => {
    const spy = vi
      .spyOn(injSpoke.chainGrpcWasmApi, 'fetchSmartContractState')
      .mockResolvedValueOnce({ data: 'NTAw' } as never); // base64 of "500"

    const result = await injSpoke.getDeposit({
      srcChainKey: INJ,
      srcAddress: SRC_ADDR,
      token: INJ_BNUSD,
    });

    // The SUT pipes the response through fromBase64 → BigInt(...). The decoded value is the
    // numeric content of the base64 string.
    expect(typeof result).toBe('bigint');
    expect(spy).toHaveBeenCalledWith(INJ_ASSET_MGR, toBase64({ get_balance: { denom: INJ_BNUSD } }));
  });
});

// =========================================================================
// 4b. getWalletBalance / getWalletBalances — the USER's bank coins, matched by denom
// =========================================================================

describe('InjectiveSpokeService.getWalletBalance / getWalletBalances', () => {
  const INJ_TOKEN = injConfig.supportedTokens.INJ;
  const BNUSD_TOKEN = injConfig.supportedTokens.bnUSD;
  const USDC_TOKEN = injConfig.supportedTokens.USDC;
  const SODA_TOKEN = injConfig.supportedTokens.SODA;
  const USDT_TOKEN = injConfig.supportedTokens.USDT;

  const spyPortfolio = (bankBalancesList: { denom: string; amount: string }[]) =>
    vi
      .spyOn(injSpoke.indexerGrpcAccountPortfolioApi, 'fetchAccountPortfolioBalances')
      .mockResolvedValueOnce({ accountAddress: SRC_ADDR, bankBalancesList, subaccountsList: [] } as never);

  it('matches a non-native token by its token.address denom, on the USER account', async () => {
    const spy = spyPortfolio([
      { denom: INJ_NATIVE, amount: '999' },
      { denom: BNUSD_TOKEN.address, amount: '5000' },
    ]);

    const result = await injSpoke.getWalletBalance({ srcChainKey: INJ, srcAddress: SRC_ADDR, token: BNUSD_TOKEN });

    expect(result).toBe(5000n);
    // The portfolio is fetched for the user, NOT the asset manager — the difference from getDeposit.
    expect(spy).toHaveBeenCalledWith(SRC_ADDR);
    expect(spy).not.toHaveBeenCalledWith(INJ_ASSET_MGR);
  });

  it('matches native INJ by the config nativeToken denom, not by another account entry', async () => {
    spyPortfolio([
      { denom: BNUSD_TOKEN.address, amount: '5000' },
      { denom: INJ_NATIVE, amount: '42' },
    ]);

    const result = await injSpoke.getWalletBalance({ srcChainKey: INJ, srcAddress: SRC_ADDR, token: INJ_TOKEN });

    expect(result).toBe(42n);
  });

  it('returns 0n for a denom absent from a portfolio that WAS fetched successfully', async () => {
    spyPortfolio([{ denom: INJ_NATIVE, amount: '42' }]);

    const result = await injSpoke.getWalletBalance({ srcChainKey: INJ, srcAddress: SRC_ADDR, token: USDC_TOKEN });

    expect(result).toBe(0n);
  });

  it('rejects when the portfolio fetch fails, so an unread balance never surfaces as 0n', async () => {
    const rpcError = new Error('indexer unavailable');
    vi.spyOn(injSpoke.indexerGrpcAccountPortfolioApi, 'fetchAccountPortfolioBalances').mockRejectedValueOnce(rpcError);

    await expect(
      injSpoke.getWalletBalance({ srcChainKey: INJ, srcAddress: SRC_ADDR, token: BNUSD_TOKEN }),
    ).rejects.toThrow(rpcError);
  });

  it('getWalletBalances issues exactly one portfolio fetch for every token and keys by token.address', async () => {
    const spy = spyPortfolio([
      { denom: INJ_NATIVE, amount: '11' },
      { denom: BNUSD_TOKEN.address, amount: '22' },
      { denom: USDT_TOKEN.address, amount: '33' },
    ]);
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');

    const result = await injSpoke.getWalletBalances({
      srcChainKey: INJ,
      srcAddress: SRC_ADDR,
      tokens: Object.values(injConfig.supportedTokens),
    });

    expect(result).toEqual({
      [INJ_TOKEN.address]: 11n,
      [BNUSD_TOKEN.address]: 22n,
      [USDT_TOKEN.address]: 33n,
      // Absent denoms are confirmed zeroes, not failures: the bank module omits zero balances.
      [USDC_TOKEN.address]: 0n,
      [SODA_TOKEN.address]: 0n,
    });
    // A read 0n and a failed-read 0n are indistinguishable in the flat map, so the absent denoms
    // above must NOT have been logged as failures.
    expect(warnSpy).not.toHaveBeenCalled();
    // One shared fetch covers N tokens — the batching invariant this chain's implementation buys.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(SRC_ADDR);
  });

  it('getWalletBalances rejects when the single shared fetch fails — no per-token read to isolate', async () => {
    const rpcError = new Error('indexer unavailable');
    vi.spyOn(injSpoke.indexerGrpcAccountPortfolioApi, 'fetchAccountPortfolioBalances').mockRejectedValueOnce(rpcError);

    // Nothing was read at all, so a map of zeroes would render a dead indexer as an empty wallet.
    await expect(
      injSpoke.getWalletBalances({
        srcChainKey: INJ,
        srcAddress: SRC_ADDR,
        tokens: [INJ_TOKEN, BNUSD_TOKEN],
      }),
    ).rejects.toThrow(rpcError);
  });
});

// =========================================================================
// 5. getState — fetchSmartContractState({get_state: {}})
// =========================================================================

describe('InjectiveSpokeService.getState', () => {
  it('queries the asset manager with a base64({get_state: {}}) message', async () => {
    const fakeState = { connection: INJ_CONNECTION, owner: 'inj1...' };
    const spy = vi
      .spyOn(injSpoke.chainGrpcWasmApi, 'fetchSmartContractState')
      .mockResolvedValueOnce(fakeState as never);

    const result = await injSpoke.getState(INJ);
    expect(result).toBe(fakeState);
    expect(spy).toHaveBeenCalledWith(INJ_ASSET_MGR, toBase64({ get_state: {} }));
  });
});

// =========================================================================
// 6. sendMessage — raw vs walletProvider, dst-relay-id, connection contract target
// =========================================================================

describe('InjectiveSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof INJ, Raw>>,
  ): SendMessageParams<typeof INJ, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: INJ,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockInjProvider,
      ...overrides,
    }) as SendMessageParams<typeof INJ, Raw>;

  it('raw=true → delegates to getRawTransaction with the connection target and send_message msg', async () => {
    const fake = makeRawTx(INJ_CONNECTION);
    const spy = vi.spyOn(injSpoke, 'getRawTransaction').mockResolvedValueOnce(fake);

    const result = await injSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result).toBe(fake);
    const [chainId, sender, contract, msg] = spy.mock.calls[0] ?? [];
    expect(chainId).toBe(INJ_NETWORK_ID);
    expect(sender).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_CONNECTION);
    expect(msg).toMatchObject({
      send_message: {
        dst_chain_id: Number(getIntentRelayChainId(SONIC)),
      },
    });
  });

  it('raw=false → walletProvider.execute receives the connection target and returns hash', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      transactionHash: TX_HASH,
    });

    const result = await injSpoke.sendMessage(sendMessageParams<false>({ raw: false }));
    expect(result).toBe(TX_HASH);
    const [, contract, msg] = (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(contract).toBe(INJ_CONNECTION);
    expect(msg).toHaveProperty('send_message');
  });

  it('pins getIntentRelayChainId(SONIC) === 146n', () => {
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 7. Admin / receiveMessage smoke tests
// =========================================================================

describe('InjectiveSpokeService — admin methods', () => {
  it('receiveMessage delegates to walletProvider.execute on the asset manager', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      transactionHash: TX_HASH,
    });

    await injSpoke.receiveMessage(
      SRC_ADDR,
      INJ,
      new Uint8Array([1, 2]),
      '1',
      new Uint8Array([3, 4]),
      [new Uint8Array([5, 6])],
      mockInjProvider,
    );

    const [from, contract, msg] = (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(from).toBe(SRC_ADDR);
    expect(contract).toBe(INJ_ASSET_MGR);
    expect(msg).toHaveProperty('recv_message');
  });

  it('setRateLimit / setConnection / setOwner each call walletProvider.execute on the asset manager', async () => {
    (mockInjProvider.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactionHash: TX_HASH,
    });

    await injSpoke.setRateLimit(INJ, SRC_ADDR, '1000', mockInjProvider);
    await injSpoke.setConnection(INJ, SRC_ADDR, INJ_CONNECTION, mockInjProvider);
    await injSpoke.setOwner(SRC_ADDR, 'inj1newowner', INJ, mockInjProvider);

    expect(mockInjProvider.execute as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(3);
    for (const call of (mockInjProvider.execute as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toBe(INJ_ASSET_MGR);
    }
  });
});

// =========================================================================
// 8. waitForTransactionReceipt — every branch + polling defaults
// =========================================================================

describe('InjectiveSpokeService.waitForTransactionReceipt', () => {
  it('code===0 → status:success with the tx receipt', async () => {
    const fakeTx = { code: 0, txHash: TX_HASH };
    vi.spyOn(injSpoke.txClient, 'fetchTx').mockResolvedValueOnce(fakeTx as never);

    const result = await injSpoke.waitForTransactionReceipt({ chainKey: INJ, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toBe(fakeTx);
  });

  it('code!==0 → status:failure with code+rawLog in the error message', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx').mockResolvedValueOnce({ code: 5, rawLog: 'boom' } as never);

    const result = await injSpoke.waitForTransactionReceipt({ chainKey: INJ, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error.message).toContain('code 5');
    expect(result.value.error.message).toContain('boom');
  });

  it('transient throw → recovers on next poll', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx')
      .mockRejectedValueOnce(new Error('not indexed'))
      .mockResolvedValueOnce({ code: 0 } as never);

    const result = await injSpoke.waitForTransactionReceipt({
      chainKey: INJ,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(mocks.sleep).toHaveBeenCalled();
  });

  it('persistent throw past deadline → status:timeout', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx').mockRejectedValue(new Error('not indexed'));

    const result = await injSpoke.waitForTransactionReceipt({
      chainKey: INJ,
      txHash: TX_HASH,
      pollingIntervalMs: 1,
      maxTimeoutMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
  });

  it('config-driven defaults: pollingConfig pins polling=750ms / timeout=45_000ms', () => {
    expect(INJ_POLLING_MS).toBe(750);
    expect(INJ_TIMEOUT_MS).toBe(45_000);
  });

  it('forwards caller-supplied pollingIntervalMs to sleep on retry', async () => {
    vi.spyOn(injSpoke.txClient, 'fetchTx')
      .mockRejectedValueOnce(new Error('not indexed'))
      .mockResolvedValueOnce({ code: 0 } as never);

    await injSpoke.waitForTransactionReceipt({
      chainKey: INJ,
      txHash: TX_HASH,
      pollingIntervalMs: 7,
      maxTimeoutMs: 1000,
    });

    expect(mocks.sleep).toHaveBeenCalledWith(7);
  });
});
