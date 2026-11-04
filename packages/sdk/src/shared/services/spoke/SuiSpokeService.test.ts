/**
 * Tests for SuiSpokeService — the single Sui spoke chain.
 *
 * Pattern: mirrors EvmSpokeService.test.ts (issue #109) but collapsed to a single chain. Sui has
 * one chain (`ChainKeys.SUI_MAINNET`), so there is no `describe.each` parametrisation, no per-chain
 * client cache, and no cross-chain independence section. The single-chain shape is closer to
 * `SonicSpokeService.test.ts`: one Sodax instance backs every test; `sodax.spoke.sui.transport`
 * methods are spied per-test; `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — every Move type string, package id, module name,
 * polling interval, and timeout is sourced from `spokeChainConfig[SUI_MAINNET]` rather than fake
 * constants. That catches a class of regressions where a hardcoded value happens to match a test
 * fixture but diverges from production config (wrong package, wrong module name, etc.). Only user
 * identities (`SRC_ADDR`, `HUB_WALLET`, `DST_ADDR`) and per-test scratch data (digests, mock
 * balances) are fabricated.
 *
 * `@mysten/sui` is NOT module-mocked: real `Transaction`, `bcs`, and `SuiGrpcClient` constructors
 * run. `tx.serialize()` is a local-only operation (no network). Only the `SuiTransport` methods the
 * SUT calls are spied per-test: getCoins, simulate, estimateGas, fetchLatestPackageId,
 * waitForTransaction. The `client.core` translation itself is covered by SuiGrpcTransport.test.ts.
 *
 * The asset manager package id is read from chain on every build, so a test that reaches a build
 * path stubs `fetchLatestPackageId` itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { toHex } from 'viem';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Address,
  type Hex,
  type ISuiWalletProvider,
  type SuiExecutionResult,
  type SuiPaginatedCoins,
  type SuiTransport,
} from '@sodax/types';

import { Sodax } from '../../entities/Sodax.js';
import { SuiSpokeService } from './SuiSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const suiSpoke = sodax.spoke.sui;

const SUI = ChainKeys.SUI_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)

// REAL config — every consumer of these values in production reads from the same source.
const suiConfig = spokeChainConfig[SUI];
const SUI_NATIVE = suiConfig.nativeToken;
const SUI_BNUSD = suiConfig.bnUSD;
const SUI_CONNECTION = suiConfig.addresses.connection;
const SUI_ASSET_MGR = suiConfig.addresses.assetManager;
const SUI_ASSET_MGR_CONFIG_ID = suiConfig.addresses.assetManagerConfigId;
const SUI_POLLING_MS = suiConfig.pollingConfig.pollingIntervalMs;
const SUI_TIMEOUT_MS = suiConfig.pollingConfig.maxTimeoutMs;

// Derived from real config via the SUT's own parser — proves the splitAddress contract
// round-trips against config and gives us the exact `to` strings the SUT will produce.
const { packageId: SUI_ASSET_MGR_PKG, moduleId: SUI_ASSET_MGR_MOD } = suiSpoke.splitAddress(SUI_ASSET_MGR);
const {
  packageId: SUI_CONN_PKG,
  moduleId: SUI_CONN_MOD,
  stateId: SUI_CONN_STATE,
} = suiSpoke.splitAddress(SUI_CONNECTION);

// Per-user / per-flow scratch — these have no config source.
const SRC_ADDR = `0x${'11'.repeat(32)}` as Address; // valid 32-byte Sui address
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const DST_ADDR: Address = '0x3333333333333333333333333333333333333333';
const TX_DIGEST = '7g6sQdY5RrZ4kRzBz7VLgY3qX2vN6Y4mT8L1J5K9A2Bx';

const mockSuiProvider = {
  chainType: 'SUI',
  signAndExecuteTxn: vi.fn(),
  getWalletAddress: vi.fn(),
  viewContract: vi.fn(),
  getCoins: vi.fn(),
} as unknown as ISuiWalletProvider;

const makeCoinsPage = (
  coins: Array<{ balance: string; coinObjectId: string }>,
  coinType: string = SUI_BNUSD,
): SuiPaginatedCoins => ({
  data: coins.map(c => ({
    coinType,
    coinObjectId: c.coinObjectId,
    version: '1',
    digest: 'deadbeef',
    balance: c.balance,
  })),
  hasNextPage: false,
  nextCursor: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor
// =========================================================================

describe('SuiSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.sui with the expected method surface', () => {
    expect(suiSpoke).toBeInstanceOf(SuiSpokeService);
    expect(typeof suiSpoke.getCoins).toBe('function');
    expect(typeof suiSpoke.getCoin).toBe('function');
    expect(typeof suiSpoke.splitAddress).toBe('function');
    expect(typeof suiSpoke.getNativeCoin).toBe('function');
    expect(typeof suiSpoke.encodeSimulationParams).toBe('function');
    expect(typeof suiSpoke.getAssetManagerAddress).toBe('function');
    expect(typeof suiSpoke.viewContract).toBe('function');
    expect(typeof suiSpoke.deposit).toBe('function');
    expect(typeof suiSpoke.sendMessage).toBe('function');
    expect(typeof suiSpoke.estimateGas).toBe('function');
    expect(typeof suiSpoke.getDeposit).toBe('function');
    expect(typeof suiSpoke.getWalletBalance).toBe('function');
    expect(typeof suiSpoke.getWalletBalances).toBe('function');
    expect(typeof suiSpoke.fetchAssetManagerAddress).toBe('function');
    expect(typeof suiSpoke.fetchLatestAssetManagerPackageId).toBe('function');
    expect(typeof suiSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires a gRPC transport, pointed at the configured endpoint, with the port surface', () => {
    expect(suiSpoke.transport.endpoint).toBe(suiConfig.grpc_url);
    expect(typeof suiSpoke.transport.getCoins).toBe('function');
    expect(typeof suiSpoke.transport.simulate).toBe('function');
    expect(typeof suiSpoke.transport.estimateGas).toBe('function');
    expect(typeof suiSpoke.transport.fetchLatestPackageId).toBe('function');
    expect(typeof suiSpoke.transport.waitForTransaction).toBe('function');
  });

  it('keeps `publicClient` as a deprecated alias of `transport`', () => {
    expect(suiSpoke.publicClient).toBe(suiSpoke.transport);
  });

  it('honors a pre-gRPC `rpc_url` override so existing consumer config keeps working', () => {
    const custom = new Sodax({ chains: { [SUI]: { rpc_url: 'https://my-node.example' } } });

    expect(custom.spoke.sui.transport.endpoint).toBe('https://my-node.example');
  });

  it('prefers `grpc_url` from config over the packaged default', () => {
    const custom = new Sodax({ chains: { [SUI]: { grpc_url: 'https://my-grpc.example' } } });

    expect(custom.spoke.sui.transport.endpoint).toBe('https://my-grpc.example');
  });
});

// =========================================================================
// 2. getCoins — pass-through to transport.getCoins
// =========================================================================

describe('SuiSpokeService.getCoins', () => {
  it('forwards owner + coinType to transport.getCoins', async () => {
    const page = makeCoinsPage([{ balance: '1000', coinObjectId: '0xa' }]);
    const spy = vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(page);

    const result = await suiSpoke.getCoins(SRC_ADDR, SUI_BNUSD);

    expect(result).toBe(page);
    expect(spy).toHaveBeenCalledWith(SRC_ADDR, SUI_BNUSD);
  });
});

// =========================================================================
// 3. getCoin — coin selection / merge / split branches
// =========================================================================

describe('SuiSpokeService.getCoin', () => {
  it('single coin with exact balance → tx.object (no merge, no split)', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '1000', coinObjectId: '0xa' }]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');
    const splitSpy = vi.spyOn(tx, 'splitCoins');
    const objectSpy = vi.spyOn(tx, 'object');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    expect(mergeSpy).not.toHaveBeenCalled();
    expect(splitSpy).not.toHaveBeenCalled();
    expect(objectSpy).toHaveBeenCalledWith('0xa');
  });

  it('single coin with excess balance → tx.splitCoins for the exact amount', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]),
    );
    const tx = new Transaction();
    const splitSpy = vi.spyOn(tx, 'splitCoins');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    expect(splitSpy).toHaveBeenCalledWith('0xa', [1_000n]);
  });

  it('multiple coins summing above amount → mergeCoins then splitCoins', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([
        { balance: '500', coinObjectId: '0xa' },
        { balance: '700', coinObjectId: '0xb' },
      ]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');
    const splitSpy = vi.spyOn(tx, 'splitCoins');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    // first object is the merge destination; remaining objects (slice(1)) are merged in
    expect(mergeSpy).toHaveBeenCalledWith('0xa', ['0xb']);
    expect(splitSpy).toHaveBeenCalledWith('0xa', [1_000n]);
  });

  it('multiple coins summing to exact amount → mergeCoins then tx.object (no split)', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([
        { balance: '500', coinObjectId: '0xa' },
        { balance: '500', coinObjectId: '0xb' },
      ]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');
    const splitSpy = vi.spyOn(tx, 'splitCoins');
    const objectSpy = vi.spyOn(tx, 'object');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    expect(mergeSpy).toHaveBeenCalledWith('0xa', ['0xb']);
    expect(splitSpy).not.toHaveBeenCalled();
    expect(objectSpy).toHaveBeenCalledWith('0xa');
  });

  it('stops iterating coins once totalAmount >= amount (third coin not included)', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([
        { balance: '600', coinObjectId: '0xa' },
        { balance: '500', coinObjectId: '0xb' },
        { balance: '999', coinObjectId: '0xc' },
      ]),
    );
    const tx = new Transaction();
    const mergeSpy = vi.spyOn(tx, 'mergeCoins');

    await suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR);

    // Only 0xb merged in; 0xc never reached because totalAmount hit 1100 >= 1000 on coin #2.
    expect(mergeSpy).toHaveBeenCalledWith('0xa', ['0xb']);
  });

  it('throws when no coins exist for the address', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(makeCoinsPage([]));
    const tx = new Transaction();

    await expect(suiSpoke.getCoin(tx, SUI_BNUSD, 1_000n, SRC_ADDR)).rejects.toThrow(
      `[SuiIntentService.getCoin] Coin=${SUI_BNUSD} not found for address=${SRC_ADDR} and amount=1000`,
    );
  });
});

// =========================================================================
// 4. splitAddress — pure parsing, error branches
// =========================================================================

describe('SuiSpokeService.splitAddress', () => {
  it('parses a valid pkg::module::state into its three parts', () => {
    // Real config value — round-trips against suiConfig.addresses.connection.
    expect(suiSpoke.splitAddress(SUI_CONNECTION)).toEqual({
      packageId: SUI_CONN_PKG,
      moduleId: SUI_CONN_MOD,
      stateId: SUI_CONN_STATE,
    });
  });

  it('throws on fewer than 3 segments', () => {
    expect(() => suiSpoke.splitAddress('pkg::module')).toThrow('Invalid package address');
  });

  it('throws on more than 3 segments', () => {
    expect(() => suiSpoke.splitAddress('pkg::module::state::extra')).toThrow('Invalid package address');
  });

  it('throws when any of the 3 segments is empty (trailing ::)', () => {
    // length === 3 but parts[2] is '' — falls through to the inner throw.
    expect(() => suiSpoke.splitAddress('pkg::module::')).toThrow('Invalid package address');
  });

  it('throws when the leading segment is empty (leading ::)', () => {
    expect(() => suiSpoke.splitAddress('::module::state')).toThrow('Invalid package address');
  });
});

// =========================================================================
// 5. getNativeCoin — split-from-gas path + undefined branch
// =========================================================================

describe('SuiSpokeService.getNativeCoin', () => {
  it('splits a coin from tx.gas for the requested amount', async () => {
    const tx = new Transaction();
    const splitSpy = vi.spyOn(tx, 'splitCoins');

    const coin = await suiSpoke.getNativeCoin(tx, 5_000n);

    expect(splitSpy).toHaveBeenCalledTimes(1);
    // First arg is tx.gas (an opaque reference); second is the amount tuple.
    const [, amounts] = splitSpy.mock.calls[0] ?? [];
    expect(Array.isArray(amounts)).toBe(true);
    expect(coin).toBeDefined();
  });

  it('rejects when tx.splitCoins yields an undefined element (defensive branch)', async () => {
    const tx = new Transaction();
    // Force the only path the catch covers — splitCoins returning [undefined]. Deliberately
    // malformed: a real TransactionResult is an array-like with Result/$kind fields.
    vi.spyOn(tx, 'splitCoins').mockReturnValueOnce([undefined] as unknown as ReturnType<Transaction['splitCoins']>);

    await expect(suiSpoke.getNativeCoin(tx, 5_000n)).rejects.toThrow('[SuiIntentService.getNativeCoin] coin undefined');
  });
});

// =========================================================================
// 6. encodeSimulationParams — UTF-8 (NOT BCS Address) encoding for Move strings
// =========================================================================

describe('SuiSpokeService.encodeSimulationParams', () => {
  it('returns UTF-8 hex encodings of the token and assetManager Move type strings', () => {
    // Anti-regression for the in-source comment: Move type strings ("0xPKG::module::ID") must NOT
    // go through BCS Address serialization (which expects 32-byte hex). UTF-8 is the contract.
    const { encodedToken, encodedSrcAddress } = suiSpoke.encodeSimulationParams(SUI_BNUSD, SUI_ASSET_MGR);

    const encoder = new TextEncoder();
    expect(encodedToken).toBe(toHex(encoder.encode(SUI_BNUSD)));
    expect(encodedSrcAddress).toBe(toHex(encoder.encode(SUI_ASSET_MGR)));
  });
});

// =========================================================================
// 8. getAssetManagerAddress — read per call, overlapping reads shared
// =========================================================================

describe('SuiSpokeService.getAssetManagerAddress', () => {
  const UPGRADED_PKG = `0x${'9'.repeat(64)}`;

  it('fetches the package id and composes pkg::asset_manager::configId', async () => {
    // Use the REAL package id from config so the composed result round-trips against
    // suiConfig.addresses.assetManager.
    const spy = vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);

    const result = await suiSpoke.getAssetManagerAddress(SUI);

    expect(result).toBe(SUI_ASSET_MGR);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(SUI_ASSET_MGR_CONFIG_ID);
  });

  it('re-reads on the next call, so a package upgrade is picked up', async () => {
    const spy = vi
      .spyOn(suiSpoke.transport, 'fetchLatestPackageId')
      .mockResolvedValueOnce(SUI_ASSET_MGR_PKG)
      .mockResolvedValueOnce(UPGRADED_PKG);

    await expect(suiSpoke.getAssetManagerAddress(SUI)).resolves.toBe(SUI_ASSET_MGR);
    await expect(suiSpoke.getAssetManagerAddress(SUI)).resolves.toBe(
      `${UPGRADED_PKG}::${SUI_ASSET_MGR_MOD}::${SUI_ASSET_MGR_CONFIG_ID}`,
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shares one read between callers that overlap', async () => {
    // Collect every resolver, not just the last one: a regression that starts 50 reads then fails
    // the call-count assertion, instead of leaving 49 promises pending until the test times out.
    const releases: Array<(packageId: string) => void> = [];
    const spy = vi
      .spyOn(suiSpoke.transport, 'fetchLatestPackageId')
      .mockImplementation(() => new Promise<string>(resolve => releases.push(resolve)));

    // Every caller asks while the read is still pending, so none of them can be a cache hit.
    const calls = Array.from({ length: 50 }, () => suiSpoke.getAssetManagerAddress(SUI));
    for (const release of releases) release(SUI_ASSET_MGR_PKG);

    expect(new Set(await Promise.all(calls))).toEqual(new Set([SUI_ASSET_MGR]));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not hold on to a failed read', async () => {
    const spy = vi
      .spyOn(suiSpoke.transport, 'fetchLatestPackageId')
      .mockRejectedValueOnce(new Error('node down'))
      .mockResolvedValueOnce(SUI_ASSET_MGR_PKG);

    await expect(suiSpoke.getAssetManagerAddress(SUI)).rejects.toThrow('node down');
    await expect(suiSpoke.getAssetManagerAddress(SUI)).resolves.toBe(SUI_ASSET_MGR);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// 9. fetchLatestAssetManagerPackageId — delegation
// Object-shape guards and their messages live in SuiGrpcTransport.test.ts.
// =========================================================================

describe('SuiSpokeService.fetchLatestAssetManagerPackageId', () => {
  it('resolves the config object id through the transport', async () => {
    const spy = vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValueOnce(SUI_ASSET_MGR_PKG);

    const result = await suiSpoke.fetchLatestAssetManagerPackageId(SUI);

    expect(result).toBe(SUI_ASSET_MGR_PKG);
    expect(spy).toHaveBeenCalledWith(SUI_ASSET_MGR_CONFIG_ID);
  });

  it('propagates transport failures', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockRejectedValueOnce(
      new Error('Asset manager id not found (no data)'),
    );

    await expect(suiSpoke.fetchLatestAssetManagerPackageId(SUI)).rejects.toThrow(
      'Asset manager id not found (no data)',
    );
  });
});

// =========================================================================
// 10. viewContract — devInspect delegation
// =========================================================================

describe('SuiSpokeService.viewContract', () => {
  it('queues a moveCall and returns the simulation result', async () => {
    const tx = new Transaction();
    const moveCallSpy = vi.spyOn(tx, 'moveCall');
    const fakeResult = { returnValues: [[[1, 2, 3], '']] } satisfies SuiExecutionResult;
    const simulateSpy = vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce(fakeResult);

    const out = await suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], ['u64'], SRC_ADDR);

    expect(out).toBe(fakeResult);
    expect(moveCallSpy).toHaveBeenCalledWith({
      target: 'pkg::mod::fn',
      arguments: [],
      typeArguments: ['u64'],
    });
    expect(simulateSpy).toHaveBeenCalledWith(tx, SRC_ADDR);
  });

  it('defaults typeArgs to [] when omitted', async () => {
    const tx = new Transaction();
    const moveCallSpy = vi.spyOn(tx, 'moveCall');
    vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce({ returnValues: [] });

    // Last arg `sender` is required; typeArgs (the 6th positional) defaults to [].
    await suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], undefined, SRC_ADDR);

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({ typeArguments: [] }));
  });

  it('propagates the transport error when the simulation returns no values', async () => {
    const tx = new Transaction();
    vi.spyOn(suiSpoke.transport, 'simulate').mockRejectedValueOnce(
      new Error("transaction didn't return any values: {}"),
    );

    await expect(suiSpoke.viewContract(tx, 'pkg', 'mod', 'fn', [], [], SRC_ADDR)).rejects.toThrow(
      /transaction didn't return any values/,
    );
  });
});

// =========================================================================
// 11. deposit — native vs ERC20, raw vs walletProvider, default `data`
// =========================================================================

describe('SuiSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof SUI, Raw>>,
  ): DepositParams<typeof SUI, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SUI,
      to: HUB_WALLET,
      token: SUI_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockSuiProvider,
      ...overrides,
    }) as DepositParams<typeof SUI, Raw>;

  const expectedTransferTarget = `${SUI_ASSET_MGR_PKG}::${SUI_ASSET_MGR_MOD}::transfer`;

  it('native raw=true → returns rawTx targeting <assetManager>::transfer with value=amount', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);

    const result = await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(expectedTransferTarget);
    expect(result.value).toBe(1_000n);
    // `data` is the @mysten/sui Transaction JSON from `serialize()`. Pin the shape, not the exact
    // value (serialization is not deterministic across @mysten/sui versions), and assert it
    // round-trips through `Transaction.from()` — the consume path used for signing and gas
    // estimation. This guards the "Unknown value 6 for enum TransactionKind" regression.
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
    expect(() => Transaction.from(result.data)).not.toThrow();
  });

  it('native raw=true does NOT call publicClient.getCoins (native path uses tx.gas)', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    const getCoinsSpy = vi.spyOn(suiSpoke.transport, 'getCoins');

    await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(getCoinsSpy).not.toHaveBeenCalled();
  });

  it('ERC20 raw=true → fetches user coins and returns rawTx with value=amount', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]),
    );

    const result = await suiSpoke.deposit(depositParams<true>({ token: SUI_BNUSD, raw: true }));

    expect(result.to).toBe(expectedTransferTarget);
    expect(result.from).toBe(SRC_ADDR);
    expect(result.value).toBe(1_000n);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('ERC20 raw=true reads coins via publicClient.getCoins with the deposited coinType', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    const getCoinsSpy = vi
      .spyOn(suiSpoke.transport, 'getCoins')
      .mockResolvedValueOnce(makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]));

    await suiSpoke.deposit(depositParams<true>({ token: SUI_BNUSD, raw: true }));

    expect(getCoinsSpy).toHaveBeenCalledWith(SRC_ADDR, SUI_BNUSD);
  });

  it('raw=false → delegates to walletProvider.signAndExecuteTxn and returns its digest', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]),
    );
    (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_DIGEST);

    const result = await suiSpoke.deposit(depositParams<false>({ raw: false, walletProvider: mockSuiProvider }));

    expect(result).toBe(TX_DIGEST);
    expect(mockSuiProvider.signAndExecuteTxn).toHaveBeenCalledTimes(1);
    expect(mockSuiProvider.signAndExecuteTxn).toHaveBeenCalledWith(expect.any(Transaction));
  });

  it("defaults data to '0x' when omitted from the deposit params", async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    // Drop `data` entirely; the destructuring `data = '0x'` default must kick in.
    const params = {
      srcAddress: SRC_ADDR,
      srcChainKey: SUI,
      to: HUB_WALLET,
      token: SUI_NATIVE,
      amount: 1_000n,
      raw: true,
    } as unknown as DepositParams<typeof SUI, true>;

    await expect(suiSpoke.deposit(params)).resolves.toMatchObject({ to: expectedTransferTarget });
  });

  it('fetches the package id before building the tx', async () => {
    const spy = vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValueOnce(SUI_ASSET_MGR_PKG);

    const result = await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(spy).toHaveBeenCalledWith(SUI_ASSET_MGR_CONFIG_ID);
    expect(result.to).toBe(expectedTransferTarget);
  });

  it('reads the coins and the package id together, not one after the other', async () => {
    let resolveCoins!: (page: SuiPaginatedCoins) => void;
    vi.spyOn(suiSpoke.transport, 'getCoins').mockImplementationOnce(
      () => new Promise<SuiPaginatedCoins>(resolve => (resolveCoins = resolve)),
    );
    const packageSpy = vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);

    const pending = suiSpoke.deposit(depositParams<true>({ token: SUI_BNUSD, raw: true }));
    await Promise.resolve();

    // The coin read is still pending; a sequential build would not have asked for the package yet.
    expect(packageSpy).toHaveBeenCalledTimes(1);

    resolveCoins(makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }]));
    await expect(pending).resolves.toMatchObject({ to: expectedTransferTarget });
  });

  it('targets the upgraded package on the next deposit', async () => {
    const upgraded = `0x${'9'.repeat(64)}`;
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId')
      .mockResolvedValueOnce(SUI_ASSET_MGR_PKG)
      .mockResolvedValueOnce(upgraded);

    const before = await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));
    const after = await suiSpoke.deposit(depositParams<true>({ token: SUI_NATIVE, raw: true }));

    expect(before.to).toBe(expectedTransferTarget);
    expect(after.to).toBe(`${upgraded}::${SUI_ASSET_MGR_MOD}::transfer`);
    expect(after.data).toContain(`${upgraded}::${SUI_ASSET_MGR_MOD}::transfer`);
  });

  it('builds the signed path through the freshly resolved package too', async () => {
    const upgraded = `0x${'8'.repeat(64)}`;
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValueOnce(upgraded);
    (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_DIGEST);

    await suiSpoke.deposit(depositParams<false>({ token: SUI_NATIVE, raw: false, walletProvider: mockSuiProvider }));

    const [signed] = (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mock.calls[0] as [Transaction];
    expect(signed.serialize()).toContain(`${upgraded}::${SUI_ASSET_MGR_MOD}::transfer`);
  });
});

// =========================================================================
// 12. sendMessage — raw vs walletProvider, dstChainKey-driven relay id
// =========================================================================

describe('SuiSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof SUI, Raw>>,
  ): SendMessageParams<typeof SUI, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SUI,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockSuiProvider,
      ...overrides,
    }) as SendMessageParams<typeof SUI, Raw>;

  const expectedConnectionTarget = `${SUI_CONN_PKG}::${SUI_CONN_MOD}::send_message_ua`;

  it('raw=true → rawTx targets <connection>::send_message_ua with value=0n', async () => {
    const result = await suiSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(expectedConnectionTarget);
    expect(result.value).toBe(0n);
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
    // The raw data must round-trip through Transaction.from() — the consume path used for signing
    // and gas estimation. Guards the "Unknown value 6 for enum TransactionKind" regression.
    expect(() => Transaction.from(result.data)).not.toThrow();
  });

  it('raw=false → delegates to walletProvider.signAndExecuteTxn and returns its digest', async () => {
    (mockSuiProvider.signAndExecuteTxn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_DIGEST);

    const result = await suiSpoke.sendMessage(
      sendMessageParams<false>({ raw: false, walletProvider: mockSuiProvider }),
    );

    expect(result).toBe(TX_DIGEST);
    expect(mockSuiProvider.signAndExecuteTxn).toHaveBeenCalledWith(expect.any(Transaction));
  });

  it('Sonic dst pins getIntentRelayChainId(SONIC) === 146n', () => {
    // Defensive guard against the relay-id table drifting; the rawTx data field is base64-opaque
    // so we pin the table value directly rather than decoding bytes.
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 13. estimateGas — devInspect → effects.gasUsed (struct, not bigint)
// =========================================================================

describe('SuiSpokeService.estimateGas', () => {
  it('returns the gasUsed struct from the simulated effects', async () => {
    // Serialize a real Transaction to the @mysten/sui JSON so Transaction.from(tx.data) succeeds locally.
    const realTx = new Transaction();
    realTx.setSender(SRC_ADDR);
    const txJson = realTx.serialize();

    const gasUsed = {
      computationCost: '1000',
      storageCost: '2000',
      storageRebate: '500',
      nonRefundableStorageFee: '100',
    };
    const spy = vi.spyOn(suiSpoke.transport, 'estimateGas').mockResolvedValueOnce(gasUsed);

    const result = await suiSpoke.estimateGas({
      chainKey: SUI,
      tx: { from: SRC_ADDR, to: expectedTransferStub(), value: 0n, data: txJson },
    });

    expect(result).toBe(gasUsed);
    // sender must come from tx.from — proves the SUT threads tx.from into the simulation.
    expect(spy).toHaveBeenCalledWith(expect.any(Transaction), SRC_ADDR);
  });
});

// Helper for the estimateGas test — the `to` field on the raw tx is unused by the SUT's gas
// estimation but the type system requires a string. Using a real-shaped Move type string keeps
// the fixture honest.
function expectedTransferStub(): string {
  return `${SUI_ASSET_MGR_PKG}::${SUI_ASSET_MGR_MOD}::transfer`;
}

// =========================================================================
// 14. getDeposit — viewContract delegation + BCS U64 decode + malformed-result branches
// =========================================================================

describe('SuiSpokeService.getDeposit', () => {
  // `bcs.U64.serialize(N).toBytes()` produces the same on-wire bytes the SUT consumes via
  // `bcs.U64.parse(Uint8Array.from(val))` — avoids endianness drift.
  const makeBalanceResult = (balance: bigint): SuiExecutionResult => ({
    returnValues: [[Array.from(bcs.U64.serialize(balance).toBytes()), '']],
  });

  it('decodes a BCS-U64 balance from the simulation result', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce(makeBalanceResult(7_500n));

    const result = await suiSpoke.getDeposit({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: SUI_BNUSD,
    });

    expect(result).toBe(7_500n);
  });

  it('handles a zero balance', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce(makeBalanceResult(0n));

    const result = await suiSpoke.getDeposit({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: SUI_BNUSD,
    });

    expect(result).toBe(0n);
  });

  it('throws when returnValues is missing', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce({});

    await expect(suiSpoke.getDeposit({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: SUI_BNUSD })).rejects.toThrow(
      'Failed to get Balance',
    );
  });

  it('throws when returnValues[0] is not an array', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce({
      returnValues: ['not-an-array'],
    } as unknown as SuiExecutionResult);

    await expect(suiSpoke.getDeposit({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: SUI_BNUSD })).rejects.toThrow(
      'Failed to get Balance',
    );
  });

  it('throws when returnValues[0][0] is undefined', async () => {
    vi.spyOn(suiSpoke.transport, 'fetchLatestPackageId').mockResolvedValue(SUI_ASSET_MGR_PKG);
    vi.spyOn(suiSpoke.transport, 'simulate').mockResolvedValueOnce({
      returnValues: [[undefined, '']],
    } as unknown as SuiExecutionResult);

    await expect(suiSpoke.getDeposit({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: SUI_BNUSD })).rejects.toThrow(
      'Failed to get Balance',
    );
  });
});

// =========================================================================
// 15. getWalletBalance / getWalletBalances — the USER's own coins
// =========================================================================

describe('SuiSpokeService.getWalletBalance', () => {
  // REAL config tokens — the coinType strings the SUT must map are exactly these.
  const SUI_TOKEN = suiConfig.supportedTokens.SUI;
  const USDC_TOKEN = suiConfig.supportedTokens.USDC;
  const LEGACY_BNUSD_TOKEN = suiConfig.supportedTokens.legacybnUSD;

  // The coinType the Sui fullnode actually indexes for legacy bnUSD: the config package id carries
  // a leading zero the on-chain type does not. Pinned as a literal, not derived from config, so a
  // config-side address change surfaces here instead of silently following the SUT's stale remap.
  const LEGACY_BNUSD_ONCHAIN =
    '0x3917a812fe4a6d6bc779c5ab53f8a80ba741f8af04121193fc44e0f662e2ceb::balanced_dollar::BALANCED_DOLLAR';

  it('queries the canonical short 0x2::sui::SUI coinType for the native coin', async () => {
    const spy = vi
      .spyOn(suiSpoke.transport, 'getCoins')
      .mockResolvedValueOnce(makeCoinsPage([{ balance: '1234', coinObjectId: '0xa' }], '0x2::sui::SUI'));

    const result = await suiSpoke.getWalletBalance({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: SUI_TOKEN,
    });

    expect(result).toBe(1_234n);
    // Config stores the zero-padded 32-byte form; the fullnode only indexes the short form, so the
    // normalisation is what makes the native read return anything but zero.
    expect(SUI_TOKEN.address).toBe(SUI_NATIVE);
    expect(spy).toHaveBeenCalledWith(SRC_ADDR, '0x2::sui::SUI', undefined, undefined);
  });

  it('remaps legacy bnUSD to the on-chain coinType that drops the package-id leading zero', async () => {
    const spy = vi
      .spyOn(suiSpoke.transport, 'getCoins')
      .mockResolvedValueOnce(makeCoinsPage([{ balance: '4321', coinObjectId: '0xa' }], LEGACY_BNUSD_ONCHAIN));

    const result = await suiSpoke.getWalletBalance({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: LEGACY_BNUSD_TOKEN,
    });

    expect(result).toBe(4_321n);
    expect(spy).toHaveBeenCalledWith(SRC_ADDR, LEGACY_BNUSD_ONCHAIN, undefined, undefined);
  });

  it('passes a plain non-native coinType through unchanged, owned by the user', async () => {
    const spy = vi
      .spyOn(suiSpoke.transport, 'getCoins')
      .mockResolvedValueOnce(makeCoinsPage([{ balance: '5000', coinObjectId: '0xa' }], USDC_TOKEN.address));

    const result = await suiSpoke.getWalletBalance({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      token: USDC_TOKEN,
    });

    expect(result).toBe(5_000n);
    // Owner is srcAddress (the user), NOT the asset manager — the key difference from getDeposit.
    expect(spy).toHaveBeenCalledWith(SRC_ADDR, USDC_TOKEN.address, undefined, undefined);
  });

  it('sums balance across every coin object on one page', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(
      makeCoinsPage(
        [
          { balance: '1000', coinObjectId: '0xa' },
          { balance: '2000', coinObjectId: '0xb' },
          { balance: '3000', coinObjectId: '0xc' },
        ],
        USDC_TOKEN.address,
      ),
    );

    await expect(
      suiSpoke.getWalletBalance({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: USDC_TOKEN }),
    ).resolves.toBe(6_000n);
  });

  it('pages through the fullnode until hasNextPage is false, summing every page', async () => {
    const spy = vi
      .spyOn(suiSpoke.transport, 'getCoins')
      .mockResolvedValueOnce({
        data: [{ coinType: USDC_TOKEN.address, coinObjectId: '0xa', version: '1', digest: 'd1', balance: '1000' }],
        hasNextPage: true,
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce(makeCoinsPage([{ balance: '2500', coinObjectId: '0xb' }], USDC_TOKEN.address));

    const result = await suiSpoke.getWalletBalance({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: USDC_TOKEN });

    expect(result).toBe(3_500n);
    expect(spy).toHaveBeenNthCalledWith(1, SRC_ADDR, USDC_TOKEN.address, undefined, undefined);
    expect(spy).toHaveBeenNthCalledWith(2, SRC_ADDR, USDC_TOKEN.address, undefined, 'cursor-1');
  });

  it('returns 0n only for a balance the fullnode confirmed as zero (no coin objects)', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockResolvedValueOnce(makeCoinsPage([], USDC_TOKEN.address));

    await expect(
      suiSpoke.getWalletBalance({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: USDC_TOKEN }),
    ).resolves.toBe(0n);
  });

  it('rejects rather than reporting zero when the fullnode read fails', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockRejectedValueOnce(new Error('HTTP 429'));

    await expect(
      suiSpoke.getWalletBalance({ srcChainKey: SUI, srcAddress: SRC_ADDR, token: USDC_TOKEN }),
    ).rejects.toThrow('HTTP 429');
  });
});

describe('SuiSpokeService.getWalletBalances', () => {
  const SUI_TOKEN = suiConfig.supportedTokens.SUI;
  const USDC_TOKEN = suiConfig.supportedTokens.USDC;
  const BNUSD_TOKEN = suiConfig.supportedTokens.bnUSD;

  const byCoinType =
    (balances: Record<string, string>) =>
    (_owner: string, coinType?: string | null): ReturnType<SuiTransport['getCoins']> => {
      const total = coinType ? balances[coinType] : undefined;
      if (total === undefined) return Promise.reject(new Error(`unexpected coinType=${coinType}`));
      return Promise.resolve(makeCoinsPage([{ balance: total, coinObjectId: '0xa' }], coinType as string));
    };

  it('keys each balance by the config token.address, not by the queried coinType', async () => {
    vi.spyOn(suiSpoke.transport, 'getCoins').mockImplementation(
      byCoinType({
        // native is queried as the short form, but keyed by the padded config address
        '0x2::sui::SUI': '100',
        [BNUSD_TOKEN.address]: '200',
        [USDC_TOKEN.address]: '300',
      }),
    );

    const result = await suiSpoke.getWalletBalances({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      tokens: [SUI_TOKEN, BNUSD_TOKEN, USDC_TOKEN],
    });

    expect(result).toEqual({
      [SUI_TOKEN.address]: 100n,
      [BNUSD_TOKEN.address]: 200n,
      [USDC_TOKEN.address]: 300n,
    });
  });

  it('reports a failing token as 0n via the logger and keeps the rest', async () => {
    // A flat map cannot carry the failure, so the SDK logger is the only channel an integrator has
    // to tell a fabricated 0n apart from a real empty balance — assert it actually fired.
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');
    const rpcError = new Error('HTTP 429');
    vi.spyOn(suiSpoke.transport, 'getCoins').mockImplementation((owner, coinType) =>
      coinType === BNUSD_TOKEN.address
        ? Promise.reject(rpcError)
        : byCoinType({ '0x2::sui::SUI': '100', [USDC_TOKEN.address]: '300' })(owner, coinType),
    );

    const result = await suiSpoke.getWalletBalances({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      tokens: [SUI_TOKEN, BNUSD_TOKEN, USDC_TOKEN],
    });

    expect(result[SUI_TOKEN.address]).toBe(100n);
    expect(result[USDC_TOKEN.address]).toBe(300n);
    expect(result[BNUSD_TOKEN.address]).toBe(0n);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: SUI, token: BNUSD_TOKEN.address, error: rpcError.message }),
    );
  });

  it('rejects when every token in a non-empty batch fails', async () => {
    // An all-zero map from a dead fullnode is indistinguishable from an empty wallet, so the
    // collector refuses to return one.
    vi.spyOn(suiSpoke.transport, 'getCoins').mockRejectedValue(new Error('HTTP 503'));

    await expect(
      suiSpoke.getWalletBalances({
        srcChainKey: SUI,
        srcAddress: SRC_ADDR,
        tokens: [SUI_TOKEN, BNUSD_TOKEN, USDC_TOKEN],
      }),
    ).rejects.toThrow(`every balance read failed on ${SUI}`);
  });

  it('treats a fullnode-confirmed 0n as a successful read, not a failure', async () => {
    // The all-failed guard keys off read outcomes, not values: a wallet empty on every token must
    // still resolve, and must log nothing.
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');
    vi.spyOn(suiSpoke.transport, 'getCoins').mockImplementation(
      byCoinType({ [BNUSD_TOKEN.address]: '0', [USDC_TOKEN.address]: '0' }),
    );

    const result = await suiSpoke.getWalletBalances({
      srcChainKey: SUI,
      srcAddress: SRC_ADDR,
      tokens: [BNUSD_TOKEN, USDC_TOKEN],
    });

    expect(result).toEqual({ [BNUSD_TOKEN.address]: 0n, [USDC_TOKEN.address]: 0n });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns an empty map for an empty token list without touching the fullnode', async () => {
    // `attempted === 0` must not trip the all-failed guard.
    const spy = vi.spyOn(suiSpoke.transport, 'getCoins');

    const result = await suiSpoke.getWalletBalances({ srcChainKey: SUI, srcAddress: SRC_ADDR, tokens: [] });

    expect(result).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 16. waitForTransactionReceipt — every result branch + polling defaults
// =========================================================================

describe('SuiSpokeService.waitForTransactionReceipt', () => {
  it('maps a successful waitForTransaction result to status:success with the whole receipt', async () => {
    const fakeReceipt = {
      digest: TX_DIGEST,
      effects: { status: { status: 'success' } },
    };
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockResolvedValueOnce(fakeReceipt as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    expect(result.value.receipt).toBe(fakeReceipt);
  });

  it('returns status:failure when effects are missing entirely', async () => {
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockResolvedValueOnce({ digest: TX_DIGEST });

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error.message).toContain(`Transaction effects unavailable for digest=${TX_DIGEST}`);
  });

  it('returns status:failure when effects.status.status === "failure" with a known error', async () => {
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'failure', error: 'MoveAbort' } },
    } as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'failure') throw new Error('expected failure');
    expect(result.value.error.message).toBe('Transaction failed: MoveAbort');
  });

  it('falls back to "unknown" when effects.status.error is undefined (the `?? "unknown"` branch)', async () => {
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'failure' } },
    } as never);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok || result.value.status !== 'failure') throw new Error('expected ok+failure');
    expect(result.value.error.message).toBe('Transaction failed: unknown');
  });

  it('returns status:timeout when the transport aborts on the timeout signal', async () => {
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockRejectedValueOnce(timeoutErr);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error).toBe(timeoutErr);
  });

  it('returns status:failure for non-timeout Error throws', async () => {
    const otherErr = new Error('connection refused');
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockRejectedValueOnce(otherErr);

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBe(otherErr);
  });

  it('wraps non-Error throws into a new Error(String(thrown))', async () => {
    vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockRejectedValueOnce('boom');

    const result = await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('failure');
    if (result.value.status !== 'failure') return;
    expect(result.value.error).toBeInstanceOf(Error);
    expect(result.value.error.message).toBe('boom');
  });

  it('forwards real config-driven polling/timeout defaults when caller omits them', async () => {
    const spy = vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'success' } },
    } as never);

    await suiSpoke.waitForTransactionReceipt({ chainKey: SUI, txHash: TX_DIGEST });

    expect(spy).toHaveBeenCalledWith({
      digest: TX_DIGEST,
      // Pinned to the REAL suiConfig.pollingConfig values, not magic numbers — a config change
      // that drops or renames either field surfaces here.
      timeoutMs: SUI_TIMEOUT_MS,
      pollingIntervalMs: SUI_POLLING_MS,
    });
  });

  it('forwards custom pollingIntervalMs / maxTimeoutMs when caller provides them', async () => {
    const spy = vi.spyOn(suiSpoke.transport, 'waitForTransaction').mockResolvedValueOnce({
      digest: TX_DIGEST,
      effects: { status: { status: 'success' } },
    } as never);

    await suiSpoke.waitForTransactionReceipt({
      chainKey: SUI,
      txHash: TX_DIGEST,
      pollingIntervalMs: 123,
      maxTimeoutMs: 4_567,
    });

    expect(spy).toHaveBeenCalledWith({
      digest: TX_DIGEST,
      timeoutMs: 4_567,
      pollingIntervalMs: 123,
    });
  });
});
