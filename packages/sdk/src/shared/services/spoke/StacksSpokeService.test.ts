/**
 * Tests for StacksSpokeService — the single Stacks spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (the canonical single-chain pattern). Stacks has one
 * chain (`ChainKeys.STACKS_MAINNET`), so there is no `describe.each` parametrisation, no per-chain
 * client cache, and no cross-chain independence section. One Sodax instance backs every test.
 *
 * Mocking strategy:
 *   1. `@stacks/transactions` static functions that touch the network are mocked at the module
 *      level via `vi.mock` + `vi.hoisted`. The mocked symbols are:
 *        - `fetchCallReadOnlyFunction`  — used by `readContract`, `readTokenBalance`, and
 *          `getImplContractAddress`.
 *        - `fetchFeeEstimateTransaction` — used by `estimateGas`.
 *        - `makeUnsignedContractCall`   — used by `deposit` and `sendMessage` in raw mode.
 *        - `serializePayloadBytes`      — used to turn an unsigned tx into the rawTx payload.
 *      All other exports (`Cl`, `noneCV`, `someCV`, `uintCV`, `PostConditionMode`,
 *      `parseContractId`, the Clarity type constructors, etc.) are pass-through via
 *      `vi.importActual` so payload-shape assertions can read real Clarity values.
 *   2. `fetch` is stubbed via `vi.stubGlobal` for `getSTXBalance` and `waitForTransactionReceipt`,
 *      which are the only methods that touch the Hiro REST API directly.
 *   3. `sleep` from `../../utils/shared-utils.js` is mocked to a no-op so `waitForTransactionReceipt`
 *      polling loops finish instantly. The rest of that module is `vi.importActual`-spread.
 *
 * Real config data is used wherever possible — every contract principal, RPC url, and polling
 * interval is sourced from `spokeChainConfig[STACKS_MAINNET]` rather than fake constants. That
 * catches a class of regressions where a hardcoded value happens to match a test fixture but
 * diverges from production config.
 *
 * Stacks-specific gotcha: `deposit` with `raw=true` builds the tx unsigned, so it needs the signer's
 * **public key** via `srcPublicKey` (the `SP…` address is a one-way hash of it); `srcAddress` stays
 * the real address. The raw guard derives the address from `srcPublicKey` and asserts it equals
 * `srcAddress`. Fixtures use a REAL compressed public key and its REAL derived mainnet address (the
 * crypto is not mocked — `getAddressFromPublicKey` passes through `vi.importActual`), so the happy path
 * matches; the guard tests feed a missing key, a mismatched address, and a non-key string.
 *
 * Section organization:
 *   2. estimateGas — fetchFeeEstimateTransaction pass-through
 *   3. readContract — fetchCallReadOnlyFunction pass-through
 *   4. getSTXBalance — fetch-based STX balance read, error branch
 *   5. readTokenBalance — parseContractId + fetchCallReadOnlyFunction + .value.value
 *   6. getImplContractAddress — readContract for `get-asset-manager-impl`
 *   7. deposit — native vs non-native, raw vs walletProvider, raw-mode invariant
 *   8. getDeposit — native via getSTXBalance, non-native via readTokenBalance
 *  8b. getWalletBalance / getWalletBalances — the USER's own holdings (contrast getDeposit)
 *   9. sendMessage — raw vs walletProvider, relay-id derivation
 *  10. waitForTransactionReceipt — every tx_status branch + polling defaults
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cl, Pc, type ContractPrincipalCV, type UIntCV } from '@sodax/libs/stacks/core';
import { ChainKeys, getIntentRelayChainId, spokeChainConfig, type Hex, type IStacksWalletProvider } from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------
//
// `vi.hoisted` lifts these `vi.fn()` shells above the `vi.mock` factory so the factory can return
// them. Tests then drive the mocks via `mocks.<name>.mockResolvedValueOnce(...)` etc.

const mocks = vi.hoisted(() => ({
  fetchCallReadOnlyFunction: vi.fn(),
  fetchFeeEstimateTransaction: vi.fn(),
  makeUnsignedContractCall: vi.fn(),
  serializePayloadBytes: vi.fn(),
}));

vi.mock('@sodax/libs/stacks/core', async () => {
  // Pass-through the rest of the module (real Cl, noneCV, someCV, uintCV, PostConditionMode,
  // parseContractId). Only the network-touching statics get replaced. The SUT imports from
  // `@sodax/libs/stacks/core` (a bundled re-export of `@stacks/transactions`) — mock the re-export
  // module the SUT actually sees, NOT the underlying package.
  const actual = await vi.importActual<typeof import('@sodax/libs/stacks/core')>('@sodax/libs/stacks/core');
  return {
    ...actual,
    fetchCallReadOnlyFunction: mocks.fetchCallReadOnlyFunction,
    fetchFeeEstimateTransaction: mocks.fetchFeeEstimateTransaction,
    makeUnsignedContractCall: mocks.makeUnsignedContractCall,
    serializePayloadBytes: mocks.serializePayloadBytes,
  };
});

// `sleep` is the only thing we need to silence in `waitForTransactionReceipt` so the polling loop
// finishes instantly — every other helper in the module is left untouched.
vi.mock('../../utils/shared-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/shared-utils.js')>('../../utils/shared-utils.js');
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { Sodax } from '../../entities/Sodax.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const stacksSpoke = sodax.spoke.stacks;

const STACKS = ChainKeys.STACKS_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)

// REAL config — every consumer of these values in production reads from the same source.
const stacksConfig = spokeChainConfig[STACKS];
const STACKS_NATIVE = stacksConfig.nativeToken;
const STACKS_BNUSD = stacksConfig.bnUSD;
const STACKS_ASSET_MGR = stacksConfig.addresses.assetManager;
const STACKS_RPC_URL = stacksConfig.rpcUrl;

// Asset-manager impl returned by `get-asset-manager-impl` — a different contract from the state
// contract above (state is `…asset-manager-state`, impl is `…asset-manager-impl-v1`).
const STACKS_ASSET_MGR_IMPL = 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0.asset-manager-impl-v1';

// Per-user / per-flow scratch — no config source.
// A real Stacks account: a compressed public key and the mainnet single-sig address it derives to, so the
// raw-deposit guard `getAddressFromPublicKey(srcPublicKey) === srcAddress` holds without mocking the crypto.
const SRC_PUBKEY = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
const SRC_ADDR = 'SP1D5PA98M0PF9Z4Q4N2CDTMTD7XSZ6GE7QQG5XBX';
// A different real mainnet address — used to exercise the pubkey↔address mismatch guard.
const OTHER_ADDR = 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR';
// 20-byte HUB destinations as 40-hex strings (Cl.bufferFromHex accepts them).
const HUB_WALLET: Hex = `0x${'22'.repeat(20)}`;
const DST_ADDR: Hex = `0x${'33'.repeat(20)}`;
const TX_ID = '0xabc1230000000000000000000000000000000000000000000000000000000000';

const mockStacksProvider = {
  chainType: 'STACKS',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  getPublicKey: vi.fn(),
  getBalance: vi.fn(),
} as unknown as IStacksWalletProvider;

// makeUnsignedContractCall returns an opaque object with a `.payload` field that we re-serialize.
// The SUT only reads `tx.payload` and passes it to `serializePayloadBytes`. Pin the shape; the
// content is opaque to the SUT.
const FAKE_PAYLOAD_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
const FAKE_PAYLOAD_HEX = '0xdeadbeef';
const fakeUnsignedTx = { payload: { type: 'contract-call', _opaque: true } };

beforeEach(() => {
  vi.clearAllMocks();
  // Restore mock default behaviour after `clearAllMocks` (which wipes implementations).
  mocks.makeUnsignedContractCall.mockResolvedValue(fakeUnsignedTx);
  mocks.serializePayloadBytes.mockReturnValue(FAKE_PAYLOAD_BYTES);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// =========================================================================
// 2. estimateGas — delegates to fetchFeeEstimateTransaction
// =========================================================================

describe('StacksSpokeService.estimateGas', () => {
  it('returns {low, medium, high} from the fetchFeeEstimateTransaction tuple', async () => {
    const low = { fee: 100, fee_rate: 1 };
    const medium = { fee: 200, fee_rate: 2 };
    const high = { fee: 300, fee_rate: 3 };
    mocks.fetchFeeEstimateTransaction.mockResolvedValueOnce([low, medium, high]);

    const result = await stacksSpoke.estimateGas({
      chainKey: STACKS,
      tx: { payload: '0xdeadbeef', estimatedLength: 256 },
    });

    expect(result).toEqual({ low, medium, high });
    // The SUT forwards `payload`, `estimatedLength`, and the constructor-bound `network` — pin
    // each so a regression that drops the estimatedLength surfaces here.
    expect(mocks.fetchFeeEstimateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: '0xdeadbeef',
        estimatedLength: 256,
        network: expect.objectContaining({ client: expect.objectContaining({ baseUrl: STACKS_RPC_URL }) }),
      }),
    );
  });
});

// =========================================================================
// 3. readContract — delegates to fetchCallReadOnlyFunction
// =========================================================================

describe('StacksSpokeService.readContract', () => {
  it('forwards contract/function fields and threads sender + network through', async () => {
    const fakeCV = Cl.uint(42);
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce(fakeCV);

    const result = await stacksSpoke.readContract(SRC_ADDR, {
      contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
      contractName: 'asset-manager-state',
      functionName: 'get-asset-manager-impl',
      functionArgs: [],
    });

    expect(result).toBe(fakeCV);
    expect(mocks.fetchCallReadOnlyFunction).toHaveBeenCalledWith({
      contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
      contractName: 'asset-manager-state',
      functionName: 'get-asset-manager-impl',
      functionArgs: [],
      network: expect.objectContaining({ client: expect.objectContaining({ baseUrl: STACKS_RPC_URL }) }),
      senderAddress: SRC_ADDR,
    });
  });
});

// =========================================================================
// 4. getSTXBalance — fetch-based STX balance read
// =========================================================================

describe('StacksSpokeService.getSTXBalance', () => {
  it('throws with the upstream statusText on a non-ok response, and a TypeError when `stx.balance` is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error' })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }),
    );

    await expect(stacksSpoke.getSTXBalance(SRC_ADDR)).rejects.toThrow(
      'Error fetching STX balance: Internal Server Error',
    );
    // `data.stx.balance` has no runtime guard; adding one is a contract change.
    await expect(stacksSpoke.getSTXBalance(SRC_ADDR)).rejects.toThrow(TypeError);
  });
});

// =========================================================================
// 5. readTokenBalance — parseContractId + fetchCallReadOnlyFunction
// =========================================================================

describe('StacksSpokeService.readTokenBalance', () => {
  it("parses the contract id, calls 'get-balance' with a principal arg, and unwraps .value.value", async () => {
    // The SUT casts the result to `{ value: UIntCV }`, then returns `.value.value`. The actual
    // shape returned by fetchCallReadOnlyFunction for `get-balance` is `(ok uint)` → a ResponseOk
    // wrapping a UInt — but the SUT reads it via the simpler `{ value: UIntCV }` cast.
    const fakeResponse = { value: { type: 1, value: 9_999n } };
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce(fakeResponse);

    const result = await stacksSpoke.readTokenBalance(STACKS_BNUSD, STACKS_ASSET_MGR);

    expect(result).toBe(9_999n);
    expect(mocks.fetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        // parseContractId splits 'SP….bnusd' into ['SP…', 'bnusd']. Pin both halves.
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'bnusd',
        functionName: 'get-balance',
        functionArgs: [Cl.principal(STACKS_ASSET_MGR)],
        senderAddress: STACKS_ASSET_MGR,
      }),
    );

    // No runtime guard on the `{ value: UIntCV }` cast: any other Clarity shape throws on the nested access.
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce({});

    await expect(stacksSpoke.readTokenBalance(STACKS_BNUSD, STACKS_ASSET_MGR)).rejects.toThrow();
  });
});

// =========================================================================
// 6. getImplContractAddress — readContract for `get-asset-manager-impl`
// =========================================================================

describe('StacksSpokeService.getImplContractAddress', () => {
  it('returns the inner .value of a ContractPrincipalCV from `get-asset-manager-impl`', async () => {
    const cpCv: ContractPrincipalCV = Cl.contractPrincipal(
      'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
      'asset-manager-impl-v1',
    );
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce(cpCv);

    const result = await stacksSpoke.getImplContractAddress(STACKS_ASSET_MGR);

    expect(result).toBe(STACKS_ASSET_MGR_IMPL);
    // Sender address is the state-contract principal itself (the SUT passes `contractAddress`
    // both as the contract caller AND as senderAddress — pin that detail).
    expect(mocks.fetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'asset-manager-state',
        functionName: 'get-asset-manager-impl',
        functionArgs: [],
        senderAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
      }),
    );

    // The cast trusts the current ABI: any response with a `.value` field "succeeds", principal or not.
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce({ type: 'string-ascii', value: 'not-a-contract-principal' });

    await expect(stacksSpoke.getImplContractAddress(STACKS_ASSET_MGR)).resolves.toBe('not-a-contract-principal');
  });
});

// =========================================================================
// 7. deposit — native vs non-native, raw vs walletProvider, raw-mode invariant
// =========================================================================

describe('StacksSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof STACKS, Raw>>,
  ): DepositParams<typeof STACKS, Raw> =>
    ({
      // raw-mode needs the signer public key via srcPublicKey; srcAddress is always the real Stacks address.
      srcAddress: SRC_ADDR,
      srcPublicKey: SRC_PUBKEY,
      srcChainKey: STACKS,
      to: HUB_WALLET,
      token: STACKS_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockStacksProvider,
      ...overrides,
    }) as DepositParams<typeof STACKS, Raw>;

  // First action in `deposit` is `this.getImplContractAddress(assetManager)`. We spy on the spoke
  // method directly so we don't have to thread the impl through fetchCallReadOnlyFunction in every
  // test — those branches are covered in section 6.
  beforeEach(() => {
    vi.spyOn(stacksSpoke, 'getImplContractAddress').mockResolvedValue(STACKS_ASSET_MGR_IMPL);
  });

  it('raw=true (non-native) → returns { payload: "0x<hex>" } with someCV(token), no interface fetch and no post-conditions', async () => {
    // Post-conditions cannot ride the serialized payload, so raw mode must not pay (or fail on)
    // the interface lookup they would need.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await stacksSpoke.deposit(depositParams<true>({ raw: true, token: STACKS_BNUSD }));

    expect(result).toEqual({ payload: FAKE_PAYLOAD_HEX });
    // makeUnsignedContractCall receives the impl-split contract address/name, the deposited
    // amount, and the bound network — pin all three.
    expect(mocks.makeUnsignedContractCall).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'asset-manager-impl-v1',
        functionName: 'transfer',
        publicKey: SRC_PUBKEY,
        fee: 0,
        nonce: 0n,
      }),
    );
    expect(mocks.serializePayloadBytes).toHaveBeenCalledWith(fakeUnsignedTx.payload);
    expect(fetchSpy).not.toHaveBeenCalled();

    const call = mocks.makeUnsignedContractCall.mock.calls[0]?.[0];
    expect(call?.postConditions).toBeUndefined();
    // The shape we pin: type === OptionalSome (i.e. someCV(...)) wrapping a principal whose
    // value is the deposited token id. ClarityType is a string-valued enum in @stacks/transactions
    // v7 — `'some'` is the literal value of `ClarityType.OptionalSome`.
    expect(call?.functionArgs?.[0]).toMatchObject({
      type: 'some',
      value: { value: STACKS_BNUSD },
    });
  });

  it('raw=true native (STX) → first functionArg is noneCV()', async () => {
    await stacksSpoke.deposit(depositParams<true>({ raw: true, token: STACKS_NATIVE }));

    const call = mocks.makeUnsignedContractCall.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    // ClarityType.OptionalNone === 'none' (string enum).
    expect(call?.functionArgs?.[0]).toMatchObject({ type: 'none' });
  });

  it('raw=true → throws before building when srcPublicKey is missing, derives another address, or is not a key', async () => {
    await expect(stacksSpoke.deposit(depositParams<true>({ srcPublicKey: undefined, raw: true }))).rejects.toThrow(
      'Stacks raw transactions require srcPublicKey',
    );
    // Otherwise the user signs a tx for an account other than the one hub-wallet derivation used.
    await expect(
      stacksSpoke.deposit(depositParams<true>({ srcPublicKey: SRC_PUBKEY, srcAddress: OTHER_ADDR, raw: true })),
    ).rejects.toThrow('does not match srcAddress');
    // A c32 address is not hex, so getAddressFromPublicKey fails to parse it — surfaced as a clean error.
    await expect(stacksSpoke.deposit(depositParams<true>({ srcPublicKey: SRC_ADDR, raw: true }))).rejects.toThrow(
      'not a valid Stacks public key',
    );
    expect(mocks.makeUnsignedContractCall).not.toHaveBeenCalled();
  });

  it('raw=false → delegates to walletProvider.sendTransaction and returns the txId', async () => {
    (mockStacksProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_ID);
    // getFtAssetName resolves the on-chain `define-fungible-token` name from the contract interface.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ fungible_tokens: [{ name: 'bnusd' }] }),
      }),
    );

    const result = await stacksSpoke.deposit(
      depositParams<false>({ raw: false, walletProvider: mockStacksProvider, token: STACKS_BNUSD }),
    );

    expect(result).toBe(TX_ID);
    // The reqData must carry the impl-split contract id, the transfer function name, and a
    // Deny-mode post-condition capping the caller's spend at `amount`.
    expect(mockStacksProvider.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'asset-manager-impl-v1',
        functionName: 'transfer',
        postConditionMode: 2, // PostConditionMode.Deny
        postConditions: [
          Pc.principal(SRC_ADDR)
            .willSendLte(1_000n)
            .ft(STACKS_BNUSD as `${string}.${string}`, 'bnusd'),
        ],
      }),
    );
    // raw=false must NOT call the unsigned-tx builder.
    expect(mocks.makeUnsignedContractCall).not.toHaveBeenCalled();
  });

  it('raw=false native STX → caps the spend with a ustx post-condition, no interface fetch', async () => {
    (mockStacksProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_ID);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await stacksSpoke.deposit(
      depositParams<false>({ raw: false, walletProvider: mockStacksProvider, token: STACKS_NATIVE }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockStacksProvider.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        postConditionMode: 2, // PostConditionMode.Deny
        postConditions: [Pc.principal(SRC_ADDR).willSendLte(1_000n).ustx()],
      }),
    );
  });

  it('raw=false multi-FT contract (sBTC shape) → one cap per declared fungible token', async () => {
    // sbtc-token really defines two FTs on mainnet; the unmoved one passes its cap at 0.
    const SBTC = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token' as const;
    (mockStacksProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_ID);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ fungible_tokens: [{ name: 'sbtc-token' }, { name: 'sbtc-token-locked' }] }),
      }),
    );

    await stacksSpoke.deposit(depositParams<false>({ raw: false, walletProvider: mockStacksProvider, token: SBTC }));

    expect(mockStacksProvider.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        postConditionMode: 2, // PostConditionMode.Deny
        postConditions: [
          Pc.principal(SRC_ADDR).willSendLte(1_000n).ft(SBTC, 'sbtc-token'),
          Pc.principal(SRC_ADDR).willSendLte(1_000n).ft(SBTC, 'sbtc-token-locked'),
        ],
      }),
    );
  });
});

// =========================================================================
// 8. getDeposit — native via getSTXBalance, non-native via readTokenBalance
// =========================================================================

describe('StacksSpokeService.getDeposit', () => {
  it('native token → calls getSTXBalance(srcAddress) and returns its bigint', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ stx: { balance: '42' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await stacksSpoke.getDeposit({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      token: STACKS_NATIVE,
    });

    expect(result).toBe(42n);
    // Native branch reads the user's balance — NOT the asset-manager's balance. Pin the URL.
    expect(fetchSpy).toHaveBeenCalledWith(`${STACKS_RPC_URL}/extended/v1/address/${SRC_ADDR}/balances`);
  });

  it('non-native token → calls readTokenBalance(token, assetManager) (NOT srcAddress)', async () => {
    // The non-native branch checks the asset-manager's balance of the token — i.e. how much the
    // user has deposited. A regression that passed `srcAddress` instead would silently return the
    // user's wallet balance, which is a different number.
    const fakeResponse = { value: { type: 1, value: 5_555n } };
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce(fakeResponse);

    const result = await stacksSpoke.getDeposit({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      token: STACKS_BNUSD,
    });

    expect(result).toBe(5_555n);
    expect(mocks.fetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'get-balance',
        functionArgs: [Cl.principal(STACKS_ASSET_MGR)],
        senderAddress: STACKS_ASSET_MGR,
      }),
    );
  });
});

// =========================================================================
// 8b. getWalletBalance / getWalletBalances — the user's own holdings
// =========================================================================

describe('StacksSpokeService.getWalletBalance / getWalletBalances', () => {
  // Real config tokens — a synthesised principal would let a native/SIP-010 misclassification pass.
  const STX_TOKEN = stacksConfig.supportedTokens.STX;
  const BNUSD_TOKEN = stacksConfig.supportedTokens.bnUSD;
  const SODA_TOKEN = stacksConfig.supportedTokens.SODA;

  // `getSTXBalance` reads only `ok` and `json`, so a full `Response` is unnecessary.
  const stxBalanceResponse = (balance: string) =>
    ({ ok: true, json: () => Promise.resolve({ stx: { balance } }) }) as unknown as Response;

  it('native STX → reads the Hiro balances endpoint for the user and issues no contract call', async () => {
    // isNativeToken matches token.address against config.nativeToken; if they ever diverge the
    // native branch silently degrades into a SIP-010 read against a non-existent contract.
    expect(STX_TOKEN.address).toBe(STACKS_NATIVE);
    const fetchSpy = vi.fn().mockResolvedValueOnce(stxBalanceResponse('7654321'));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await stacksSpoke.getWalletBalance({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      token: STX_TOKEN,
    });

    expect(result).toBe(7_654_321n);
    expect(fetchSpy).toHaveBeenCalledWith(`${STACKS_RPC_URL}/extended/v1/address/${SRC_ADDR}/balances`);
    expect(mocks.fetchCallReadOnlyFunction).not.toHaveBeenCalled();
  });

  it('SIP-010 → calls `get-balance` with the USER as both principal arg and senderAddress', async () => {
    // The SUT casts the Clarity result to `{ value: UIntCV }` and reads `.value.value`.
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce({ value: { type: 1, value: 8_888n } as unknown as UIntCV });

    const result = await stacksSpoke.getWalletBalance({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      token: BNUSD_TOKEN,
    });

    expect(result).toBe(8_888n);
    // getDeposit passes STACKS_ASSET_MGR here; the holder is the single field separating the two
    // reads, so a copy-paste regression would silently return the protocol's balance to the user.
    expect(mocks.fetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'bnusd',
        functionName: 'get-balance',
        functionArgs: [Cl.principal(SRC_ADDR)],
        senderAddress: SRC_ADDR,
      }),
    );
  });

  it('rejects when the SIP-010 or native STX read fails — never resolves a fabricated 0n', async () => {
    // A swallowed error returning 0n cannot be told apart from an empty wallet.
    mocks.fetchCallReadOnlyFunction.mockRejectedValueOnce(new Error('Hiro read-only call failed'));
    await expect(
      stacksSpoke.getWalletBalance({ srcChainKey: STACKS, srcAddress: SRC_ADDR, token: BNUSD_TOKEN }),
    ).rejects.toThrow('Hiro read-only call failed');

    vi.stubGlobal(
      'fetch',
      // The failure path reads only `ok` and `statusText`.
      vi.fn().mockResolvedValueOnce({ ok: false, statusText: 'Bad Gateway' } as unknown as Response),
    );

    await expect(
      stacksSpoke.getWalletBalance({ srcChainKey: STACKS, srcAddress: SRC_ADDR, token: STX_TOKEN }),
    ).rejects.toThrow('Error fetching STX balance: Bad Gateway');
  });

  it('getWalletBalances → keys successful reads by token.address across both branches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(stxBalanceResponse('100')));
    // Same `{ value: UIntCV }` shape the SUT casts to; the real ResponseOkCV wrapper is never read.
    mocks.fetchCallReadOnlyFunction.mockResolvedValueOnce({ value: { type: 1, value: 700n } as unknown as UIntCV });

    const result = await stacksSpoke.getWalletBalances({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      tokens: [STX_TOKEN, BNUSD_TOKEN],
    });

    expect(result).toEqual({
      [STX_TOKEN.address]: 100n,
      [BNUSD_TOKEN.address]: 700n,
    });
  });

  it('getWalletBalances → a failing token reports 0n via the logger and leaves the others intact', async () => {
    // A flat map cannot carry the failure, so the SDK logger is the only channel an integrator has
    // to tell a fabricated 0n apart from a real empty balance — assert it actually fired.
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');
    const rpcError = new Error('HTTP 429');
    // settleWalletBalances kicks off the reads in token order, so the first `Once` belongs to bnUSD.
    mocks.fetchCallReadOnlyFunction
      .mockRejectedValueOnce(rpcError)
      // The second read succeeds, in the `{ value: UIntCV }` shape the SUT casts to.
      .mockResolvedValueOnce({ value: { type: 1, value: 250n } as unknown as UIntCV });

    const result = await stacksSpoke.getWalletBalances({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      tokens: [BNUSD_TOKEN, SODA_TOKEN],
    });

    expect(mocks.fetchCallReadOnlyFunction.mock.calls[0]?.[0]).toMatchObject({ contractName: 'bnusd' });
    expect(result[BNUSD_TOKEN.address]).toBe(0n);
    expect(result[SODA_TOKEN.address]).toBe(250n);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('balance read failed'),
      expect.objectContaining({ chainKey: STACKS, token: BNUSD_TOKEN.address, error: rpcError.message }),
    );
  });

  it('getWalletBalances → rejects when every token in a non-empty batch fails', async () => {
    // An all-zero map from a dead RPC is indistinguishable from an empty wallet, so the collector
    // refuses to return one.
    mocks.fetchCallReadOnlyFunction.mockRejectedValue(new Error('HTTP 503'));

    await expect(
      stacksSpoke.getWalletBalances({
        srcChainKey: STACKS,
        srcAddress: SRC_ADDR,
        tokens: [BNUSD_TOKEN, SODA_TOKEN],
      }),
    ).rejects.toThrow(`every balance read failed on ${STACKS}`);
  });

  it('getWalletBalances → a genuine on-chain 0n and an empty token list are successes, not failures', async () => {
    // The all-failed guard keys off read outcomes, not values: a wallet that is empty on every
    // token must still resolve, and must log nothing.
    const warnSpy = vi.spyOn(sodax.config.logger, 'warn');
    mocks.fetchCallReadOnlyFunction.mockResolvedValue({ value: { type: 1, value: 0n } as unknown as UIntCV });

    const result = await stacksSpoke.getWalletBalances({
      srcChainKey: STACKS,
      srcAddress: SRC_ADDR,
      tokens: [BNUSD_TOKEN, SODA_TOKEN],
    });

    expect(result).toEqual({ [BNUSD_TOKEN.address]: 0n, [SODA_TOKEN.address]: 0n });
    expect(warnSpy).not.toHaveBeenCalled();
    // `attempted === 0` must not trip the all-failed guard.
    await expect(
      stacksSpoke.getWalletBalances({ srcChainKey: STACKS, srcAddress: SRC_ADDR, tokens: [] }),
    ).resolves.toEqual({});
  });
});

// =========================================================================
// 9. sendMessage — raw vs walletProvider, relay-id derivation
// =========================================================================

describe('StacksSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof STACKS, Raw>>,
  ): SendMessageParams<typeof STACKS, Raw> =>
    ({
      srcAddress: SRC_PUBKEY,
      srcChainKey: STACKS,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockStacksProvider,
      ...overrides,
    }) as SendMessageParams<typeof STACKS, Raw>;

  it('raw=true → builds an unsigned send-message tx and returns { payload: "0x<hex>" }', async () => {
    const result = await stacksSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result).toEqual({ payload: FAKE_PAYLOAD_HEX });
    expect(mocks.makeUnsignedContractCall).toHaveBeenCalledWith(
      expect.objectContaining({
        // parseContractId of '…connection-v3' splits cleanly.
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'connection-v3',
        functionName: 'send-message',
        publicKey: SRC_PUBKEY,
        fee: 0,
        nonce: 0n,
      }),
    );
    // Post-conditions never ride the serialized payload — raw builds don't carry them.
    const call = mocks.makeUnsignedContractCall.mock.calls[0]?.[0];
    expect(call?.postConditions).toBeUndefined();
    // functionArgs: [uintCV(relayChainId), Cl.bufferFromHex(dstAddress), Cl.bufferFromHex(payload)].
    expect(getIntentRelayChainId(SONIC)).toBe(146n);
    const [arg0, arg1, arg2] = call?.functionArgs ?? [];
    // ClarityType is string-valued in v7: 'uint' / 'buffer'. Cl.bufferFromHex strips the 0x prefix
    // before storing the value, so we compare against the unprefixed form.
    expect(arg0).toMatchObject({ type: 'uint', value: 146n });
    expect(arg1).toMatchObject({ type: 'buffer', value: DST_ADDR.slice(2) });
    expect(arg2).toMatchObject({ type: 'buffer', value: 'deadbeef' });
  });

  it('raw=false → delegates to walletProvider.sendTransaction and returns the txId', async () => {
    (mockStacksProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_ID);

    const result = await stacksSpoke.sendMessage(
      sendMessageParams<false>({ raw: false, walletProvider: mockStacksProvider }),
    );

    expect(result).toBe(TX_ID);
    expect(mockStacksProvider.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'connection-v3',
        functionName: 'send-message',
      }),
    );
    expect(mocks.makeUnsignedContractCall).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 10. waitForTransactionReceipt — every tx_status branch + polling defaults
// =========================================================================

describe('StacksSpokeService.waitForTransactionReceipt', () => {
  it('maps tx_status === "success" to status:success with the JSON body, polling the config rpcUrl', async () => {
    const receipt = { tx_id: TX_ID, tx_status: 'success', tx_type: 'contract_call' };
    const fetchSpy = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(receipt) });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await stacksSpoke.waitForTransactionReceipt({ chainKey: STACKS, txHash: TX_ID });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'success') throw new Error('expected success');
    expect(result.value.receipt).toBe(receipt);
    expect(fetchSpy).toHaveBeenCalledWith(`${STACKS_RPC_URL}/extended/v1/tx/${TX_ID}`);
  });

  it('maps both abort tx_statuses to status:failure with a descriptive error', async () => {
    for (const status of ['abort_by_response', 'abort_by_post_condition']) {
      const receipt = { tx_id: TX_ID, tx_status: status, tx_type: 'contract_call' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(receipt) }));

      const result = await stacksSpoke.waitForTransactionReceipt({ chainKey: STACKS, txHash: TX_ID });

      if (!result.ok) throw new Error('expected ok');
      if (result.value.status !== 'failure') throw new Error('expected failure');
      expect(result.value.error.message).toBe(`Transaction aborted: ${status}`);
    }
  });

  it('rejects on the first fetch, then resolves on the next poll → succeeds', async () => {
    // Transient errors are silently caught by the SUT. The loop must continue past them.
    const successReceipt = { tx_id: TX_ID, tx_status: 'success', tx_type: 'contract_call' };
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(successReceipt) });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await stacksSpoke.waitForTransactionReceipt({
      chainKey: STACKS,
      txHash: TX_ID,
      maxTimeoutMs: 60_000,
      pollingIntervalMs: 1,
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('success');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps polling non-terminal tx_status (pending, submitted) until the caller deadline → status:timeout', async () => {
    // Any status other than the three terminal ones falls through to the next poll iteration.
    for (const [status, maxTimeoutMs] of [
      ['pending', 7],
      ['submitted', 0],
    ] as const) {
      const receipt = { tx_id: TX_ID, tx_status: status, tx_type: 'contract_call' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(receipt) }));

      const result = await stacksSpoke.waitForTransactionReceipt({
        chainKey: STACKS,
        txHash: TX_ID,
        maxTimeoutMs,
        pollingIntervalMs: 1,
      });

      if (!result.ok) throw new Error('expected ok');
      if (result.value.status !== 'timeout') throw new Error('expected timeout');
      // The message echoes the caller's maxTimeoutMs, not the config default.
      expect(result.value.error.message).toContain(
        `Timed out after ${maxTimeoutMs}ms waiting for Stacks transaction ${TX_ID}`,
      );
    }
  });
});
