/**
 * Tests for StellarSpokeService — the single Stellar spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (the canonical single-chain pattern). Stellar has one
 * chain (`ChainKeys.STELLAR_MAINNET`), so there is no `describe.each` parametrisation and no
 * cross-chain independence section. One Sodax instance backs every test; per-test spies hang off
 * `sodax.spoke.stellar.server` (Horizon) and `sodax.spoke.stellar.sorobanServer` (Soroban); they
 * are torn down by `vi.restoreAllMocks()` in `afterEach`.
 *
 * Horizon vs Soroban split — Stellar has two RPC surfaces and StellarSpokeService consumes both:
 *   - `server`        is a `Horizon.Server` used for trustline reads (`accounts().accountId().call()`)
 *                     and account loading (`loadAccount`).
 *   - `sorobanServer` is the custom Soroban RPC (`CustomSorobanServer`, extending `rpc.Server`)
 *                     used for `simulateTransaction`, `sendTransaction`, `getTransaction`, and
 *                     `getNetwork`. All contract calls (balance reads, deposits, sendMessage) flow
 *                     through this client.
 * Each spy targets the correct surface so a regression that swaps Horizon <-> Soroban surfaces here.
 *
 * Real config data is sourced from `spokeChainConfig[STELLAR_MAINNET]` for every infrastructure
 * value — addresses, RPC URLs, polling intervals, fees, trustline configs. Only user identities
 * (`SRC_ADDR`, `HUB_WALLET`, `DST_ADDR`) and per-test scratch (`TX_HASH`) are fabricated. This
 * catches a class of regressions where a hardcoded value happens to match a test fixture but
 * diverges from production config.
 *
 * `@stellar/stellar-sdk` is NOT module-mocked: real `TransactionBuilder`, `Contract`, `Address`,
 * `nativeToScVal`, and the `rpc.Api.isSimulation*` type guards run. The type guards are
 * "shape-based" — `isSimulationSuccess` checks for the presence of `"transactionData"`,
 * `isSimulationRestore` additionally requires `restorePreamble.transactionData`. Test fixtures
 * construct minimal simulation objects matching those shapes so the real guards return the
 * expected branch. `sleep` from `../../utils/shared-utils.js` IS mocked to a no-op so the
 * `waitForTransactionReceipt` polling loop completes synchronously.
 *
 * Section organization:
 *   1. constructor                          — method surface, server/sorobanServer wiring, fees
 *   2. CustomStellarAccount                 — bare class smoke test
 *   3. getBalance                           — sorobanServer.simulateTransaction happy + error
 *   4. buildPriorityStellarTransaction      — happy path returns [tx, sim]; error throws
 *   5. buildDepositCall                     — pure construction, pins 'transfer' contract call
 *   6. buildSendMessageCall                 — pure construction, pins 'send_message' + relay id
 *   7. sendMessage                          — raw vs walletProvider, error wrapping
 *   8. deposit                              — raw vs walletProvider, error wrapping
 *   9. estimateGas                          — simulate-from-XDR, happy + error
 *  10. getDeposit                           — delegates to getBalance, BigInt coercion
 *  11. hasSufficientTrustline               — native/legacy bypass, missing config, insufficient,
 *                                             sufficient
 *  12. requestTrustline                     — missing config, raw, walletProvider
 *  13. submitOrRestoreAndRetry              — simulation failure, restore path, no-restore path
 *  14. signAndSendTransaction               — wallet sign + send, waitForTransaction toggle,
 *                                             ERROR status
 *  15. getAddressBCSBytes / getTsWalletBytes — pure static helpers
 *  16. waitForTransactionReceipt            — SUCCESS / FAILED / NOT_FOUND / transient throw /
 *                                             custom polling overrides
 *  17. getWalletBalance                    — the USER's holdings: spendable-XLM reserve math on
 *                                             Horizon, Soroban `balance` simulation otherwise
 *  18. getWalletBalances                   — native/Soroban partition, plain per-token balances,
 *                                             the fetch-once-per-batch pin, shared account sequence
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  Address as StellarAddress,
  Contract,
  type FeeBumpTransaction,
  Networks,
  SorobanDataBuilder,
  type Transaction,
  TransactionBuilder,
  nativeToScVal,
  type rpc,
  scValToBigInt,
  type xdr as stellarXdr,
} from '@stellar/stellar-sdk';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Hex,
  type IStellarWalletProvider,
} from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------
//
// `sleep` is replaced with a no-op so the `waitForTransactionReceipt` polling loop completes
// synchronously across the NOT_FOUND / transient-throw branches. Every other export from
// `shared-utils.js` (notably `parseToStroops`, used by `hasSufficientTrustline`) keeps its real
// implementation via `vi.importActual`.

vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return {
    ...actual,
    sleep: vi.fn(() => Promise.resolve()),
  };
});

import { Sodax } from '../../entities/Sodax.js';
import { CustomStellarAccount, StellarSpokeService } from './StellarSpokeService.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const stellarSpoke = sodax.spoke.stellar;

const STELLAR = ChainKeys.STELLAR_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)

// REAL config — every consumer of these values in production reads from the same source.
const stellarConfig = spokeChainConfig[STELLAR];
const STELLAR_NATIVE = stellarConfig.nativeToken;
const STELLAR_BNUSD = stellarConfig.bnUSD;
const STELLAR_USDC = stellarConfig.supportedTokens.USDC.address;
const STELLAR_LEGACY_BNUSD = stellarConfig.supportedTokens.legacybnUSD.address;
const STELLAR_CONNECTION = stellarConfig.addresses.connection;
const STELLAR_ASSET_MGR = stellarConfig.addresses.assetManager;
const STELLAR_HORIZON_URL = stellarConfig.horizonRpcUrl;
const STELLAR_SOROBAN_URL = stellarConfig.sorobanRpcUrl;
const STELLAR_POLLING_MS = stellarConfig.pollingConfig.pollingIntervalMs;
const STELLAR_TIMEOUT_MS = stellarConfig.pollingConfig.maxTimeoutMs;
const STELLAR_PRIORITY_FEE = stellarConfig.priorityFee;
const STELLAR_BASE_FEE = stellarConfig.baseFee;
const STELLAR_TRUSTLINE_USDC = stellarConfig.trustlineConfigs.find(t => t.contractId === STELLAR_USDC);
if (!STELLAR_TRUSTLINE_USDC) throw new Error('test setup: USDC trustline config missing');

// Whole XToken records — `getWalletBalance`/`getWalletBalances` take the token, not its address,
// and pick the native branch by comparing `token.address` against `nativeToken`. Taken from real
// config: a synthesised address would classify itself and prove nothing about production input.
const XLM_TOKEN = stellarConfig.supportedTokens.XLM;
const USDC_TOKEN = stellarConfig.supportedTokens.USDC;
const BNUSD_TOKEN = stellarConfig.supportedTokens.bnUSD;
const SODA_TOKEN = stellarConfig.supportedTokens.SODA;

// Per-user / per-flow scratch — these have no config source. Stellar G-addresses are 56-char
// base32 strkeys with a CRC checksum, so we can't just generate "all A's". These two are real
// asset-issuer keys from the trustline config (publicly visible on the Stellar network) — they
// are valid strkeys, which is the only property we need them for (Address.fromString and
// new Account() both validate the checksum).
// Deliberate cast: GetAddressType<'stellar…'> is declared as Hex in @sodax/types, but real Stellar
// addresses are G… strkeys and the service consumes them as such at runtime (see buildDepositCall
// pinning StellarAddress.fromScAddress(...) back to this exact strkey).
const SRC_ADDR = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' as unknown as Hex;
const OTHER_ADDR = 'GDYUTHY75A7WUZJQDPOP66FB32BOYGZRXHWTWO4Q6LQTANT5X3V5HNFA';
const HUB_WALLET = '0x2222222222222222222222222222222222222222' as const;
const DST_ADDR = '0x3333333333333333333333333333333333333333' as const;
const TX_HASH = 'a'.repeat(64);

const NETWORK_PASSPHRASE = Networks.PUBLIC;
const NETWORK_RESPONSE: rpc.Api.GetNetworkResponse = {
  passphrase: NETWORK_PASSPHRASE,
  protocolVersion: '22',
};

const mockStellarProvider = {
  chainType: 'STELLAR',
  signTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as IStellarWalletProvider;

// --- simulation-response factories ---------------------------------------
//
// `isSimulationSuccess` checks for the presence of `transactionData`; `isSimulationRestore` also
// requires `restorePreamble.transactionData`. The factories below produce minimal objects with
// the correct shape so the real type guards branch as expected.
//
// `SorobanDataBuilder()` with no args yields a default-empty builder, which is sufficient — we
// never round-trip the soroban data back through the wire, so the inner XDR contents don't
// matter for any branch the SUT exercises.

const makeSorobanDataBuilder = (): SorobanDataBuilder => new SorobanDataBuilder();

const makeSimSuccess = (retval?: stellarXdr.ScVal): rpc.Api.SimulateTransactionSuccessResponse =>
  ({
    id: '1',
    latestLedger: 1,
    events: [],
    _parsed: true,
    transactionData: makeSorobanDataBuilder(),
    minResourceFee: '500',
    result: retval ? { auth: [], retval } : undefined,
  }) as unknown as rpc.Api.SimulateTransactionSuccessResponse;

const makeSimError = (errorMessage = 'simulation failed'): rpc.Api.SimulateTransactionErrorResponse =>
  ({
    id: '1',
    latestLedger: 1,
    events: [],
    _parsed: true,
    error: errorMessage,
  }) as unknown as rpc.Api.SimulateTransactionErrorResponse;

const makeSimRestore = (): rpc.Api.SimulateTransactionRestoreResponse =>
  ({
    ...makeSimSuccess(nativeToScVal(0n, { type: 'u128' })),
    restorePreamble: {
      minResourceFee: '200',
      transactionData: makeSorobanDataBuilder(),
    },
  }) as unknown as rpc.Api.SimulateTransactionRestoreResponse;

// `loadAccount` returns an object shaped like `AccountResponse`; `CustomStellarAccount` only
// reads `account_id` and `sequence`. The cast through `as never` papers over the ~30 unused
// Horizon fields.
const makeAccountResponse = (accountId: string, sequence = '100'): never =>
  ({ account_id: accountId, sequence }) as never;

const ACCOUNT_SEQUENCE = '100';

// `sorobanServer.getAccount` returns an `Account`; the spendable-balance path only calls
// `accountId()` and `sequenceNumber()` on it.
const makeSorobanAccount = (sequence = ACCOUNT_SEQUENCE): never =>
  ({ accountId: () => SRC_ADDR, sequenceNumber: () => sequence }) as never;

/**
 * Horizon `loadAccount` response for the spendable-XLM math: only the fields the reserve formula
 * reads are populated. The non-native balance line is always present so a regression that picks
 * the wrong line (or the first line) instead of `asset_type === 'native'` surfaces here.
 */
const makeHorizonAccount = (opts: {
  balance?: string;
  sellingLiabilities?: string;
  subentryCount?: number;
  numSponsoring?: number;
  numSponsored?: number;
  withNativeLine?: boolean;
}): never =>
  ({
    account_id: SRC_ADDR,
    sequence: ACCOUNT_SEQUENCE,
    subentry_count: opts.subentryCount ?? 0,
    num_sponsoring: opts.numSponsoring ?? 0,
    num_sponsored: opts.numSponsored ?? 0,
    balances: [
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '5.0000000' },
      ...(opts.withNativeLine === false
        ? []
        : [
            {
              asset_type: 'native',
              balance: opts.balance ?? '0.0000000',
              buying_liabilities: '0.0000000',
              selling_liabilities: opts.sellingLiabilities ?? '0.0000000',
            },
          ]),
    ],
  }) as never;

const asTransaction = (tx: Transaction | FeeBumpTransaction | undefined): Transaction => {
  // `'operations' in tx` is a runtime guard only: FeeBumpTransaction declares the property too, so
  // TypeScript cannot narrow the union from it.
  if (!tx || !('operations' in tx)) throw new Error('test setup: expected a simulated Transaction');
  return tx as Transaction;
};

const decodeContractCall = (tx: Transaction): stellarXdr.InvokeContractArgs => {
  const [operation] = tx.operations;
  if (!operation || operation.type !== 'invokeHostFunction') {
    throw new Error('test setup: expected an invokeHostFunction operation');
  }
  return operation.func.invokeContract();
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 1. constructor — method surface + server/sorobanServer wiring
// =========================================================================

describe('StellarSpokeService — constructor', () => {
  it('exposes the spoke instance on sodax.spoke.stellar with the expected method surface', () => {
    expect(stellarSpoke).toBeInstanceOf(StellarSpokeService);
    expect(typeof stellarSpoke.getBalance).toBe('function');
    expect(typeof stellarSpoke.buildPriorityStellarTransaction).toBe('function');
    expect(typeof stellarSpoke.buildDepositCall).toBe('function');
    expect(typeof stellarSpoke.buildSendMessageCall).toBe('function');
    expect(typeof stellarSpoke.sendMessage).toBe('function');
    expect(typeof stellarSpoke.signAndSendTransaction).toBe('function');
    expect(typeof stellarSpoke.submitOrRestoreAndRetry).toBe('function');
    expect(typeof stellarSpoke.deposit).toBe('function');
    expect(typeof stellarSpoke.hasSufficientTrustline).toBe('function');
    expect(typeof stellarSpoke.requestTrustline).toBe('function');
    expect(typeof stellarSpoke.estimateGas).toBe('function');
    expect(typeof stellarSpoke.getDeposit).toBe('function');
    expect(typeof stellarSpoke.waitForTransactionReceipt).toBe('function');
  });

  it('wires both Horizon `server` and Soroban `sorobanServer` with consumer-facing methods', () => {
    expect(stellarSpoke.server).toBeDefined();
    expect(typeof stellarSpoke.server.loadAccount).toBe('function');
    expect(typeof stellarSpoke.server.accounts).toBe('function');

    expect(stellarSpoke.sorobanServer).toBeDefined();
    expect(typeof stellarSpoke.sorobanServer.simulateTransaction).toBe('function');
    expect(typeof stellarSpoke.sorobanServer.sendTransaction).toBe('function');
    expect(typeof stellarSpoke.sorobanServer.getTransaction).toBe('function');
    expect(typeof stellarSpoke.sorobanServer.getNetwork).toBe('function');
  });

  it('points the servers at the URLs from spokeChainConfig (catches a regression that hardcodes a URL)', () => {
    // The underlying URL is buried but `serverURL` is documented on `rpc.Server`. Compare hosts
    // because the SDK normalises trailing slashes etc.
    expect(stellarSpoke.sorobanServer.serverURL.toString()).toContain(new URL(STELLAR_SOROBAN_URL).host);
    // `Horizon.Server` exposes the URL via `serverURL` too (also a URL object).
    const horizonUrl = stellarSpoke.server.serverURL;
    expect(horizonUrl.toString()).toContain(new URL(STELLAR_HORIZON_URL).host);
  });
});

// =========================================================================
// 2. CustomStellarAccount — bare class smoke test
// =========================================================================

describe('CustomStellarAccount', () => {
  it('exposes accountId and starting sequence number', () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '42' });
    expect(account.getAccountId()).toBe(SRC_ADDR);
    expect(account.getSequenceNumber()).toBe(42n);
    expect(account.getStartingSequenceNumber()).toBe(42n);
  });

  it('incrementSequenceNumber advances the running counter while leaving the start intact', () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '42' });
    account.incrementSequenceNumber();
    account.incrementSequenceNumber();
    expect(account.getSequenceNumber()).toBe(44n);
    expect(account.getStartingSequenceNumber()).toBe(42n);
  });

  it('resetSequenceNumber returns the running counter to the starting value', () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '42' });
    account.incrementSequenceNumber();
    account.incrementSequenceNumber();
    account.resetSequenceNumber();
    expect(account.getSequenceNumber()).toBe(42n);
  });

  it('getAccountClone produces an Account at the current running sequence', () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '42' });
    account.incrementSequenceNumber();
    const clone = account.getAccountClone();
    expect(clone.accountId()).toBe(SRC_ADDR);
    // `Account.sequenceNumber()` reports the stored value; the SUT instantiates via
    // `new Account(..., this.sequenceNumber.toString())`, so the clone reports the bumped value.
    expect(clone.sequenceNumber()).toBe('43');
  });

  it('decrementSequenceNumber steps the running counter back without throwing when above the start', () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '42' });
    account.incrementSequenceNumber();
    expect(() => account.decrementSequenceNumber()).not.toThrow();
    expect(account.getSequenceNumber()).toBe(42n);
  });

  it('decrementSequenceNumber throws at the starting sequence (cannot go below the start)', () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '42' });
    expect(() => account.decrementSequenceNumber()).toThrow(/cannot be decremented below the starting sequence number/);
    // sequence is unchanged after the rejected decrement
    expect(account.getSequenceNumber()).toBe(42n);
  });
});

// =========================================================================
// 3. getBalance — Soroban simulateTransaction happy / failure / missing retval
// =========================================================================

describe('StellarSpokeService.getBalance', () => {
  const stubAccount = () => ({
    accountId: () => SRC_ADDR,
    sequenceNumber: () => '100',
    incrementSequenceNumber: () => undefined,
  });

  it('returns the decoded bigint as a Number on a successful simulation with retval', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValueOnce(stubAccount());
    const retval = nativeToScVal(7_500n, { type: 'u128' });
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimSuccess(retval));

    const balance = await stellarSpoke.getBalance({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      token: STELLAR_BNUSD,
    });

    expect(balance).toBe(Number(scValToBigInt(retval)));
    expect(balance).toBe(7_500);
  });

  it('throws "Failed to simulate transaction" when the simulation is not a success', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValueOnce(stubAccount());
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimError('boom'));

    await expect(
      stellarSpoke.getBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: STELLAR_BNUSD }),
    ).rejects.toThrow('Failed to simulate transaction');
  });

  it('throws "result undefined" when the simulation succeeds but carries no retval', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValueOnce(stubAccount());
    // Success shape without `result` — the SUT's `if (resultValue)` falls through to the throw.
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimSuccess(undefined));

    await expect(
      stellarSpoke.getBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: STELLAR_BNUSD }),
    ).rejects.toThrow('result undefined');
  });
});

// =========================================================================
// 4. buildPriorityStellarTransaction — happy + first-simulation-failure
// =========================================================================

describe('StellarSpokeService.buildPriorityStellarTransaction', () => {
  const buildOperation = () =>
    new Contract(STELLAR_ASSET_MGR).call(
      'transfer',
      nativeToScVal(StellarAddress.fromString(SRC_ADDR), { type: 'address' }),
    );

  it('returns [transaction, simulation] after both simulations succeed', async () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '100' });
    const operation = buildOperation();
    const firstSim = makeSimSuccess(nativeToScVal(0n, { type: 'u128' }));
    const secondSim = makeSimSuccess(nativeToScVal(0n, { type: 'u128' }));
    const simSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValueOnce(firstSim)
      .mockResolvedValueOnce(secondSim);

    const [tx, sim] = await stellarSpoke.buildPriorityStellarTransaction(account, NETWORK_RESPONSE, operation);

    expect(simSpy).toHaveBeenCalledTimes(2);
    expect(sim).toBe(secondSim);
    // The returned transaction was built with the priority fee — pin the fee against the
    // expected sum (minResourceFee + priorityFee + baseFee) to catch a refactor that drops one
    // of the addends.
    const expectedFee = (
      BigInt(firstSim.minResourceFee) +
      BigInt(STELLAR_PRIORITY_FEE) +
      BigInt(STELLAR_BASE_FEE)
    ).toString();
    expect(tx.fee).toBe(expectedFee);
  });

  it('throws "Simulation error: ..." when the first simulation fails', async () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '100' });
    const operation = buildOperation();
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimError('first sim error'));

    await expect(stellarSpoke.buildPriorityStellarTransaction(account, NETWORK_RESPONSE, operation)).rejects.toThrow(
      /^Simulation error:/,
    );
  });
});

// =========================================================================
// 5. buildDepositCall — pure construction; pins 'transfer' contract call signature
// =========================================================================

describe('StellarSpokeService.buildDepositCall', () => {
  it("constructs an InvokeHostFunction op targeting the asset manager's `transfer`", () => {
    const op = stellarSpoke.buildDepositCall<true>({
      srcAddress: SRC_ADDR,
      srcChainKey: STELLAR,
      to: HUB_WALLET,
      token: STELLAR_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: true,
    });

    // `Contract.call` always produces an InvokeHostFunction op; the function name is encoded
    // inside the host function args.
    const hostFn = op.body().invokeHostFunctionOp().hostFunction();
    expect(hostFn.switch().name).toBe('hostFunctionTypeInvokeContract');
    const invokeArgs = hostFn.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('transfer');
    // First two args are user address + token address (as ScAddress); pin them via fromScAddress.
    const args = invokeArgs.args();
    expect(args.length).toBe(5);
    expect(StellarAddress.fromScAddress(args[0]!.address()).toString()).toBe(SRC_ADDR);
    expect(StellarAddress.fromScAddress(args[1]!.address()).toString()).toBe(STELLAR_BNUSD);
  });
});

// =========================================================================
// 6. buildSendMessageCall — pure construction; pins 'send_message' + relay id (146n for Sonic)
// =========================================================================

describe('StellarSpokeService.buildSendMessageCall', () => {
  it("constructs an InvokeHostFunction op targeting the connection contract's `send_message`", () => {
    const op = stellarSpoke.buildSendMessageCall<true>({
      srcAddress: SRC_ADDR,
      srcChainKey: STELLAR,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: true,
    });

    const hostFn = op.body().invokeHostFunctionOp().hostFunction();
    expect(hostFn.switch().name).toBe('hostFunctionTypeInvokeContract');
    const invokeArgs = hostFn.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('send_message');
    // Target contract is the Stellar connection address from config (NOT assetManager — that
    // distinction surfaces as a regression if the wrong address is used).
    expect(StellarAddress.fromScAddress(invokeArgs.contractAddress()).toString()).toBe(STELLAR_CONNECTION);
  });

  it('encodes the Sonic intent relay id as 146n', () => {
    // Defensive: if the chain key → relay id table drifts, the encoded send_message arg would
    // silently change. Pinned here directly because the contract-call args are not easy to
    // decode back to a JS bigint without an extra ScVal helper.
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
  });
});

// =========================================================================
// 7. sendMessage — raw vs walletProvider
// =========================================================================

describe('StellarSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof STELLAR, Raw>>,
  ): SendMessageParams<typeof STELLAR, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: STELLAR,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockStellarProvider,
      ...overrides,
    }) as SendMessageParams<typeof STELLAR, Raw>;

  it('raw=true → returns rawTx with `to` set to the asset manager (NOT connection) and value=0n', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(makeAccountResponse(SRC_ADDR));
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })))
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })));

    const result = await stellarSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    // NOTE: sendMessage's rawTx `to` is the assetManager, not the connection contract. This is
    // a v1-inherited oddity (the operation targets `connection.send_message` but the rawTx field
    // is filled from `addresses.assetManager`). Pin it so a "clean up to use the actual target"
    // refactor surfaces here.
    expect(result.to).toBe(STELLAR_ASSET_MGR);
    expect(result.value).toBe(0n);
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
    // The raw XDR must be a fully-assembled, parseable transaction (footprint + resource fees).
    // Guards the original `txMalformed` regression where the unassembled tx was returned.
    expect(() => TransactionBuilder.fromXDR(result.data, NETWORK_PASSPHRASE)).not.toThrow();
  });

  it('raw=false → delegates through submitOrRestoreAndRetry to walletProvider.signTransaction + sorobanServer.sendTransaction', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(makeAccountResponse(SRC_ADDR));
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      // first two: buildPriorityStellarTransaction's fee + final sim
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })))
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })));
    // walletProvider.signTransaction is called with the assembled tx XDR; return the input XDR
    // (the SUT only feeds it back into TransactionBuilder.fromXDR for re-broadcasting).
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    const sendSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'sendTransaction')
      .mockResolvedValueOnce({ status: 'PENDING', hash: TX_HASH } as never);
    // signAndSendTransaction calls waitForTransactionReceipt with waitForTransaction=true.
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValueOnce({
      status: 'SUCCESS',
    } as never);

    const result = await stellarSpoke.sendMessage(
      sendMessageParams<false>({ raw: false, walletProvider: mockStellarProvider }),
    );

    expect(result).toBe(TX_HASH);
    expect(mockStellarProvider.signTransaction).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 8. deposit — raw vs walletProvider
// =========================================================================

describe('StellarSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof STELLAR, Raw>>,
  ): DepositParams<typeof STELLAR, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: STELLAR,
      to: HUB_WALLET,
      token: STELLAR_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockStellarProvider,
      ...overrides,
    }) as DepositParams<typeof STELLAR, Raw>;

  it('raw=true → returns rawTx with `to` set to the asset manager and value=BigInt(amount)', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(makeAccountResponse(SRC_ADDR));
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })))
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })));

    const result = await stellarSpoke.deposit(depositParams<true>({ raw: true, amount: 1_000n }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(STELLAR_ASSET_MGR);
    expect(result.value).toBe(1_000n);
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
    // The raw XDR must be a fully-assembled, parseable transaction (footprint + resource fees).
    // Guards the original `txMalformed` regression where the unassembled tx was returned.
    expect(() => TransactionBuilder.fromXDR(result.data, NETWORK_PASSPHRASE)).not.toThrow();
  });

  it('raw=false → delegates through submitOrRestoreAndRetry and returns the hash', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(makeAccountResponse(SRC_ADDR));
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })))
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'u128' })));
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    vi.spyOn(stellarSpoke.sorobanServer, 'sendTransaction').mockResolvedValueOnce({
      status: 'PENDING',
      hash: TX_HASH,
    } as never);
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValueOnce({
      status: 'SUCCESS',
    } as never);

    const result = await stellarSpoke.deposit(
      depositParams<false>({ raw: false, walletProvider: mockStellarProvider }),
    );

    expect(result).toBe(TX_HASH);
    expect(mockStellarProvider.signTransaction).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 9. estimateGas — builds tx from XDR, simulates, returns BigInt(minResourceFee)
// =========================================================================

describe('StellarSpokeService.estimateGas', () => {
  // Build a tiny real XDR string so TransactionBuilder.fromXDR can parse it.
  const realTxXdr = (() => {
    return new TransactionBuilder(new Account(SRC_ADDR, '100'), {
      fee: STELLAR_BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(STELLAR_ASSET_MGR).call(
          'transfer',
          nativeToScVal(StellarAddress.fromString(SRC_ADDR), { type: 'address' }),
        ),
      )
      .setTimeout(60)
      .build()
      .toXDR();
  })();

  it('returns BigInt(minResourceFee) on a successful simulation', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    const sim = makeSimSuccess(nativeToScVal(0n, { type: 'u128' }));
    sim.minResourceFee = '12345';
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(sim);

    const result = await stellarSpoke.estimateGas({
      chainKey: STELLAR,
      tx: { from: SRC_ADDR, to: STELLAR_ASSET_MGR, value: 0n, data: realTxXdr },
    });

    expect(result).toBe(12_345n);
  });

  it('throws "Simulation error: ..." when the simulation fails', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimError('bad simulation'));

    await expect(
      stellarSpoke.estimateGas({
        chainKey: STELLAR,
        tx: { from: SRC_ADDR, to: STELLAR_ASSET_MGR, value: 0n, data: realTxXdr },
      }),
    ).rejects.toThrow(/^Simulation error:/);
  });
});

// =========================================================================
// 10. getDeposit — delegates to getBalance + BigInt() coercion
// =========================================================================

describe('StellarSpokeService.getDeposit', () => {
  it('returns BigInt(getBalance(...)) — proves the coercion from number to bigint', async () => {
    vi.spyOn(stellarSpoke, 'getBalance').mockResolvedValueOnce(7_500);

    const result = await stellarSpoke.getDeposit({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      token: STELLAR_BNUSD,
    });

    expect(result).toBe(7_500n);
    expect(typeof result).toBe('bigint');
  });
});

// =========================================================================
// 11. hasSufficientTrustline — bypass paths + lookup + insufficient/sufficient branches
// =========================================================================

describe('StellarSpokeService.hasSufficientTrustline', () => {
  it('native token short-circuits to true (no trustline needed for XLM)', async () => {
    const result = await stellarSpoke.hasSufficientTrustline(STELLAR_NATIVE, 1_000n, SRC_ADDR);
    expect(result).toBe(true);
  });

  it('legacy bnUSD short-circuits to true (no Horizon trustline needed)', async () => {
    const result = await stellarSpoke.hasSufficientTrustline(STELLAR_LEGACY_BNUSD, 1_000n, SRC_ADDR);
    expect(result).toBe(true);
  });

  it('case-insensitive match — lowercased nativeToken address still short-circuits to true', async () => {
    // Both sides of the comparison are .toLowerCase()'d. A regression dropping that guard would
    // silently re-route XLM through the Horizon lookup branch.
    const result = await stellarSpoke.hasSufficientTrustline(STELLAR_NATIVE.toLowerCase(), 1_000n, SRC_ADDR);
    expect(result).toBe(true);
  });

  it('throws when no trustline config exists for the requested token', async () => {
    await expect(
      stellarSpoke.hasSufficientTrustline(
        'CDOESNOTEXIST00000000000000000000000000000000000000000000',
        1_000n,
        SRC_ADDR,
      ),
    ).rejects.toThrow(/Trustline config not found for token/);
  });

  it('returns false when the user has no balance line for the asset', async () => {
    vi.spyOn(stellarSpoke.server, 'accounts').mockReturnValueOnce({
      accountId: () => ({
        call: vi.fn().mockResolvedValueOnce({ balances: [] }),
      }),
    } as never);

    const result = await stellarSpoke.hasSufficientTrustline(STELLAR_USDC, 1_000n, SRC_ADDR);
    expect(result).toBe(false);
  });

  it('returns false when (limit - balance) is less than the requested amount', async () => {
    // limit=10 stroops, balance=9 stroops → available ~1 stroop; asked for 100 stroops.
    vi.spyOn(stellarSpoke.server, 'accounts').mockReturnValueOnce({
      accountId: () => ({
        call: vi.fn().mockResolvedValueOnce({
          balances: [
            {
              limit: '0.0000010',
              balance: '0.0000009',
              asset_code: STELLAR_TRUSTLINE_USDC.assetCode,
              asset_issuer: STELLAR_TRUSTLINE_USDC.assetIssuer,
            },
          ],
        }),
      }),
    } as never);

    const result = await stellarSpoke.hasSufficientTrustline(STELLAR_USDC, 100n, SRC_ADDR);
    expect(result).toBe(false);
  });

  it('returns true when (limit - balance) >= the requested amount', async () => {
    // limit=1000 XLM = 10_000_000_000 stroops; balance=0 → all of it available.
    vi.spyOn(stellarSpoke.server, 'accounts').mockReturnValueOnce({
      accountId: () => ({
        call: vi.fn().mockResolvedValueOnce({
          balances: [
            {
              limit: '1000.0000000',
              balance: '0.0000000',
              asset_code: STELLAR_TRUSTLINE_USDC.assetCode,
              asset_issuer: STELLAR_TRUSTLINE_USDC.assetIssuer,
            },
          ],
        }),
      }),
    } as never);

    const result = await stellarSpoke.hasSufficientTrustline(STELLAR_USDC, 100n, SRC_ADDR);
    expect(result).toBe(true);
  });
});

// =========================================================================
// 12. requestTrustline — missing config + raw + walletProvider
// =========================================================================

describe('StellarSpokeService.requestTrustline', () => {
  it('throws when the asset is not in trustlineConfigs', async () => {
    await expect(
      stellarSpoke.requestTrustline({
        srcAddress: SRC_ADDR,
        srcChainKey: STELLAR,
        token: 'CDOESNOTEXIST00000000000000000000000000000000000000000000',
        amount: 1_000n,
        raw: true,
      }),
    ).rejects.toThrow(/not found. Cannot proceed with trustline/);
  });

  it('raw=true → returns rawTx targeting the asset manager with value=amount and XDR data', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(makeAccountResponse(SRC_ADDR));

    const result = await stellarSpoke.requestTrustline<true>({
      srcAddress: SRC_ADDR,
      srcChainKey: STELLAR,
      token: STELLAR_USDC,
      amount: 5_000n,
      raw: true,
    });

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(STELLAR_ASSET_MGR);
    expect(result.value).toBe(5_000n);
    expect(typeof result.data).toBe('string');
    expect(result.data.length).toBeGreaterThan(0);
    // changeTrust is a classic operation (no Soroban assembly), but the raw XDR must still be a
    // valid, parseable transaction envelope.
    expect(() => TransactionBuilder.fromXDR(result.data, NETWORK_PASSPHRASE)).not.toThrow();
  });

  it('raw=false → delegates to signAndSendTransaction and returns the hash', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(makeAccountResponse(SRC_ADDR));
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    vi.spyOn(stellarSpoke.sorobanServer, 'sendTransaction').mockResolvedValueOnce({
      status: 'PENDING',
      hash: TX_HASH,
    } as never);
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValueOnce({
      status: 'SUCCESS',
    } as never);

    const result = await stellarSpoke.requestTrustline({
      srcAddress: SRC_ADDR,
      srcChainKey: STELLAR,
      token: STELLAR_USDC,
      amount: 5_000n,
      raw: false,
      walletProvider: mockStellarProvider,
    });

    expect(result).toBe(TX_HASH);
    expect(mockStellarProvider.signTransaction).toHaveBeenCalledTimes(1);
  });
});

// =========================================================================
// 13. submitOrRestoreAndRetry — simulation-failure / no-restore / restore-then-resend
// =========================================================================

describe('StellarSpokeService.submitOrRestoreAndRetry', () => {
  const buildOperation = () =>
    new Contract(STELLAR_ASSET_MGR).call(
      'transfer',
      nativeToScVal(StellarAddress.fromString(SRC_ADDR), { type: 'address' }),
    );

  const buildTx = () =>
    new TransactionBuilder(new Account(SRC_ADDR, '100'), {
      fee: STELLAR_BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(buildOperation())
      .setTimeout(60)
      .build();

  it('throws when the (provided) simulation is a failure', async () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '100' });
    await expect(
      stellarSpoke.submitOrRestoreAndRetry(
        mockStellarProvider,
        account,
        NETWORK_RESPONSE,
        buildTx(),
        buildOperation(),
        makeSimError('boom'),
      ),
    ).rejects.toThrow(/Simulation Failed/);
  });

  it('no-restore path: signs and sends the original tx, returning the send hash', async () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '100' });
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    const sendSpy = vi.spyOn(stellarSpoke.sorobanServer, 'sendTransaction').mockResolvedValueOnce({
      status: 'PENDING',
      hash: TX_HASH,
    } as never);
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValueOnce({
      status: 'SUCCESS',
    } as never);

    const hash = await stellarSpoke.submitOrRestoreAndRetry(
      mockStellarProvider,
      account,
      NETWORK_RESPONSE,
      buildTx(),
      buildOperation(),
      makeSimSuccess(nativeToScVal(0n, { type: 'u128' })),
    );

    expect(hash).toBe(TX_HASH);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('restore path: runs the restore tx, then re-signs and sends the original op with bumped sequence', async () => {
    const account = new CustomStellarAccount({ account_id: SRC_ADDR, sequence: '100' });
    const restoreHash = 'b'.repeat(64);
    // signAndSendTransaction is called twice: once for the restore tx, once for the resend.
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    const sendSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'sendTransaction')
      .mockResolvedValueOnce({ status: 'PENDING', hash: restoreHash } as never)
      .mockResolvedValueOnce({ status: 'PENDING', hash: TX_HASH } as never);
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction')
      .mockResolvedValueOnce({ status: 'SUCCESS' } as never)
      .mockResolvedValueOnce({ status: 'SUCCESS' } as never);

    const hash = await stellarSpoke.submitOrRestoreAndRetry(
      mockStellarProvider,
      account,
      NETWORK_RESPONSE,
      buildTx(),
      buildOperation(),
      makeSimRestore(),
    );

    // Final returned hash is the resend hash, NOT the restore hash.
    expect(hash).toBe(TX_HASH);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    // signTransaction also called twice (restore + resend).
    expect(mockStellarProvider.signTransaction).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// 14. signAndSendTransaction — sign + send + (optional) wait + ERROR-status throw
// =========================================================================

describe('StellarSpokeService.signAndSendTransaction', () => {
  const buildTx = () =>
    new TransactionBuilder(new Account(SRC_ADDR, '100'), {
      fee: STELLAR_BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(STELLAR_ASSET_MGR).call(
          'transfer',
          nativeToScVal(StellarAddress.fromString(SRC_ADDR), { type: 'address' }),
        ),
      )
      .setTimeout(60)
      .build();

  it('waitForTransaction=true: signs, sends, calls getTransaction, returns the hash on SUCCESS', async () => {
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    const sendSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'sendTransaction')
      .mockResolvedValueOnce({ status: 'PENDING', hash: TX_HASH } as never);
    const getSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'getTransaction')
      .mockResolvedValueOnce({ status: 'SUCCESS' } as never);

    const hash = await stellarSpoke.signAndSendTransaction(mockStellarProvider, buildTx(), true);

    expect(hash).toBe(TX_HASH);
    expect(mockStellarProvider.signTransaction).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('waitForTransaction=false: returns the hash without polling getTransaction', async () => {
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    vi.spyOn(stellarSpoke.sorobanServer, 'sendTransaction').mockResolvedValueOnce({
      status: 'PENDING',
      hash: TX_HASH,
    } as never);
    const getSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction');

    const hash = await stellarSpoke.signAndSendTransaction(mockStellarProvider, buildTx(), false);

    expect(hash).toBe(TX_HASH);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('throws (stringified response) when sendTransaction returns status=ERROR', async () => {
    (mockStellarProvider.signTransaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (xdrStr: string) => xdrStr,
    );
    vi.spyOn(stellarSpoke.sorobanServer, 'sendTransaction').mockResolvedValueOnce({
      status: 'ERROR',
      hash: TX_HASH,
      errorResult: 'BAD',
    } as never);

    await expect(stellarSpoke.signAndSendTransaction(mockStellarProvider, buildTx(), false)).rejects.toThrow(
      /"status": "ERROR"/,
    );
  });
});

// =========================================================================
// 15. getAddressBCSBytes / getTsWalletBytes — pure static helpers
// =========================================================================

describe('StellarSpokeService static helpers', () => {
  it('getAddressBCSBytes returns 0x-prefixed hex of the ScVal XDR encoding', () => {
    const bytes = StellarSpokeService.getAddressBCSBytes(SRC_ADDR);
    expect(bytes.startsWith('0x')).toBe(true);
    expect(bytes.length).toBeGreaterThan(2);
    // round-trip — encoding the same address twice must produce the same bytes.
    expect(StellarSpokeService.getAddressBCSBytes(SRC_ADDR)).toBe(bytes);
    // different addresses produce different bytes.
    expect(StellarSpokeService.getAddressBCSBytes(OTHER_ADDR)).not.toBe(bytes);
  });

  it('getTsWalletBytes converts a hex-encoded payload to 0x-prefixed hex', () => {
    // The helper accepts a hex-string-without-prefix and `toHex(Buffer.from(s, 'hex'))`'s it.
    const result = StellarSpokeService.getTsWalletBytes('deadbeef');
    expect(result).toBe('0xdeadbeef');
  });
});

// =========================================================================
// 16. waitForTransactionReceipt — SUCCESS / FAILED / NOT_FOUND / transient / custom polling
// =========================================================================

describe('StellarSpokeService.waitForTransactionReceipt', () => {
  it('SUCCESS: returns status:success with the raw receipt', async () => {
    const receipt = { status: 'SUCCESS', latestLedger: 1 };
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValueOnce(receipt as never);

    const result = await stellarSpoke.waitForTransactionReceipt({ chainKey: STELLAR, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    expect(result.value.receipt).toBe(receipt);
  });

  it('FAILED: returns status:failure with a stringified-receipt Error', async () => {
    const receipt = { status: 'FAILED', latestLedger: 1, applicationOrder: 1 };
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValueOnce(receipt as never);

    const result = await stellarSpoke.waitForTransactionReceipt({ chainKey: STELLAR, txHash: TX_HASH });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'failure') throw new Error('expected failure');
    expect(result.value.error.message).toContain('Transaction failed');
    expect(result.value.error.message).toContain('FAILED');
  });

  it('NOT_FOUND repeatedly: exhausts the polling budget and returns status:timeout', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction').mockResolvedValue({ status: 'NOT_FOUND' } as never);

    const result = await stellarSpoke.waitForTransactionReceipt({
      chainKey: STELLAR,
      txHash: TX_HASH,
      pollingIntervalMs: 50,
      maxTimeoutMs: 100,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error.message).toContain('was not confirmed within');
  });

  it('transient throw → eventually resolves: catch swallows the throw, polling continues, SUCCESS returns', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getTransaction')
      .mockRejectedValueOnce(new Error('transient network blip'))
      .mockResolvedValueOnce({ status: 'SUCCESS', latestLedger: 1 } as never);

    const result = await stellarSpoke.waitForTransactionReceipt({
      chainKey: STELLAR,
      txHash: TX_HASH,
      pollingIntervalMs: 10,
      maxTimeoutMs: 1_000,
    });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect((result.value.receipt as { status: string }).status).toBe('SUCCESS');
  });

  it('uses real config-driven polling defaults when caller omits them (catches a regression in fallback wiring)', async () => {
    // We can't directly observe the SDK-internal polling interval — it's just numbers fed to a
    // for-loop. What we CAN observe is the number of `getTransaction` calls before timeout, which
    // is `round(maxTimeoutMs / pollingIntervalMs)`. Pin that against the real config to surface a
    // regression that hardcodes the defaults.
    const expectedCalls = Math.round(STELLAR_TIMEOUT_MS / STELLAR_POLLING_MS);
    const getSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'getTransaction')
      .mockResolvedValue({ status: 'NOT_FOUND' } as never);

    const result = await stellarSpoke.waitForTransactionReceipt({ chainKey: STELLAR, txHash: TX_HASH });

    if (!result.ok || result.value.status !== 'timeout') throw new Error('expected ok+timeout');
    expect(getSpy).toHaveBeenCalledTimes(expectedCalls);
  });

  it('custom polling overrides defaults: maxAttempts == round(maxTimeoutMs / pollingIntervalMs)', async () => {
    const getSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'getTransaction')
      .mockResolvedValue({ status: 'NOT_FOUND' } as never);

    await stellarSpoke.waitForTransactionReceipt({
      chainKey: STELLAR,
      txHash: TX_HASH,
      pollingIntervalMs: 10,
      maxTimeoutMs: 50,
    });

    // 50 / 10 = 5 attempts.
    expect(getSpy).toHaveBeenCalledTimes(5);
  });
});

// =========================================================================
// 17. getWalletBalance — the USER's own holdings
//
// Contrast with sections 3/10: `getBalance`/`getDeposit` read the asset manager's holding, this
// reads `srcAddress`'s. Native XLM goes through Horizon and reports the SPENDABLE amount — the
// raw balance minus the minimum reserve `(2 + subentry_count + num_sponsoring - num_sponsored)
// * 0.5 XLM` and minus selling liabilities — because the network refuses to release the rest.
// Every other token is a Soroban `balance` simulation.
// =========================================================================

describe('StellarSpokeService.getWalletBalance', () => {
  it('treats the config XLM token as native (the whole native branch hangs off this identity)', () => {
    expect(XLM_TOKEN.address).toBe(STELLAR_NATIVE);
    expect(USDC_TOKEN.address).not.toBe(STELLAR_NATIVE);
  });

  it('native XLM: parses the decimal Horizon balance to stroops and subtracts the 2-slot base reserve', async () => {
    const loadSpy = vi
      .spyOn(stellarSpoke.server, 'loadAccount')
      .mockResolvedValueOnce(makeHorizonAccount({ balance: '198.8944970' }));
    const networkSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork');
    const accountSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getAccount');

    const result = await stellarSpoke.getWalletBalance({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      token: XLM_TOKEN,
    });

    // 198.8944970 XLM = 1_988_944_970 stroops, less the 2 * 0.5 XLM account reserve.
    expect(result).toBe(1_978_944_970n);
    // The user's account, not the asset manager's — the difference from getBalance/getDeposit.
    expect(loadSpy).toHaveBeenCalledWith(SRC_ADDR);
    // Native resolves entirely on Horizon; a Soroban round-trip here would be pure latency.
    expect(networkSpy).not.toHaveBeenCalled();
    expect(accountSpy).not.toHaveBeenCalled();
  });

  it('subtracts selling liabilities on top of the reserve (offers already commit those stroops)', async () => {
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(
      makeHorizonAccount({ balance: '198.8944970', sellingLiabilities: '1.5000000' }),
    );

    const result = await stellarSpoke.getWalletBalance({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      token: XLM_TOKEN,
    });

    // 1_988_944_970 - 10_000_000 (reserve) - 15_000_000 (liabilities)
    expect(result).toBe(1_963_944_970n);
  });

  it('counts subentries and sponsorships in the reserve, but not sponsored reserves', async () => {
    const load = vi.spyOn(stellarSpoke.server, 'loadAccount');
    const read = () =>
      stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: XLM_TOKEN });

    load.mockResolvedValueOnce(
      makeHorizonAccount({ balance: '198.8944970', subentryCount: 3, numSponsoring: 1, numSponsored: 0 }),
    );
    // (2 + 3 + 1) slots * 0.5 XLM = 30_000_000 stroops
    expect(await read()).toBe(1_958_944_970n);

    load.mockResolvedValueOnce(
      makeHorizonAccount({ balance: '198.8944970', subentryCount: 3, numSponsoring: 1, numSponsored: 2 }),
    );
    // The two sponsored reserves are funded by the sponsor, so they free 2 * 0.5 XLM for the user.
    expect(await read()).toBe(1_968_944_970n);
  });

  it('floors the reserve at zero when more reserves are sponsored than the account owes', async () => {
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(
      makeHorizonAccount({ balance: '1.0000000', numSponsored: 5 }),
    );

    // 2 + 0 + 0 - 5 is negative; a signed reserve would inflate the balance above what exists.
    expect(
      await stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: XLM_TOKEN }),
    ).toBe(10_000_000n);
  });

  it('clamps to 0n when the reserve meets or exceeds the balance', async () => {
    const load = vi.spyOn(stellarSpoke.server, 'loadAccount');
    const read = () =>
      stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: XLM_TOKEN });

    load.mockResolvedValueOnce(makeHorizonAccount({ balance: '0.5000000' }));
    expect(await read()).toBe(0n);

    // Exactly at the reserve: nothing is spendable, and the amount must not go negative.
    load.mockResolvedValueOnce(makeHorizonAccount({ balance: '1.0000000' }));
    expect(await read()).toBe(0n);
  });

  it('returns 0n when the account carries no native balance line', async () => {
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockResolvedValueOnce(
      makeHorizonAccount({ withNativeLine: false }),
    );

    expect(
      await stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: XLM_TOKEN }),
    ).toBe(0n);
  });

  it('rejects instead of reporting a zero when Horizon fails on the native path', async () => {
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockRejectedValueOnce(new Error('Horizon 503'));

    await expect(
      stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: XLM_TOKEN }),
    ).rejects.toThrow('Horizon 503');
  });

  it('non-native token: simulates the token contract `balance` with the user as the holder', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValueOnce(makeSorobanAccount());
    const simSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(4_200n, { type: 'i128' })));
    const loadSpy = vi.spyOn(stellarSpoke.server, 'loadAccount');

    const result = await stellarSpoke.getWalletBalance({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      token: USDC_TOKEN,
    });

    expect(result).toBe(4_200n);
    expect(loadSpy).not.toHaveBeenCalled();

    const call = decodeContractCall(asTransaction(simSpy.mock.calls[0]?.[0]));
    expect(call.functionName().toString()).toBe('balance');
    // The token contract itself is the callee, not the asset manager.
    expect(StellarAddress.fromScAddress(call.contractAddress()).toString()).toBe(USDC_TOKEN.address);
    const [holder] = call.args();
    if (!holder) throw new Error('expected a holder argument');
    // The holder is the user; getBalance passes the same argument for the asset manager instead.
    expect(StellarAddress.fromScAddress(holder.address()).toString()).toBe(SRC_ADDR);
  });

  it('rejects when the Soroban simulation is not a success (a failed read is never a zero)', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValueOnce(makeSorobanAccount());
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimError('boom'));

    await expect(
      stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: USDC_TOKEN }),
    ).rejects.toThrow('Failed to simulate transaction');
  });

  it('rejects when a successful simulation carries no retval, rather than fabricating 0n', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValueOnce(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValueOnce(makeSorobanAccount());
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValueOnce(makeSimSuccess(undefined));

    // `0n` means a confirmed on-chain zero, so a malformed read must not produce one.
    await expect(
      stellarSpoke.getWalletBalance({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, token: USDC_TOKEN }),
    ).rejects.toThrow('simulation returned no result');
  });
});

// =========================================================================
// 18. getWalletBalances — plain balances keyed by token address
//
// The network passphrase and the source account are identical for every token in a batch, so the
// batch fetches them once; an all-native request must not fetch them at all.
//
// A token that cannot be read collapses into the same `0n` an empty wallet produces, so the SDK
// logger is the only surviving signal for a failure — every failure case below asserts the warn
// line too. The one distinction the flat map cannot express safely is "nothing was read at all",
// which throws instead.
// =========================================================================

describe('StellarSpokeService.getWalletBalances', () => {
  const SOROBAN_TOKENS = [USDC_TOKEN, BNUSD_TOKEN, SODA_TOKEN];

  it('fetches the network and the source account exactly once for a 3-token Soroban batch', async () => {
    const networkSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValue(NETWORK_RESPONSE);
    const accountSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValue(makeSorobanAccount());
    const simSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValue(makeSimSuccess(nativeToScVal(11n, { type: 'i128' })));

    const result = await stellarSpoke.getWalletBalances({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      tokens: SOROBAN_TOKENS,
    });

    expect(Object.keys(result)).toHaveLength(3);
    // One simulation per token, but only one passphrase + account round-trip for the whole batch.
    expect(simSpy).toHaveBeenCalledTimes(3);
    expect(networkSpy).toHaveBeenCalledTimes(1);
    expect(accountSpy).toHaveBeenCalledTimes(1);
  });

  it('issues no Soroban calls at all when every requested token is native', async () => {
    const loadSpy = vi
      .spyOn(stellarSpoke.server, 'loadAccount')
      .mockResolvedValueOnce(makeHorizonAccount({ balance: '3.0000000' }));
    const networkSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork');
    const accountSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getAccount');

    const result = await stellarSpoke.getWalletBalances({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      tokens: [XLM_TOKEN],
    });

    expect(result).toEqual({ [XLM_TOKEN.address]: 20_000_000n });
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(networkSpy).not.toHaveBeenCalled();
    expect(accountSpy).not.toHaveBeenCalled();
  });

  it('gives every per-token builder its own Account clone, so all three transactions share one sequence', async () => {
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValue(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValue(makeSorobanAccount());
    const simSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValue(makeSimSuccess(nativeToScVal(1n, { type: 'i128' })));

    await stellarSpoke.getWalletBalances({ srcChainKey: STELLAR, srcAddress: SRC_ADDR, tokens: SOROBAN_TOKENS });

    // `build()` bumps its source account, so a shared Account would hand the concurrent builders
    // interleaved sequences; each clone starts from the fetched sequence instead.
    const expectedSequence = (BigInt(ACCOUNT_SEQUENCE) + 1n).toString();
    const sequences = simSpy.mock.calls.map(([tx]) => asTransaction(tx).sequence);
    expect(sequences).toEqual([expectedSequence, expectedSequence, expectedSequence]);
    // ...and each simulation still targets its own token contract.
    const callees = simSpy.mock.calls.map(([tx]) =>
      StellarAddress.fromScAddress(decodeContractCall(asTransaction(tx)).contractAddress()).toString(),
    );
    expect(callees).toEqual(SOROBAN_TOKENS.map(token => token.address));
  });

  it('keys results by token address and isolates a failing token as a logged 0n', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValue(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValue(makeSorobanAccount());
    const rpcError = new Error('HTTP 429');
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(1_000n, { type: 'i128' })))
      .mockRejectedValueOnce(rpcError)
      .mockResolvedValueOnce(makeSimSuccess(nativeToScVal(0n, { type: 'i128' })));

    const result = await stellarSpoke.getWalletBalances({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      tokens: SOROBAN_TOKENS,
    });

    expect(result).toEqual({
      [USDC_TOKEN.address]: 1_000n,
      // The unread token renders as 0n, indistinguishable from the SODA entry below — which IS a
      // balance confirmed empty on chain. Only the warn line tells them apart.
      [BNUSD_TOKEN.address]: 0n,
      [SODA_TOKEN.address]: 0n,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: STELLAR, token: BNUSD_TOKEN.address, error: rpcError.message }),
    );
    // Exactly one line: the confirmed-empty SODA read must not log, or the signal is worthless.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('merges the shared Horizon native read with the Soroban results in one map', async () => {
    const loadSpy = vi
      .spyOn(stellarSpoke.server, 'loadAccount')
      .mockResolvedValueOnce(makeHorizonAccount({ balance: '198.8944970' }));
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValue(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValue(makeSorobanAccount());
    const simSpy = vi
      .spyOn(stellarSpoke.sorobanServer, 'simulateTransaction')
      .mockResolvedValue(makeSimSuccess(nativeToScVal(77n, { type: 'i128' })));

    const result = await stellarSpoke.getWalletBalances({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      tokens: [XLM_TOKEN, USDC_TOKEN],
    });

    expect(result).toEqual({
      [XLM_TOKEN.address]: 1_978_944_970n,
      [USDC_TOKEN.address]: 77n,
    });
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(simSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a Horizon failure as a logged native 0n while the Soroban tokens resolve', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    const horizonError = new Error('Horizon 503');
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockRejectedValueOnce(horizonError);
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValue(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValue(makeSorobanAccount());
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockResolvedValue(
      makeSimSuccess(nativeToScVal(88n, { type: 'i128' })),
    );

    const result = await stellarSpoke.getWalletBalances({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      tokens: [XLM_TOKEN, USDC_TOKEN],
    });

    expect(result).toEqual({
      [XLM_TOKEN.address]: 0n,
      [USDC_TOKEN.address]: 88n,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: STELLAR, token: XLM_TOKEN.address, error: horizonError.message }),
    );
  });

  it('rejects when every token in the batch failed to read', async () => {
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn').mockImplementation(() => {});
    vi.spyOn(stellarSpoke.server, 'loadAccount').mockRejectedValueOnce(new Error('Horizon 503'));
    vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork').mockResolvedValue(NETWORK_RESPONSE);
    vi.spyOn(stellarSpoke.sorobanServer, 'getAccount').mockResolvedValue(makeSorobanAccount());
    vi.spyOn(stellarSpoke.sorobanServer, 'simulateTransaction').mockRejectedValue(new Error('HTTP 429'));

    // An all-zero map from a dead RPC would be indistinguishable from a genuinely empty wallet,
    // which is the one case the flat map cannot express — so the whole call throws instead.
    await expect(
      stellarSpoke.getWalletBalances({
        srcChainKey: STELLAR,
        srcAddress: SRC_ADDR,
        tokens: [XLM_TOKEN, USDC_TOKEN],
      }),
    ).rejects.toThrow(`every balance read failed on ${STELLAR}`);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('returns an empty map without touching either RPC surface when no tokens are requested', async () => {
    const loadSpy = vi.spyOn(stellarSpoke.server, 'loadAccount');
    const networkSpy = vi.spyOn(stellarSpoke.sorobanServer, 'getNetwork');

    const result = await stellarSpoke.getWalletBalances({
      srcChainKey: STELLAR,
      srcAddress: SRC_ADDR,
      tokens: [],
    });

    expect(result).toEqual({});
    expect(loadSpy).not.toHaveBeenCalled();
    expect(networkSpy).not.toHaveBeenCalled();
  });
});
