/**
 * Tests for SolanaSpokeService — the single Solana spoke chain.
 *
 * Pattern: mirrors SuiSpokeService.test.ts (single-chain shape). Solana has one chain
 * (`ChainKeys.SOLANA_MAINNET`), so there is no `describe.each` parametrisation and no cross-chain
 * independence section. One `new Sodax()` instance backs every test; `sodax.spoke.solana.connection`
 * methods are spied per-test; `vi.restoreAllMocks` in `afterEach` tears them down.
 *
 * Real config data is used wherever possible — assetManager, connection, native token, bnUSD, rpc
 * URL, and pollingConfig are all sourced from `spokeChainConfig[SOLANA_MAINNET]` rather than fake
 * constants. That catches a class of regressions where a hardcoded value happens to match a test
 * fixture but diverges from production config (wrong vault address, wrong polling interval, etc.).
 * Only user identities (`SRC_ADDR`, `HUB_WALLET`, `DST_ADDR`) and per-test scratch (tx signatures,
 * mock balances) are fabricated.
 *
 * Mocking strategy:
 *   - `getAssetManagerProgram` and `getConnectionProgram` from `entities/solana/utils/utils.js` are
 *     module-mocked at their source path via the `vi.hoisted` + `vi.mock` + `vi.importActual`
 *     pattern. They fetch IDLs over the network in production, so we replace them with a fluent
 *     stub exposing the `.methods.transfer(...).accountsStrict(...).remainingAccounts(...).instruction()`
 *     and `.methods.sendMessage(...)` chains the SUT consumes. The real `convertTransactionInstructionToRaw`
 *     and `isSolanaNativeToken` exports are preserved by spreading `...actual`.
 *   - `sleep` from `utils/shared-utils.js` is no-op-ed so `waitForTransactionReceipt` timeout tests
 *     run instantly. Everything else in `shared-utils.js` is preserved via `vi.importActual`.
 *   - `@solana/web3.js` is intentionally NOT module-mocked — real `Connection`, `PublicKey`,
 *     `VersionedTransaction`, `TransactionMessage`, and `SystemProgram` constructors run. Only the
 *     network methods on `sodax.spoke.solana.connection` (`simulateTransaction`, `getLatestBlockhash`,
 *     `getTransaction`, `getBalance`, `getTokenAccountBalance`, `getMultipleAccountsInfo`) are spied
 *     per-test.
 *   - `@solana/spl-token` is NOT mocked either: the wallet-balance tests feed real `AccountLayout`
 *     buffers to the production `unpackAccount` so the decode, the account-size check, and the
 *     program-ownership check all execute for real.
 *
 * Section organization:
 *   2.  estimateGas                — simulate happy path + value.err throw branch
 *   3.  deposit                    — native vs SPL, raw vs walletProvider, default data
 *   4.  getDeposit                 — native vault_native vs SPL vault_token branches
 *   4b. getWalletBalance(s)        — the USER's own SOL / SPL holdings, dual-ATA probe, balance map
 *   5.  sendMessage                — raw vs walletProvider, relay-id derivation
 *   7.  waitForTransactionReceipt  — success / failure / timeout / transient-error
 *   8.  static helpers             — getMintTokenProgramId
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
  type AccountInfo,
} from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  AccountLayout,
  AccountState,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type BN from 'bn.js';
import {
  ChainKeys,
  getIntentRelayChainId,
  spokeChainConfig,
  type Address,
  type Hex,
  type ISolanaWalletProvider,
  type SolanaBase58PublicKey,
  type XToken,
} from '@sodax/types';

// --- hoisted mocks --------------------------------------------------------
//
// Why hoisted: `vi.mock` is hoisted to the top of the file by Vitest; if the mock factory
// references a top-level binding directly, that binding doesn't exist yet at hoist time.
// `vi.hoisted(...)` lifts the binding alongside the mock so the factory can close over it.

const mocks = vi.hoisted(() => {
  // The fluent program stub. Each call site of `.methods.transfer(...)` or `.methods.sendMessage(...)`
  // returns the same chain so the test can intercept the final `.instruction()` resolution.
  const makeChain = () => {
    const chain = {
      accountsStrict: vi.fn(() => chain),
      remainingAccounts: vi.fn(() => chain),
      instruction: vi.fn(),
    };
    return chain;
  };

  return {
    getAssetManagerProgram: vi.fn(),
    getConnectionProgram: vi.fn(),
    makeChain,
    sleep: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../entities/solana/utils/utils.js', async () => {
  // Preserve real `convertTransactionInstructionToRaw` and `isSolanaNativeToken` exports — only
  // the IDL-fetching program builders need stubbing.
  const actual = await vi.importActual<object>('../../entities/solana/utils/utils.js');
  return {
    ...actual,
    getAssetManagerProgram: mocks.getAssetManagerProgram,
    getConnectionProgram: mocks.getConnectionProgram,
  };
});

vi.mock('../../utils/shared-utils.js', async () => {
  // Only `sleep` is replaced; everything else (retry, getRandomBytes, encodeAddress, …) must
  // continue to use the real impl so other code paths invoked under test aren't affected.
  const actual = await vi.importActual<object>('../../utils/shared-utils.js');
  return {
    ...actual,
    sleep: mocks.sleep,
  };
});

import { Sodax } from '../../entities/Sodax.js';
import { SolanaSpokeService } from './SolanaSpokeService.js';
import { AssetManagerPDA, ConnectionConfigPDA } from '../../entities/solana/pda/pda.js';
import type { DepositParams, SendMessageParams } from '../../types/spoke-types.js';

// --- fixtures -------------------------------------------------------------

const sodax = new Sodax();
const solanaSpoke = sodax.spoke.solana;

const SOL = ChainKeys.SOLANA_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET; // sendMessage destination (hub chain)

// REAL config — every consumer of these values in production reads from the same source.
const solanaConfig = spokeChainConfig[SOL];
const SOL_NATIVE = solanaConfig.nativeToken; // '11111111111111111111111111111111'
const SOL_BNUSD = solanaConfig.bnUSD;
const SOL_ASSET_MGR = solanaConfig.addresses.assetManager;
const SOL_CONNECTION = solanaConfig.addresses.connection;

// Per-user / per-flow scratch — these have no config source.
// SRC_ADDR is a real-looking base58 32-byte pubkey (not the system program).
const SRC_ADDR: SolanaBase58PublicKey = '4Nd1mYz3Xqp2VqJxbA4hPNCQkP9F2VL3v8c2Y3M5XbqL';
const HUB_WALLET: Address = '0x2222222222222222222222222222222222222222';
const DST_ADDR: Address = '0x3333333333333333333333333333333333333333';
const TX_SIG = '5J7XmnPSf2pT8h4QwUQ4yWMUszsBwK9jKnQK4Z3Yj8MhwQ4Zv1k7T3sQqMz7Yj7L3xWnY2KxP9Q2Zz5XbqL';

// Distinct fake program ids — these will be the `.programId` of the mocked programs. Using real
// base58 strings (not zero-bytes) keeps `.toBase58()` round-trips honest.
const ASSET_MGR_PROGRAM_ID = new PublicKey(SOL_ASSET_MGR);
const CONNECTION_PROGRAM_ID = new PublicKey(SOL_CONNECTION);

// Returned by getAssetManagerProgram — minimal anchor.Program-shaped object.
const fakeAssetManagerProgram = {
  programId: ASSET_MGR_PROGRAM_ID,
  methods: {
    transfer: vi.fn(),
  },
};

const fakeConnectionProgram = {
  programId: CONNECTION_PROGRAM_ID,
  methods: {
    sendMessage: vi.fn(),
  },
};

// Deterministic TransactionInstruction stand-ins produced by `.instruction()`. These pass through
// `convertTransactionInstructionToRaw` (real impl, preserved by `...actual` spread) so the shape
// must be the genuine `TransactionInstruction` class.
const makeFakeInstruction = (programId: PublicKey = ASSET_MGR_PROGRAM_ID): TransactionInstruction =>
  new TransactionInstruction({
    keys: [{ pubkey: ASSET_MGR_PROGRAM_ID, isSigner: false, isWritable: true }],
    programId,
    data: Buffer.from([1, 2, 3, 4]),
  });

const mockSolanaProvider = {
  chainType: 'SOLANA',
  getWalletAddress: vi.fn(),
  sendTransaction: vi.fn(),
  waitForConfirmation: vi.fn(),
  buildV0Txn: vi.fn(),
  getWalletBase58PublicKey: vi.fn(),
  getAssociatedTokenAddress: vi.fn(),
  getBalance: vi.fn(),
  getTokenAccountBalance: vi.fn(),
} as unknown as ISolanaWalletProvider;

// Default blockhash for buildV0Txn — getLatestBlockhash is spied per-test where needed.
const FAKE_BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

// Re-wire the fluent chain on every test so `instruction.mockResolvedValueOnce(...)` interactions
// don't bleed across tests. The fake programs themselves keep their `.programId` identity.
beforeEach(() => {
  vi.clearAllMocks();
  const transferChain = mocks.makeChain();
  const sendMessageChain = mocks.makeChain();
  fakeAssetManagerProgram.methods.transfer = vi.fn(() => transferChain);
  fakeConnectionProgram.methods.sendMessage = vi.fn(() => sendMessageChain);
  // Default: returning a real TransactionInstruction so `convertTransactionInstructionToRaw` works.
  transferChain.instruction.mockResolvedValue(makeFakeInstruction(ASSET_MGR_PROGRAM_ID));
  sendMessageChain.instruction.mockResolvedValue(makeFakeInstruction(CONNECTION_PROGRAM_ID));

  mocks.getAssetManagerProgram.mockResolvedValue(fakeAssetManagerProgram);
  mocks.getConnectionProgram.mockResolvedValue(fakeConnectionProgram);
  mocks.sleep.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// 2. estimateGas — simulate happy path + value.err throw branch
// =========================================================================

describe('SolanaSpokeService.estimateGas', () => {
  // Build a real serialized versioned tx so `VersionedTransaction.deserialize(bytes)` succeeds
  // locally. The internal contents are irrelevant — we only need the deserialise call to round-trip.
  const buildSerializedTx = async (): Promise<string> => {
    const blockhashSpy = vi
      .spyOn(solanaSpoke.connection, 'getLatestBlockhash')
      .mockResolvedValueOnce({ blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 0 });
    const tx = await solanaSpoke.buildV0Txn(SRC_ADDR, []);
    blockhashSpy.mockRestore();
    return Buffer.from(tx).toString('base64');
  };

  it('returns unitsConsumed from a successful simulateTransaction', async () => {
    const data = await buildSerializedTx();
    // simulateTransaction is invoked on a fresh Connection inside estimateGas (not on
    // solanaSpoke.connection), so we spy on the Connection prototype.
    const simulateSpy = vi.spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValueOnce({
      context: { slot: 1 },
      value: { err: null, logs: [], unitsConsumed: 12_345, accounts: null, returnData: null },
    });

    const result = await solanaSpoke.estimateGas({
      chainKey: SOL,
      tx: { from: SRC_ADDR, to: SOL_ASSET_MGR, value: 0n, data },
    });

    expect(result).toBe(12_345);
    expect(simulateSpy).toHaveBeenCalledTimes(1);
  });

  it('throws with JSON-encoded error when simulateTransaction returns value.err', async () => {
    const data = await buildSerializedTx();
    const simErr = { InstructionError: [0, 'Custom'] };
    vi.spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValueOnce({
      context: { slot: 1 },
      value: { err: simErr, logs: [], unitsConsumed: 0, accounts: null, returnData: null },
    });

    await expect(
      solanaSpoke.estimateGas({
        chainKey: SOL,
        tx: { from: SRC_ADDR, to: SOL_ASSET_MGR, value: 0n, data },
      }),
    ).rejects.toThrow(`Failed to simulate transaction: ${JSON.stringify(simErr, null, 2)}`);
  });
});

// =========================================================================
// 3. deposit — native vs SPL, raw vs walletProvider, default data
// =========================================================================

describe('SolanaSpokeService.deposit', () => {
  const depositParams = <Raw extends boolean>(
    overrides: Partial<DepositParams<typeof SOL, Raw>>,
  ): DepositParams<typeof SOL, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SOL,
      to: HUB_WALLET,
      token: SOL_BNUSD,
      amount: 1_000n,
      data: '0x' as Hex,
      raw: false,
      walletProvider: mockSolanaProvider,
      ...overrides,
    }) as DepositParams<typeof SOL, Raw>;

  it('native (SOL) raw path builds asset-manager transfer with native vault accounts and a base64 v0 tx', async () => {
    vi.spyOn(solanaSpoke.connection, 'getLatestBlockhash').mockResolvedValueOnce({
      blockhash: FAKE_BLOCKHASH,
      lastValidBlockHeight: 0,
    });

    const result = await solanaSpoke.deposit(depositParams<true>({ token: SOL_NATIVE, raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(ASSET_MGR_PROGRAM_ID.toBase58());
    expect(result.value).toBe(1_000n);
    expect(() => VersionedTransaction.deserialize(Buffer.from(result.data, 'base64'))).not.toThrow();
    // Asset-manager and connection programs are fetched via the mocked utils helpers.
    expect(mocks.getAssetManagerProgram).toHaveBeenCalledWith(SRC_ADDR, solanaConfig.rpcUrl, SOL_ASSET_MGR);
    expect(mocks.getConnectionProgram).toHaveBeenCalledWith(SRC_ADDR, solanaConfig.rpcUrl, SOL_CONNECTION);
    // The transfer method was called with (amountBN, recipientBytes, dataHashBytes).
    expect(fakeAssetManagerProgram.methods.transfer).toHaveBeenCalledTimes(1);
    const transferArgs = (fakeAssetManagerProgram.methods.transfer as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!transferArgs) throw new Error('transfer not called');
    const [amountBN, recipientBuf, dataHashBuf] = transferArgs as [BN, Buffer, Buffer];
    expect(amountBN.toString()).toBe('1000');
    expect(Buffer.from(recipientBuf).toString('hex')).toBe(HUB_WALLET.slice(2));
    // data defaults to a 32-byte keccak hash even when the caller passes '0x'.
    expect(dataHashBuf.length).toBe(32);

    // accountsStrict must be invoked with native vault accounts.
    const transferChain = (fakeAssetManagerProgram.methods.transfer as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof mocks.makeChain>;
    expect(transferChain.accountsStrict).toHaveBeenCalledTimes(1);
    const accounts = (transferChain.accountsStrict as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(accounts.tokenVaultAccount).toBeNull();
    expect(accounts.signerTokenAccount).toBeNull();
    expect(accounts.mint).toBeNull();
    expect(accounts.nativeVaultAccount.toBase58()).toBe(
      AssetManagerPDA.vault_native(ASSET_MGR_PROGRAM_ID).pda.toBase58(),
    );
    expect(accounts.systemProgram.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(accounts.connection.toBase58()).toBe(CONNECTION_PROGRAM_ID.toBase58());
    // remainingAccounts must include the connection config PDA.
    expect(transferChain.remainingAccounts).toHaveBeenCalledTimes(1);
    const remaining = (transferChain.remainingAccounts as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(remaining[0].pubkey.toBase58()).toBe(ConnectionConfigPDA.config(CONNECTION_PROGRAM_ID).pda.toBase58());
  });

  it('SPL path resolves a Token-2022 mint and threads it into the ATA + tokenProgram', async () => {
    vi.spyOn(solanaSpoke.connection, 'getLatestBlockhash').mockResolvedValueOnce({
      blockhash: FAKE_BLOCKHASH,
      lastValidBlockHeight: 0,
    });
    // A Token-2022 mint (e.g. xStock tokens like CRCLx) is owned by the Token-2022 program.
    vi.spyOn(solanaSpoke.connection, 'getAccountInfo').mockResolvedValueOnce({
      owner: TOKEN_2022_PROGRAM_ID,
    } as never);

    await solanaSpoke.deposit(depositParams<true>({ token: SOL_BNUSD, raw: true }));

    const transferChain = (fakeAssetManagerProgram.methods.transfer as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as ReturnType<typeof mocks.makeChain>;
    const accounts = (transferChain.accountsStrict as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // The mint's program must flip both the tokenProgram account and the ATA derivation.
    expect(accounts.tokenProgram.toBase58()).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
    const expectedAta = await SolanaSpokeService.getAssociatedTokenAddress(SOL_BNUSD, SRC_ADDR, TOKEN_2022_PROGRAM_ID);
    expect(accounts.signerTokenAccount).toBe(expectedAta);
    // The legacy-derived ATA differs, proving the program id actually changes the address.
    const legacyAta = await SolanaSpokeService.getAssociatedTokenAddress(SOL_BNUSD, SRC_ADDR, TOKEN_PROGRAM_ID);
    expect(accounts.signerTokenAccount).not.toBe(legacyAta);
  });

  it('raw=false delegates to walletProvider.buildV0Txn and walletProvider.sendTransaction', async () => {
    const signedTx = new Uint8Array([1, 2, 3]);
    (mockSolanaProvider.buildV0Txn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(signedTx);
    (mockSolanaProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_SIG);

    const result = await solanaSpoke.deposit(
      depositParams<false>({ token: SOL_NATIVE, raw: false, walletProvider: mockSolanaProvider }),
    );

    expect(result).toBe(TX_SIG);
    expect(mockSolanaProvider.buildV0Txn).toHaveBeenCalledTimes(1);
    expect(mockSolanaProvider.sendTransaction).toHaveBeenCalledWith(signedTx);
  });
});

// =========================================================================
// 4. getDeposit — native vault_native PDA vs SPL vault_token PDA
// =========================================================================

describe('SolanaSpokeService.getDeposit', () => {
  it('native (SOL) reads vault_native PDA via Connection.getBalance', async () => {
    const expectedPda = AssetManagerPDA.vault_native(ASSET_MGR_PROGRAM_ID).pda;
    const getBalanceSpy = vi.spyOn(solanaSpoke.connection, 'getBalance').mockResolvedValueOnce(987_654);

    const result = await solanaSpoke.getDeposit({
      srcChainKey: SOL,
      srcAddress: SRC_ADDR,
      token: SOL_NATIVE,
    });

    expect(result).toBe(987_654n);
    const passedKey = getBalanceSpy.mock.calls[0]?.[0] as PublicKey;
    expect(passedKey.toBase58()).toBe(expectedPda.toBase58());
  });

  it('SPL reads vault_token PDA via Connection.getTokenAccountBalance', async () => {
    const expectedPda = AssetManagerPDA.vault_token(ASSET_MGR_PROGRAM_ID, new PublicKey(SOL_BNUSD)).pda;
    const getTokenSpy = vi.spyOn(solanaSpoke.connection, 'getTokenAccountBalance').mockResolvedValueOnce({
      context: { slot: 1 },
      value: { amount: '4321', decimals: 9, uiAmount: 4.321, uiAmountString: '4.321' },
    });

    const result = await solanaSpoke.getDeposit({
      srcChainKey: SOL,
      srcAddress: SRC_ADDR,
      token: SOL_BNUSD,
    });

    expect(result).toBe(4_321n);
    const passedKey = getTokenSpy.mock.calls[0]?.[0] as PublicKey;
    expect(passedKey.toBase58()).toBe(expectedPda.toBase58());
  });
});

// =========================================================================
// 4b. getWalletBalance / getWalletBalances — the USER's own holdings
// =========================================================================

describe('SolanaSpokeService.getWalletBalance / getWalletBalances', () => {
  // Real config tokens. A synthesised mint would exist in no token list, so nothing it proves
  // carries over to what production actually passes here.
  const SOL_TOKEN: XToken = solanaConfig.supportedTokens.SOL;
  const BNUSD_TOKEN: XToken = solanaConfig.supportedTokens.bnUSD;
  // CRCLx is an xStock mint, i.e. one owned by the Token-2022 program rather than legacy SPL.
  const CRCLX_TOKEN: XToken = solanaConfig.supportedTokens.CRCLx;

  const OWNER = new PublicKey(SRC_ADDR);
  const ataFor = (token: XToken, programId: PublicKey): PublicKey =>
    getAssociatedTokenAddressSync(new PublicKey(token.address), OWNER, true, programId);

  // A genuine SPL account buffer, so the production `unpackAccount` performs its real decode plus
  // its account-size and program-ownership checks instead of being mocked away.
  const tokenAccountInfo = (token: XToken, programId: PublicKey, amount: bigint): AccountInfo<Buffer> => {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint: new PublicKey(token.address),
        owner: OWNER,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        state: AccountState.Initialized,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    return { data, executable: false, lamports: 2_039_280, owner: programId, rentEpoch: 0 };
  };

  // A plain system-owned account — not a token account of either program.
  const systemAccountInfo = (): AccountInfo<Buffer> => ({
    data: Buffer.alloc(0),
    executable: false,
    lamports: 890_880,
    owner: SystemProgram.programId,
    rentEpoch: 0,
  });

  it('reads native SOL from the USER address, not the asset-manager native vault', async () => {
    const getBalanceSpy = vi.spyOn(solanaSpoke.connection, 'getBalance').mockResolvedValueOnce(2_500_000_000);

    const result = await solanaSpoke.getWalletBalance({
      srcChainKey: SOL,
      srcAddress: SRC_ADDR,
      token: SOL_TOKEN,
    });

    expect(result).toBe(2_500_000_000n);
    const holder = getBalanceSpy.mock.calls[0]?.[0] as PublicKey;
    // The holder is the user — getDeposit reads vault_native at the very same RPC method.
    expect(holder.toBase58()).toBe(SRC_ADDR);
    expect(holder.toBase58()).not.toBe(AssetManagerPDA.vault_native(ASSET_MGR_PROGRAM_ID).pda.toBase58());
  });

  it('probes both candidate ATAs of the USER in a single round trip and returns the legacy one', async () => {
    const legacyAta = ataFor(BNUSD_TOKEN, TOKEN_PROGRAM_ID);
    const token2022Ata = ataFor(BNUSD_TOKEN, TOKEN_2022_PROGRAM_ID);
    const spy = vi
      .spyOn(solanaSpoke.connection, 'getMultipleAccountsInfo')
      .mockResolvedValueOnce([tokenAccountInfo(BNUSD_TOKEN, TOKEN_PROGRAM_ID, 6_100n), null]);

    const result = await solanaSpoke.getWalletBalance({
      srcChainKey: SOL,
      srcAddress: SRC_ADDR,
      token: BNUSD_TOKEN,
    });

    expect(result).toBe(6_100n);
    expect(spy).toHaveBeenCalledTimes(1);
    const probed = (spy.mock.calls[0]?.[0] as PublicKey[]).map(key => key.toBase58());
    expect(probed).toEqual([legacyAta.toBase58(), token2022Ata.toBase58()]);
    // The ATAs belong to the user; getDeposit reads the asset manager's vault_token PDA instead.
    expect(probed).not.toContain(
      AssetManagerPDA.vault_token(ASSET_MGR_PROGRAM_ID, new PublicKey(BNUSD_TOKEN.address)).pda.toBase58(),
    );
  });

  it('falls back to the Token-2022 ATA, skipping a non-token account at the legacy candidate', async () => {
    vi.spyOn(solanaSpoke.connection, 'getMultipleAccountsInfo').mockResolvedValueOnce([
      systemAccountInfo(),
      tokenAccountInfo(CRCLX_TOKEN, TOKEN_2022_PROGRAM_ID, 780n),
    ]);

    const result = await solanaSpoke.getWalletBalance({
      srcChainKey: SOL,
      srcAddress: SRC_ADDR,
      token: CRCLX_TOKEN,
    });

    // Probing only the legacy program would report an xStock holder as empty; the stray account
    // must be skipped, not throw and not contribute to the sum.
    expect(result).toBe(780n);
    expect(ataFor(CRCLX_TOKEN, TOKEN_2022_PROGRAM_ID).toBase58()).not.toBe(
      ataFor(CRCLX_TOKEN, TOKEN_PROGRAM_ID).toBase58(),
    );
  });

  it('getWalletBalances reports each token as a plain balance keyed by address', async () => {
    vi.spyOn(solanaSpoke.connection, 'getBalance').mockResolvedValueOnce(7_000_000);
    vi.spyOn(solanaSpoke.connection, 'getMultipleAccountsInfo').mockResolvedValueOnce([
      tokenAccountInfo(BNUSD_TOKEN, TOKEN_PROGRAM_ID, 4_200n),
      null,
    ]);

    const result = await solanaSpoke.getWalletBalances({
      srcChainKey: SOL,
      srcAddress: SRC_ADDR,
      tokens: [SOL_TOKEN, BNUSD_TOKEN],
    });

    expect(result).toEqual({
      [SOL_TOKEN.address]: 7_000_000n,
      [BNUSD_TOKEN.address]: 4_200n,
    });
  });
});

// =========================================================================
// 5. sendMessage — raw vs walletProvider, relay-id derivation
// =========================================================================

describe('SolanaSpokeService.sendMessage', () => {
  const sendMessageParams = <Raw extends boolean>(
    overrides: Partial<SendMessageParams<typeof SOL, Raw>>,
  ): SendMessageParams<typeof SOL, Raw> =>
    ({
      srcAddress: SRC_ADDR,
      srcChainKey: SOL,
      dstChainKey: SONIC,
      dstAddress: DST_ADDR,
      payload: '0xdeadbeef' as Hex,
      raw: false,
      walletProvider: mockSolanaProvider,
      ...overrides,
    }) as SendMessageParams<typeof SOL, Raw>;

  it('raw=true returns rawTx to connection.programId with value 0n, sending to the dstChainKey relay id', async () => {
    vi.spyOn(solanaSpoke.connection, 'getLatestBlockhash').mockResolvedValueOnce({
      blockhash: FAKE_BLOCKHASH,
      lastValidBlockHeight: 0,
    });

    const result = await solanaSpoke.sendMessage(sendMessageParams<true>({ raw: true }));

    expect(result.from).toBe(SRC_ADDR);
    expect(result.to).toBe(CONNECTION_PROGRAM_ID.toBase58());
    expect(result.value).toBe(0n);
    expect(typeof result.data).toBe('string');
    const bytes = Buffer.from(result.data, 'base64');
    expect(() => VersionedTransaction.deserialize(bytes)).not.toThrow();

    expect(getIntentRelayChainId(SONIC)).toBe(146n);
    const sendArgs = (fakeConnectionProgram.methods.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!sendArgs) throw new Error('sendMessage not called');
    const [relayBN, dstAddrBuf, payloadHashBuf] = sendArgs as [BN, Buffer, Buffer];
    expect(relayBN.toString()).toBe('146');
    expect(Buffer.from(dstAddrBuf).toString('hex')).toBe(DST_ADDR.slice(2));
    expect(payloadHashBuf.length).toBe(32);
  });

  it('raw=false delegates to walletProvider.buildV0Txn and walletProvider.sendTransaction', async () => {
    const signedTx = new Uint8Array([9, 9, 9]);
    (mockSolanaProvider.buildV0Txn as ReturnType<typeof vi.fn>).mockResolvedValueOnce(signedTx);
    (mockSolanaProvider.sendTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TX_SIG);

    const result = await solanaSpoke.sendMessage(
      sendMessageParams<false>({ raw: false, walletProvider: mockSolanaProvider }),
    );

    expect(result).toBe(TX_SIG);
    expect(mockSolanaProvider.buildV0Txn).toHaveBeenCalledTimes(1);
    expect(mockSolanaProvider.sendTransaction).toHaveBeenCalledWith(signedTx);
  });
});

// =========================================================================
// 7. waitForTransactionReceipt — every result branch + polling defaults
// =========================================================================

describe('SolanaSpokeService.waitForTransactionReceipt', () => {
  it('returns status:failure when getTransaction resolves with meta.err set', async () => {
    const txErr = { InstructionError: [0, 'Custom'] };
    vi.spyOn(solanaSpoke.connection, 'getTransaction').mockResolvedValueOnce({
      slot: 1,
      transaction: {},
      meta: { err: txErr },
    } as never);

    const result = await solanaSpoke.waitForTransactionReceipt({ chainKey: SOL, txHash: TX_SIG });

    if (!result.ok) throw new Error('expected ok');
    if (result.value.status !== 'failure') throw new Error('expected failure');
    expect(result.value.error).toBeInstanceOf(Error);
    expect(result.value.error.message).toBe(JSON.stringify(txErr));
  });

  it('returns status:timeout when getTransaction returns null until the deadline expires', async () => {
    vi.spyOn(solanaSpoke.connection, 'getTransaction').mockResolvedValue(null);

    const result = await solanaSpoke.waitForTransactionReceipt({
      chainKey: SOL,
      txHash: TX_SIG,
      maxTimeoutMs: 1, // exits the while-loop after one iteration since sleep is mocked
    });

    if (!result.ok) throw new Error('expected ok');
    expect(result.value.status).toBe('timeout');
    if (result.value.status !== 'timeout') return;
    expect(result.value.error.message).toContain(`Timed out after 1ms waiting for confirmation for ${TX_SIG}`);
  });

  it('keeps polling after a transient getTransaction rejection and resolves on the next poll', async () => {
    const fakeReceipt = { slot: 2, transaction: {}, meta: { err: null }, blockTime: 0 } as never;
    const getTxSpy = vi
      .spyOn(solanaSpoke.connection, 'getTransaction')
      .mockRejectedValueOnce(new Error('temporary RPC outage'))
      .mockResolvedValueOnce(fakeReceipt);

    const result = await solanaSpoke.waitForTransactionReceipt({ chainKey: SOL, txHash: TX_SIG });

    if (!result.ok || result.value.status !== 'success') throw new Error('expected ok+success');
    expect(result.value.receipt).toBe(fakeReceipt);
    expect(getTxSpy).toHaveBeenCalledTimes(2);
    // sleep must have been invoked between the failed and successful polls.
    expect(mocks.sleep).toHaveBeenCalled();
  });
});

// =========================================================================
// 8. static helpers
// =========================================================================

describe('SolanaSpokeService static helpers', () => {
  it('getMintTokenProgramId resolves the mint owner program, defaulting to legacy', async () => {
    const conn = solanaSpoke.connection;
    const mint = new PublicKey(SOL_BNUSD);

    vi.spyOn(conn, 'getAccountInfo').mockResolvedValueOnce({ owner: TOKEN_2022_PROGRAM_ID } as never);
    expect((await SolanaSpokeService.getMintTokenProgramId(conn, mint)).toBase58()).toBe(
      TOKEN_2022_PROGRAM_ID.toBase58(),
    );

    vi.spyOn(conn, 'getAccountInfo').mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID } as never);
    expect((await SolanaSpokeService.getMintTokenProgramId(conn, mint)).toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());

    // Unreadable mint account → fall back to the legacy program.
    vi.spyOn(conn, 'getAccountInfo').mockResolvedValueOnce(null);
    expect((await SolanaSpokeService.getMintTokenProgramId(conn, mint)).toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
  });
});
