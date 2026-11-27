/**
 * Tests for the MigrationService public API.
 *
 * Mirrors the SwapService.test.ts pattern from PR #1174:
 *
 *   1. A single `new Sodax()` instance backs every runtime test (`sodax.migration` is the SUT).
 *   2. Static collaborators (IntentRelayApiService, encodeAddress) are mocked at their source
 *      paths via `vi.mock` + `vi.hoisted`, since SwapService-style barrel re-exports otherwise
 *      produce a different module instance than the test-side import. `getUserHubWalletAddress`
 *      and `getUserRouter` are now instance methods on `sodax.hubProvider` and are bound via
 *      `vi.spyOn` in `beforeEach`.
 *   3. Instance methods on `sodax.spoke` and on the sub-services (icxMigration,
 *      bnUSDMigrationService, balnSwapService) are stubbed per-test via `vi.spyOn`.
 *   4. Each public method has a top-level `describe` with branch-level coverage:
 *      happy paths, invariant failures (rejected via Result), and error propagation
 *      from each internal collaborator.
 *
 * MigrationService is the facade over IcxMigrationService, BnUSDMigrationService, and
 * BalnSwapService — those classes have their own service-internal tests; here we only
 * verify the orchestration on top of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  type Address,
  type IconEoaAddress,
  type IcxTokenType,
  type IEvmWalletProvider,
  type IIconWalletProvider,
  type IStellarWalletProvider,
  type ISolanaWalletProvider,
  type Result,
} from '@sodax/types';
import { SodaxError } from '../errors/SodaxError.js';

const mocks = vi.hoisted(() => ({
  // EvmHubProvider instance methods — `getUserHubWalletAddress` (used by every create-intent
  // path to derive the hub-side recipient) and `getUserRouter` (used by revert flows that need
  // the user's spending router on the hub). Bound to the live `sodax.hubProvider` via
  // `vi.spyOn` in `beforeEach`.
  getUserHubWalletAddress: vi.fn(),
  getUserRouter: vi.fn(),
  // IntentRelayApiService — every facade method (migratebnUSD / migrateIcxToSoda /
  // revertMigrateSodaToIcx / migrateBaln) goes through `relayTxAndWaitPacket`, and the
  // bnUSD flow optionally also calls `waitUntilIntentExecuted` for the hub→spoke leg.
  relayTxAndWaitPacket: vi.fn(),
  waitUntilIntentExecuted: vi.fn(),
  // encodeAddress is called for bnUSD migrate / revert paths to translate the dst address
  // into the hub's encoded form before being passed to the migration data builder.
  encodeAddress: vi.fn((_chainKey: unknown, addr: string) => `0xencoded:${addr}`),
}));

// Preserve types and the rest of the module surface — only the network-touching helpers
// are replaced. This matches the SwapService test approach for IntentRelayApiService.
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
    waitUntilIntentExecuted: mocks.waitUntilIntentExecuted,
  };
});

// `encodeAddress` lives in `shared-utils`. Real implementation depends on chain-specific
// codecs and we only care that the bnUSD flow forwards the dst address through it — so
// we replace it with a deterministic fake but keep every other util intact.
vi.mock('../shared/utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../shared/utils/shared-utils.js');
  return {
    ...actual,
    encodeAddress: mocks.encodeAddress,
  };
});

import { Sodax } from '../shared/entities/Sodax.js';
import type { IcxMigrateParams, IcxCreateRevertMigrationParams } from './IcxMigrationService.js';
import type { UnifiedBnUSDMigrateParams } from './BnUSDMigrationService.js';
import { LockupPeriod, type BalnMigrateParams } from './BalnSwapService.js';

// --- test fixtures --------------------------------------------------------

const sodax = new Sodax();

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

const mockIconProvider = {
  chainType: 'ICON',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IIconWalletProvider;

const mockStellarProvider = {
  chainType: 'STELLAR',
  getWalletAddress: vi.fn(),
  signTransaction: vi.fn(),
} as unknown as IStellarWalletProvider;

const mockSolanaProvider = {
  chainType: 'SOLANA',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
} as unknown as ISolanaWalletProvider;

// Concrete addresses pulled from the real default sodaxConfig — using real values keeps
// type guards (isAddress, isIconAddress, isLegacybnUSDToken, ...) happy without further
// stubbing. Every fixture below is built on top of these.
const evmAddress = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' satisfies `0x${string}`;
const iconEoaAddress = 'hx742d35cc6634c0532925a3b8d4c9db96c4b4d8b6' satisfies IconEoaAddress;
const wICXAddress = 'cx3975b43d260fb8ec802cef6e60c2f4d07486f11d' satisfies IcxTokenType;
const iconBnUSDAddress = 'cx88fd7df7ddff82f7cc735c871dc519838cb235bb';
const sonicBnUSDAddress = '0xE801CA34E19aBCbFeA12025378D19c4FBE250131';
const bscBnUSDAddress = '0x6958a4CBFe11406E2a1c1d3a71A1971aD8B3b92F'; // EVM spoke (non-hub) bnUSD
const stellarBnUSDAddress = 'CD6YBFFWMU2UJHX2NGRJ7RN76IJVTCC7MRA46DUBXNB7E6W7H7JRJ2CX';
const stellarUserAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const hubWalletAddress = '0x1111111111111111111111111111111111111111' satisfies Address;
const userRouterAddress = '0x2222222222222222222222222222222222222222' satisfies Address;
const spokeTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const hubTxHash = '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';

// Per-test parameter factories. Returning fresh objects from a factory rather than
// reusing module-level constants keeps tests independent if a test mutates params.
const icxMigrateParams = (): IcxMigrateParams => ({
  srcAddress: iconEoaAddress,
  srcChainKey: ChainKeys.ICON_MAINNET,
  address: wICXAddress,
  amount: 1_000_000_000_000_000_000n,
  dstAddress: evmAddress,
});

const icxRevertParams = (): IcxCreateRevertMigrationParams => ({
  srcAddress: evmAddress,
  srcChainKey: ChainKeys.SONIC_MAINNET,
  amount: 1_000_000_000_000_000_000n,
  dstAddress: iconEoaAddress,
});

const bnUSDLegacyToNewParams = (): UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET> => ({
  srcAddress: iconEoaAddress,
  srcChainKey: ChainKeys.ICON_MAINNET,
  srcbnUSD: iconBnUSDAddress,
  dstChainKey: ChainKeys.SONIC_MAINNET,
  dstbnUSD: sonicBnUSDAddress,
  amount: 1_000_000_000_000_000_000n,
  dstAddress: evmAddress,
});

const bnUSDNewToLegacyParams = (): UnifiedBnUSDMigrateParams<typeof ChainKeys.SONIC_MAINNET> => ({
  srcAddress: evmAddress,
  srcChainKey: ChainKeys.SONIC_MAINNET,
  srcbnUSD: sonicBnUSDAddress,
  dstChainKey: ChainKeys.ICON_MAINNET,
  dstbnUSD: iconBnUSDAddress,
  amount: 1_000_000_000_000_000_000n,
  dstAddress: iconEoaAddress,
});

const bnUSDEvmSpokeParams = (): UnifiedBnUSDMigrateParams<typeof ChainKeys.BSC_MAINNET> => ({
  srcAddress: evmAddress,
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcbnUSD: bscBnUSDAddress,
  dstChainKey: ChainKeys.ICON_MAINNET,
  dstbnUSD: iconBnUSDAddress,
  amount: 1_000_000_000_000_000_000n,
  dstAddress: iconEoaAddress,
});

const bnUSDStellarParams = (): UnifiedBnUSDMigrateParams<typeof ChainKeys.STELLAR_MAINNET> => ({
  srcAddress: stellarUserAddress,
  srcChainKey: ChainKeys.STELLAR_MAINNET,
  srcbnUSD: stellarBnUSDAddress,
  dstChainKey: ChainKeys.SONIC_MAINNET,
  dstbnUSD: sonicBnUSDAddress,
  amount: 1_000_000_000_000_000_000n,
  dstAddress: evmAddress,
});

const balnMigrateParams = (): BalnMigrateParams => ({
  srcAddress: iconEoaAddress,
  srcChainKey: ChainKeys.ICON_MAINNET,
  amount: 1_000_000_000_000_000_000n,
  lockupPeriod: LockupPeriod.SIX_MONTHS,
  dstAddress: evmAddress,
  stake: true,
});

// Default packet shape returned by relayTxAndWaitPacket on success. Only `dst_tx_hash`
// is read by MigrationService — the rest is shape padding to satisfy the PacketData type
// when a test wants to inspect the packet beyond MigrationService's use.
const okPacket = {
  src_tx_hash: spokeTxHash,
  status: 'executed',
  src_chain_id: 1,
  src_address: iconEoaAddress,
  dst_chain_id: 146,
  conn_sn: 1,
  dst_address: hubWalletAddress,
  dst_tx_hash: hubTxHash,
  signatures: ['0xsig'],
  payload: '0xpayload',
};

beforeEach(() => {
  // ConfigService validity predicates: every bnUSD createMigrate call hits these in the
  // pre-`try` invariant block when `unchecked` is false. The default config doesn't know
  // about every chain-token pair we use, so we steer them all to true and then override
  // per-test where we want a specific failure.
  vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(true);

  // Default hub-wallet/user-router stubs. Tests that need a different value or to
  // exercise the rejection path use `mockResolvedValueOnce` / `mockRejectedValueOnce`
  // before invoking the SUT.
  mocks.getUserHubWalletAddress.mockResolvedValue(hubWalletAddress);
  mocks.getUserRouter.mockResolvedValue(userRouterAddress);
  // Bind the hoisted vi.fn stubs to the live EvmHubProvider instance so per-test
  // `.mockResolvedValueOnce(...)` / `.mockReset()` calls keep working unchanged.
  vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockImplementation(mocks.getUserHubWalletAddress);
  vi.spyOn(sodax.hubProvider, 'getUserRouter').mockImplementation(mocks.getUserRouter);

  // verifyTxHash is invoked by migratebnUSD; default to ok so each happy-path test
  // doesn't need to re-stub it.
  vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  // restoreAllMocks strips every default we set on hoisted vi.fn()s — re-apply them.
  mocks.getUserHubWalletAddress.mockReset().mockResolvedValue(hubWalletAddress);
  mocks.getUserRouter.mockReset().mockResolvedValue(userRouterAddress);
  mocks.relayTxAndWaitPacket.mockReset();
  mocks.waitUntilIntentExecuted.mockReset();
  mocks.encodeAddress.mockReset().mockImplementation((_chainKey: unknown, addr: string) => `0xencoded:${addr}`);
});

// =========================================================================
// isAllowanceValid
// =========================================================================

const solanaBnUSDParams = (): UnifiedBnUSDMigrateParams<typeof ChainKeys.SOLANA_MAINNET> => ({
  srcAddress: 'SoLaNaSrCaDdReSs',
  srcChainKey: ChainKeys.SOLANA_MAINNET,
  srcbnUSD: '3rSPCLNEF7Quw4wX8S1NyKivELoyij8eYA2gJwBgt4V5',
  dstChainKey: ChainKeys.ICON_MAINNET,
  dstbnUSD: iconBnUSDAddress,
  amount: 1n,
  dstAddress: iconEoaAddress,
});

const failureText = (result: Result<unknown, unknown>): string => (result.ok ? 'ok' : String(result.error));

describe('MigrationService.isAllowanceValid — migrate', () => {
  it('returns ok:true (no allowance check) for ICX and BALN migrations on Icon', async () => {
    const isAllowanceValidSpy = vi.spyOn(sodax.spoke, 'isAllowanceValid');
    expect(await sodax.migration.isAllowanceValid(icxMigrateParams(), 'migrate')).toEqual({ ok: true, value: true });
    expect(await sodax.migration.isAllowanceValid(balnMigrateParams(), 'migrate')).toEqual({ ok: true, value: true });
    // ICX/BALN-from-Icon migrations don't require an allowance check — the spoke service must NOT be touched.
    expect(isAllowanceValidSpy).not.toHaveBeenCalled();
  });

  it('delegates to spoke.isAllowanceValid for bnUSD migration on EVM spoke', async () => {
    const params = bnUSDEvmSpokeParams();
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'migrate');

    expect(result).toEqual({ ok: true, value: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      srcChainKey: ChainKeys.BSC_MAINNET,
      token: params.srcbnUSD,
      amount: params.amount,
      owner: params.srcAddress,
      // EVM spoke (non-hub) → spender is the assetManager.
      spender: sodax.config.sodaxConfig.chains[ChainKeys.BSC_MAINNET].addresses.assetManager,
    });
  });

  it('uses hub bnUSD token address as spender for bnUSD migration on Sonic (hub)', async () => {
    const params = bnUSDNewToLegacyParams();
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'migrate');

    expect(result).toEqual({ ok: true, value: true });
    const call = spy.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      token: params.srcbnUSD,
      // Hub spender comes from supportedTokens.bnUSD.address, not the asset manager.
      spender: sodax.config.sodaxConfig.chains[ChainKeys.SONIC_MAINNET]?.supportedTokens.bnUSD?.address,
    });
  });

  it('delegates to spoke.isAllowanceValid for bnUSD migration on Stellar (no spender)', async () => {
    const params = bnUSDStellarParams();
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'migrate');

    expect(result).toEqual({ ok: true, value: true });
    const call = spy.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      token: params.srcbnUSD,
      amount: params.amount,
      owner: params.srcAddress,
    });
    // Stellar trustline call must not include `spender` — that field is EVM-only.
    expect(call).not.toHaveProperty('spender');
  });

  it('returns ok:true (no allowance check) for bnUSD migrate on chains without allowance semantics (e.g. Solana)', async () => {
    // Not Icon (so not the icx/baln short-circuit), not EVM, not Stellar — falls through to "no allowance required".
    const isAllowanceValidSpy = vi.spyOn(sodax.spoke, 'isAllowanceValid');
    const result = await sodax.migration.isAllowanceValid(
      {
        ...solanaBnUSDParams(),
        dstChainKey: ChainKeys.SONIC_MAINNET,
        dstbnUSD: sonicBnUSDAddress,
        dstAddress: evmAddress,
      },
      'migrate',
    );
    expect(result).toEqual({ ok: true, value: true });
    expect(isAllowanceValidSpy).not.toHaveBeenCalled();
  });
});

describe('MigrationService.isAllowanceValid — revert', () => {
  it('delegates to spoke.isAllowanceValid for ICX revert on Sonic (hub)', async () => {
    const params = icxRevertParams();
    mocks.getUserHubWalletAddress.mockResolvedValueOnce(userRouterAddress);
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'revert');

    expect(result).toEqual({ ok: true, value: true });
    const call = spy.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      token: sodax.hubProvider.chainConfig.addresses.sodaToken,
      amount: params.amount,
      owner: params.srcAddress,
      spender: userRouterAddress,
    });
  });

  it('uses hubProvider.getUserRouter to derive the spender for bnUSD revert on hub', async () => {
    const params = bnUSDNewToLegacyParams();
    mocks.getUserRouter.mockResolvedValueOnce(userRouterAddress);
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(mocks.getUserRouter).toHaveBeenCalledWith(params.srcAddress);
    // The union type doesn't expose `spender` on every variant; cast to inspect it.
    const call = spy.mock.calls[0]?.[0] as { spender?: string };
    expect(call?.spender).toBe(userRouterAddress);
  });

  it('uses assetManager as spender for bnUSD revert on EVM spoke (non-hub)', async () => {
    const params = bnUSDEvmSpokeParams();
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(mocks.getUserRouter).not.toHaveBeenCalled();
    const call = spy.mock.calls[0]?.[0] as { spender?: string };
    expect(call?.spender).toBe(sodax.config.sodaxConfig.chains[ChainKeys.BSC_MAINNET].addresses.assetManager);
  });

  it('delegates to spoke.isAllowanceValid for bnUSD revert on Stellar', async () => {
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(bnUSDStellarParams(), 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty('spender');
  });
});

describe('MigrationService.isAllowanceValid — invalid input and errors', () => {
  it('rejects a zero amount and an empty dstAddress for both migrate and revert', async () => {
    const migrateZero = await sodax.migration.isAllowanceValid({ ...icxMigrateParams(), amount: 0n }, 'migrate');
    expect(failureText(migrateZero)).toMatch(/Amount must be greater than 0/);
    const migrateNoDst = await sodax.migration.isAllowanceValid(
      { ...icxMigrateParams(), dstAddress: '' as Address },
      'migrate',
    );
    expect(failureText(migrateNoDst)).toMatch(/To address is required/);
    const revertZero = await sodax.migration.isAllowanceValid({ ...icxRevertParams(), amount: 0n }, 'revert');
    expect(revertZero.ok).toBe(false);
    const revertNoDst = await sodax.migration.isAllowanceValid(
      { ...icxRevertParams(), dstAddress: '' as IconEoaAddress },
      'revert',
    );
    expect(revertNoDst.ok).toBe(false);
  });

  it('returns ok:false with "Invalid action" for an unrecognized action string', async () => {
    // Casting to bypass the union — we want to exercise the runtime fallthrough that
    // exists explicitly to guard against bad callers passing invalid strings.
    const result = await sodax.migration.isAllowanceValid(icxMigrateParams(), 'wrong' as unknown as 'migrate');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Invalid action/);
    }
  });

  it('forwards a thrown error from spoke.isAllowanceValid as-is', async () => {
    const spokeError = new Error('SPOKE_RPC_DOWN');
    vi.spyOn(sodax.spoke, 'isAllowanceValid').mockRejectedValueOnce(spokeError);

    const result = await sodax.migration.isAllowanceValid(bnUSDEvmSpokeParams(), 'migrate');

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: spokeError.message }) });
  });
});

// =========================================================================
// approve
// =========================================================================

const rawApproveTx = { from: '0x1', to: '0x2', value: 0n, data: '0x' };

describe('MigrationService.approve — migrate', () => {
  it('approves bnUSD on EVM spoke, forwarding the walletProvider only when raw=false', async () => {
    const params = bnUSDEvmSpokeParams();
    const approveSpy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xapprove' })
      .mockResolvedValueOnce({ ok: true, value: rawApproveTx });

    const result = await sodax.migration.approve({ params, raw: false, walletProvider: mockEvmProvider }, 'migrate');
    const rawResult = await sodax.migration.approve({ params, raw: true }, 'migrate');

    expect(result).toEqual({ ok: true, value: '0xapprove' });
    expect(approveSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.BSC_MAINNET,
      token: params.srcbnUSD,
      amount: params.amount,
      owner: params.srcAddress,
      spender: sodax.config.sodaxConfig.chains[ChainKeys.BSC_MAINNET].addresses.assetManager,
      raw: false,
      walletProvider: mockEvmProvider,
    });
    expect(rawResult.ok).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('approves bnUSD on Stellar without a spender, forwarding the walletProvider only when raw=false', async () => {
    const params = bnUSDStellarParams();
    const approveSpy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xstellar-approve' })
      .mockResolvedValueOnce({ ok: true, value: rawApproveTx });

    const result = await sodax.migration.approve(
      { params, raw: false, walletProvider: mockStellarProvider },
      'migrate',
    );
    const rawResult = await sodax.migration.approve({ params, raw: true }, 'migrate');

    expect(result).toEqual({ ok: true, value: '0xstellar-approve' });
    const call = approveSpy.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      token: params.srcbnUSD,
      raw: false,
      walletProvider: mockStellarProvider,
    });
    // Stellar trustline params must NOT include `spender` (EVM-only).
    expect(call).not.toHaveProperty('spender');
    expect(rawResult.ok).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('rejects with "Invalid wallet provider" when EVM or Stellar params get the other chain provider', async () => {
    const evmWithStellar = await sodax.migration.approve(
      // Defeat the compile-time narrowing to test the runtime invariant.
      { params: bnUSDEvmSpokeParams(), raw: false, walletProvider: mockStellarProvider } as unknown as Parameters<
        typeof sodax.migration.approve
      >[0],
      'migrate',
    );
    const stellarWithEvm = await sodax.migration.approve(
      // Defeat the compile-time narrowing to test the runtime invariant.
      { params: bnUSDStellarParams(), raw: false, walletProvider: mockEvmProvider } as unknown as Parameters<
        typeof sodax.migration.approve
      >[0],
      'migrate',
    );
    for (const result of [evmWithStellar, stellarWithEvm]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(String(result.error)).toMatch(/Invalid wallet provider/);
    }
  });

  it('returns ok:false with "Invalid params for migrate action" when the chain is neither EVM-spoke nor Stellar', async () => {
    const result = await sodax.migration.approve(
      { params: solanaBnUSDParams(), raw: false, walletProvider: mockSolanaProvider },
      'migrate',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Invalid params for migrate action/);
    }
  });

  it('returns ok:false with "Amount must be greater than 0" when amount is 0', async () => {
    const params = { ...bnUSDEvmSpokeParams(), amount: 0n };
    const result = await sodax.migration.approve({ params, raw: false, walletProvider: mockEvmProvider }, 'migrate');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Amount must be greater than 0/);
    }
  });

  it('forwards a failure Result from spoke.approve unchanged', async () => {
    const approveError = new Error('APPROVE_REJECTED');
    vi.spyOn(sodax.spoke, 'approve').mockResolvedValueOnce({ ok: false, error: approveError });

    const result = await sodax.migration.approve(
      { params: bnUSDEvmSpokeParams(), raw: false, walletProvider: mockEvmProvider },
      'migrate',
    );

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: approveError.message }) });
  });
});

describe('MigrationService.approve — revert', () => {
  it('approves bnUSD revert on EVM spoke with the assetManager as spender, raw and non-raw', async () => {
    const params = bnUSDEvmSpokeParams();
    const approveSpy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xrevert-approve' })
      .mockResolvedValueOnce({ ok: true, value: rawApproveTx });

    const result = await sodax.migration.approve({ params, raw: false, walletProvider: mockEvmProvider }, 'revert');
    const rawResult = await sodax.migration.approve({ params, raw: true }, 'revert');

    expect(result).toEqual({ ok: true, value: '0xrevert-approve' });
    expect(mocks.getUserRouter).not.toHaveBeenCalled();
    const call = approveSpy.mock.calls[0]?.[0] as { spender?: string };
    expect(call?.spender).toBe(sodax.config.sodaxConfig.chains[ChainKeys.BSC_MAINNET].addresses.assetManager);
    expect(rawResult.ok).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('returns "Invalid params or chain type for revert action" for bnUSD on Sonic (hub) and on Solana', async () => {
    // The bnUSD branch uses `isEvmSpokeOnlyChainKeyType`, which excludes Sonic, so a Sonic→Icon bnUSD
    // revert falls through like Solana does. The hub-side ternary inside that branch is unreachable.
    const hub = await sodax.migration.approve(
      { params: bnUSDNewToLegacyParams(), raw: false, walletProvider: mockEvmProvider },
      'revert',
    );
    const solana = await sodax.migration.approve(
      { params: solanaBnUSDParams(), raw: false, walletProvider: mockSolanaProvider },
      'revert',
    );
    for (const result of [hub, solana]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(String(result.error)).toMatch(/Invalid params or chain type for revert action/);
    }
  });

  it('approves ICX revert on Sonic (hub) — SODA token, user wallet as spender, walletProvider only when raw=false', async () => {
    const params = icxRevertParams();
    mocks.getUserHubWalletAddress.mockResolvedValue(userRouterAddress);
    const approveSpy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xicx-revert-approve' })
      .mockResolvedValueOnce({ ok: true, value: rawApproveTx });

    const result = await sodax.migration.approve({ params, raw: false, walletProvider: mockEvmProvider }, 'revert');
    const rawResult = await sodax.migration.approve({ params, raw: true }, 'revert');

    expect(result).toEqual({ ok: true, value: '0xicx-revert-approve' });
    expect(approveSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      token: sodax.hubProvider.chainConfig.addresses.sodaToken,
      amount: params.amount,
      owner: params.srcAddress,
      spender: userRouterAddress,
      raw: false,
      walletProvider: mockEvmProvider,
    });
    expect(rawResult.ok).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('approves bnUSD revert on Stellar without a spender, walletProvider only when raw=false', async () => {
    const params = bnUSDStellarParams();
    const approveSpy = vi
      .spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: true, value: '0xrevert-stellar' })
      .mockResolvedValueOnce({ ok: true, value: rawApproveTx });

    const result = await sodax.migration.approve({ params, raw: false, walletProvider: mockStellarProvider }, 'revert');
    const rawResult = await sodax.migration.approve({ params, raw: true }, 'revert');

    expect(result.ok).toBe(true);
    const call = approveSpy.mock.calls[0]?.[0];
    expect(call?.srcChainKey).toBe(ChainKeys.STELLAR_MAINNET);
    expect(call).not.toHaveProperty('spender');
    expect(rawResult.ok).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('forwards a thrown error from spoke.approve as a Result.error', async () => {
    const approveError = new Error('SPOKE_APPROVE_THROWS');
    vi.spyOn(sodax.spoke, 'approve').mockRejectedValueOnce(approveError);

    const result = await sodax.migration.approve(
      { params: bnUSDEvmSpokeParams(), raw: false, walletProvider: mockEvmProvider },
      'revert',
    );

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: approveError.message }) });
  });

  it('returns ok:false with "Invalid action" for an unrecognized action string', async () => {
    const result = await sodax.migration.approve(
      { params: bnUSDEvmSpokeParams(), raw: false, walletProvider: mockEvmProvider },
      'wrong' as unknown as 'migrate',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Invalid action/);
    }
  });
});

// =========================================================================
// migratebnUSD — facade method that orchestrates create + verify + relay + (optional) wait
// =========================================================================

const okIntent = {
  ok: true,
  value: { tx: spokeTxHash, relayData: { address: hubWalletAddress, payload: '0xp' } },
} as const;

describe('MigrationService.migratebnUSD', () => {
  it('returns { srcChainTxHash, dstChainTxHash } and skips waitUntilIntentExecuted when src or dst is Sonic', async () => {
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockResolvedValueOnce(okIntent);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await sodax.migration.migratebnUSD({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash });
    // Sonic on either end → relay packet is the final step. Skip the hub→spoke wait.
    expect(mocks.waitUntilIntentExecuted).not.toHaveBeenCalled();
  });

  it('calls waitUntilIntentExecuted when neither src nor dst is Sonic', async () => {
    // Stellar→Icon: Sonic is the hub but NEITHER endpoint, so the hub→spoke leg must wait.
    const stellarToIcon: UnifiedBnUSDMigrateParams<typeof ChainKeys.STELLAR_MAINNET> = {
      ...bnUSDStellarParams(),
      dstChainKey: ChainKeys.ICON_MAINNET,
      dstbnUSD: iconBnUSDAddress,
      dstAddress: iconEoaAddress,
    };
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockResolvedValueOnce(okIntent);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: okPacket });
    mocks.waitUntilIntentExecuted.mockResolvedValueOnce({ ok: true, value: okPacket });

    await sodax.migration.migratebnUSD({
      params: stellarToIcon,
      raw: false,
      walletProvider: mockStellarProvider,
    });

    expect(mocks.waitUntilIntentExecuted).toHaveBeenCalledTimes(1);
    const waitCall = mocks.waitUntilIntentExecuted.mock.calls[0]?.[0];
    // Hub→spoke wait runs with the hub tx hash from the packet we just received.
    expect(waitCall?.srcTxHash).toBe(okPacket.dst_tx_hash);
    expect(waitCall?.apiUrl).toBe(sodax.migration.relayerApiEndpoint);
  });

  it('propagates a MigrationCreateIntentError from createMigratebnUSDIntent (subset narrowing, identity)', async () => {
    // CreateMigrateIntentErrorCode ⊂ MigrateOrchestrationErrorCode, so `migratebnUSD` returns
    // the same SodaxError instance unchanged — no extra wrap.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'spoke deposit reverted', {
      feature: 'migration',
      context: { srcChainKey: ChainKeys.ICON_MAINNET, action: 'migratebnUSD', phase: 'intentCreation' },
    });
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockResolvedValueOnce({ ok: false, error: intentError });

    const result = await sodax.migration.migratebnUSD({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(intentError);
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a verifyTxHash failure as MIGRATION_VERIFY_FAILED with cause + phase + action', async () => {
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockResolvedValueOnce(okIntent);
    const verifyError = new Error('TX_NOT_FOUND');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.migration.migratebnUSD({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(result.error.cause).toBe(verifyError);
    expect(result.error.context?.phase).toBe('verify');
    expect(result.error.context?.action).toBe('migratebnUSD');
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a relayTxAndWaitPacket failure via mapRelayFailureToMigrationError', async () => {
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockResolvedValueOnce(okIntent);
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.migration.migratebnUSD({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.cause).toBe(relayError);
    expect(result.error.context?.action).toBe('migratebnUSD');
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
  });

  it('wraps a waitUntilIntentExecuted failure as MIGRATION_RELAY_TIMEOUT with phase="destinationExecution"', async () => {
    // The secondary watcher fires only when NEITHER src NOR dst is Sonic (ICON→SUI here).
    const iconToSuiParams = {
      ...bnUSDLegacyToNewParams(),
      dstChainKey: ChainKeys.SUI_MAINNET,
    } as ReturnType<typeof bnUSDLegacyToNewParams>;

    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockResolvedValueOnce(okIntent);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: okPacket });
    const execError = new Error('RELAY_TIMEOUT');
    mocks.waitUntilIntentExecuted.mockResolvedValueOnce({ ok: false, error: execError });

    const result = await sodax.migration.migratebnUSD({
      params: iconToSuiParams,
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.cause).toBe(execError);
    // The destination-watcher path is tagged `destinationExecution`, not the default `relay`.
    expect(result.error.context?.phase).toBe('destinationExecution');
    expect(result.error.context?.action).toBe('migratebnUSD');
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
  });

  it('wraps an out-of-union SodaxError thrown from createMigratebnUSDIntent as MIGRATION_FAILED', async () => {
    // The `isMigrateOrchestrationError` guard rejects codes outside the forward-orchestrator union.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into migration', {
      feature: 'migration',
    });
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.migration.migratebnUSD({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.action).toBe('migratebnUSD');
  });
});

// =========================================================================
// migrateIcxToSoda / revertMigrateSodaToIcx / migrateBaln: intent failures are forwarded,
// relay failures mapped, and a foreign SodaxError is wrapped as EXECUTION_FAILED.
// =========================================================================

const foreignError = () =>
  new SodaxError('BRIDGE_FAILED' as never, 'foreign code thrown into migration', { feature: 'migration' });
const intentFailure = () => new SodaxError('INTENT_CREATION_FAILED', 'create intent failed', { feature: 'migration' });

describe('MigrationService.migrateIcxToSoda', () => {
  const run = () =>
    sodax.migration.migrateIcxToSoda({ params: icxMigrateParams(), raw: false, walletProvider: mockIconProvider });

  it('on success, returns { srcChainTxHash, dstChainTxHash }', async () => {
    vi.spyOn(sodax.migration, 'createMigrateIcxToSodaIntent').mockResolvedValueOnce(okIntent);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await run();

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash } });
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = intentFailure();
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = foreignError();
    vi.spyOn(sodax.migration, 'createMigrateIcxToSodaIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(okIntent)
      .mockRejectedValueOnce(outOfUnion);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', cause: relayError, context: { action: 'migrateIcxToSoda' } },
    });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'migrateIcxToSoda' } },
    });
  });
});

describe('MigrationService.revertMigrateSodaToIcx', () => {
  const run = () =>
    sodax.migration.revertMigrateSodaToIcx({ params: icxRevertParams(), raw: false, walletProvider: mockEvmProvider });

  it('on success, returns { srcChainTxHash, dstChainTxHash } and relays via Sonic', async () => {
    vi.spyOn(sodax.migration, 'createRevertSodaToIcxMigrationIntent').mockResolvedValueOnce(okIntent);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await run();

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash } });
    // Revert always runs from the hub (Sonic) — relay must use SONIC_MAINNET.
    expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]?.chainKey).toBe(ChainKeys.SONIC_MAINNET);
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = intentFailure();
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = foreignError();
    vi.spyOn(sodax.migration, 'createRevertSodaToIcxMigrationIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(okIntent)
      .mockRejectedValueOnce(outOfUnion);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', cause: relayError, context: { action: 'revertMigrateSodaToIcx' } },
    });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'revertMigrateSodaToIcx' } },
    });
  });
});

describe('MigrationService.migrateBaln', () => {
  const run = () =>
    sodax.migration.migrateBaln({ params: balnMigrateParams(), raw: false, walletProvider: mockIconProvider });

  it('on success, returns { srcChainTxHash, dstChainTxHash } and relays via ICON', async () => {
    vi.spyOn(sodax.migration, 'createMigrateBalnIntent').mockResolvedValueOnce(okIntent);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await run();

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash } });
    // BALN swap is initiated from ICON; relay must reflect that.
    expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]?.chainKey).toBe(ChainKeys.ICON_MAINNET);
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = intentFailure();
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = foreignError();
    vi.spyOn(sodax.migration, 'createMigrateBalnIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(okIntent)
      .mockRejectedValueOnce(outOfUnion);
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'RELAY_TIMEOUT', cause: relayError, context: { action: 'migrateBaln' } },
    });
    expect(await run()).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_FAILED', cause: outOfUnion, context: { action: 'migrateBaln' } },
    });
  });
});

// =========================================================================
// createMigrateBalnIntent — spoke deposit + sub-service swapData
// =========================================================================

const rawDepositTx = { from: 'src', to: 'dst', value: 0n, data: '0x' };

describe('MigrationService.createMigrateBalnIntent', () => {
  it('forwards balnSwapService.swapData output to spoke.deposit, with the walletProvider only when raw=false', async () => {
    const swapDataSpy = vi.spyOn(sodax.migration.balnSwapService, 'swapData').mockReturnValue('0xbaln-data');
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: spokeTxHash })
      .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

    const result = await sodax.migration.createMigrateBalnIntent({
      params: balnMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });
    const rawResult = await sodax.migration.createMigrateBalnIntent({ params: balnMigrateParams(), raw: true });

    expect(result).toEqual({
      ok: true,
      value: { tx: spokeTxHash, relayData: { address: hubWalletAddress, payload: '0xbaln-data' } },
    });
    expect(swapDataSpy).toHaveBeenCalledTimes(2);
    expect(depositSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.ICON_MAINNET,
      to: hubWalletAddress,
      data: '0xbaln-data',
      raw: false,
      walletProvider: mockIconProvider,
    });
    expect(rawResult.ok).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('forwards a deposit failure as Result.error', async () => {
    vi.spyOn(sodax.migration.balnSwapService, 'swapData').mockReturnValueOnce('0xbaln-data');
    const depositError = new Error('DEPOSIT_REJECTED');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const result = await sodax.migration.createMigrateBalnIntent({
      params: balnMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: depositError.message }) });
  });

  it('returns ok:false when getUserHubWalletAddress rejects or balnSwapService.swapData throws', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const swapDataError = new Error('BALN_TOKEN_NOT_FOUND');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.migration.balnSwapService, 'swapData')
      .mockReturnValueOnce('0xbaln-data')
      .mockImplementationOnce(() => {
        throw swapDataError;
      });
    const run = () =>
      sodax.migration.createMigrateBalnIntent({
        params: balnMigrateParams(),
        raw: false,
        walletProvider: mockIconProvider,
      });

    expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: hubError.message }) });
    expect(await run()).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: swapDataError.message }),
    });
  });
});

// =========================================================================
// createMigratebnUSDIntent — heaviest method, branches on legacy/new + chain key
// =========================================================================

describe('MigrationService.createMigratebnUSDIntent — happy paths', () => {
  it('on legacy→new (Icon→Sonic), calls migrateData and deposits, with the walletProvider only when raw=false', async () => {
    const params = bnUSDLegacyToNewParams();
    const migrateDataSpy = vi
      .spyOn(sodax.migration.bnUSDMigrationService, 'migrateData')
      .mockReturnValue('0xbnusd-migrate-data');
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: spokeTxHash })
      .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

    const result = await sodax.migration.createMigratebnUSDIntent({
      params,
      raw: false,
      walletProvider: mockIconProvider,
    });
    const rawResult = await sodax.migration.createMigratebnUSDIntent({ params, raw: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tx).toBe(spokeTxHash);
      // RelayExtraData is { address, payload } — payload must be the migrationData we built.
      expect(result.value.relayData).toEqual({ address: hubWalletAddress, payload: '0xbnusd-migrate-data' });
    }
    expect(migrateDataSpy).toHaveBeenCalledTimes(2);
    expect(mocks.encodeAddress).toHaveBeenCalledWith(params.dstChainKey, params.dstAddress);
    expect(depositSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.ICON_MAINNET,
      to: hubWalletAddress,
      token: params.srcbnUSD,
      amount: params.amount,
      data: '0xbnusd-migrate-data',
    });
    expect(rawResult.ok).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('on new→legacy (Sonic→Icon), calls bnUSDMigrationService.revertMigrationData', async () => {
    const revertDataSpy = vi
      .spyOn(sodax.migration.bnUSDMigrationService, 'revertMigrationData')
      .mockReturnValueOnce('0xbnusd-revert-data');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: spokeTxHash });

    const result = await sodax.migration.createMigratebnUSDIntent({
      params: bnUSDNewToLegacyParams(),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result.ok).toBe(true);
    expect(revertDataSpy).toHaveBeenCalledTimes(1);
  });

  it('skips invariants when unchecked=true', async () => {
    // Force the spoke chain key check to false; with unchecked=true the call still succeeds.
    vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(false);
    vi.spyOn(sodax.migration.bnUSDMigrationService, 'migrateData').mockReturnValueOnce('0xdata');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: spokeTxHash });

    const result = await sodax.migration.createMigratebnUSDIntent({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
      unchecked: true,
    });

    expect(result.ok).toBe(true);
  });
});

describe('MigrationService.createMigratebnUSDIntent — invariant failures', () => {
  const create = (params: UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET>) =>
    sodax.migration.createMigratebnUSDIntent({ params, raw: false, walletProvider: mockIconProvider });

  it('rejects an invalid source or destination spoke chain key', async () => {
    vi.spyOn(sodax.config, 'isValidSpokeChainKey')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(failureText(await create(bnUSDLegacyToNewParams()))).toMatch(/Invalid spoke source chain key/);
    expect(failureText(await create(bnUSDLegacyToNewParams()))).toMatch(/Invalid spoke destination chain key/);
  });

  it('rejects an empty srcbnUSD / dstbnUSD / dstAddress and a zero amount', async () => {
    const cases: [Partial<UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET>>, RegExp][] = [
      [{ srcbnUSD: '' }, /Legacy bnUSD token address is required/],
      [{ dstbnUSD: '' }, /New bnUSD token address is required/],
      [{ amount: 0n }, /Amount must be greater than 0/],
      [{ dstAddress: '' }, /Recipient address is required/],
    ];
    for (const [override, message] of cases) {
      const result = await create({ ...bnUSDLegacyToNewParams(), ...override });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(String(result.error)).toMatch(message);
    }
  });

  it('rejects both-legacy pairs, and neither-legacy pairs even when unchecked=true', async () => {
    const bothLegacy = await create({ ...bnUSDLegacyToNewParams(), dstbnUSD: iconBnUSDAddress });
    expect(failureText(bothLegacy)).toMatch(/cannot both be legacy bnUSD tokens/);

    // With unchecked=true the invariant block is skipped; the explicit legacy-token check still throws.
    const neitherLegacy = await sodax.migration.createMigratebnUSDIntent({
      params: { ...bnUSDNewToLegacyParams(), srcbnUSD: sonicBnUSDAddress, dstbnUSD: sonicBnUSDAddress },
      raw: false,
      walletProvider: mockEvmProvider,
      unchecked: true,
    });
    expect(failureText(neitherLegacy)).toMatch(/srcbnUSD or dstbnUSD must be a legacy bnUSD token/);
  });
});

describe('MigrationService.createMigratebnUSDIntent — error propagation', () => {
  it('returns ok:false when getUserHubWalletAddress rejects or migrateData throws', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const dataError = new Error('HUB_ASSET_NOT_FOUND');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.migration.bnUSDMigrationService, 'migrateData')
      .mockReturnValueOnce('0xdata')
      .mockImplementationOnce(() => {
        throw dataError;
      });
    const run = () =>
      sodax.migration.createMigratebnUSDIntent({
        params: bnUSDLegacyToNewParams(),
        raw: false,
        walletProvider: mockIconProvider,
      });

    expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: hubError.message }) });
    expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: dataError.message }) });
  });

  it('forwards a deposit failure as Result.error', async () => {
    vi.spyOn(sodax.migration.bnUSDMigrationService, 'migrateData').mockReturnValueOnce('0xdata');
    const depositError = new Error('DEPOSIT_FAILED');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const result = await sodax.migration.createMigratebnUSDIntent({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: depositError.message }) });
  });
});

// =========================================================================
// createMigrateIcxToSodaIntent — invariants + liquidity check + deposit
// =========================================================================

const ampleLiquidity = { ok: true, value: 10_000_000_000_000_000_000n } as const;

describe('MigrationService.createMigrateIcxToSodaIntent', () => {
  it('returns the deposit tx hash when all invariants pass, with the walletProvider only when raw=false', async () => {
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValue(ampleLiquidity);
    vi.spyOn(sodax.migration.icxMigration, 'migrateData').mockReturnValue('0xicx-migrate-data');
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: spokeTxHash })
      .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

    const result = await sodax.migration.createMigrateIcxToSodaIntent({
      params: icxMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });
    const rawResult = await sodax.migration.createMigrateIcxToSodaIntent({ params: icxMigrateParams(), raw: true });

    expect(result).toEqual({
      ok: true,
      value: { tx: spokeTxHash, relayData: { address: hubWalletAddress, payload: '0xicx-migrate-data' } },
    });
    expect(depositSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.ICON_MAINNET,
      to: hubWalletAddress,
      token: wICXAddress,
      data: '0xicx-migrate-data',
    });
    expect(rawResult.ok).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('rejects a zero amount, a non-EVM recipient, a non-ICX token and a non-Icon source chain', async () => {
    const cases: [IcxMigrateParams, RegExp][] = [
      [{ ...icxMigrateParams(), amount: 0n }, /Amount must be greater than 0/],
      [{ ...icxMigrateParams(), dstAddress: '0xinvalid' as Address }, /Recipient address is required/],
      [
        { ...icxMigrateParams(), address: 'cx1234567890abcdef1234567890abcdef12345678' as IcxTokenType },
        /Token must be wICX or native ICX/,
      ],
      [
        // Cast: the type forbids this, but the runtime invariant is the safety net.
        { ...icxMigrateParams(), srcChainKey: ChainKeys.SONIC_MAINNET as unknown as typeof ChainKeys.ICON_MAINNET },
        /Source chain key must be an Icon chain/,
      ],
    ];
    for (const [params, message] of cases) {
      const result = await sodax.migration.createMigrateIcxToSodaIntent({
        params,
        raw: false,
        walletProvider: mockIconProvider,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(String(result.error)).toMatch(message);
    }
  });

  it('returns ok:false when available liquidity is below requested amount', async () => {
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValueOnce({ ok: true, value: 1n });

    const result = await sodax.migration.createMigrateIcxToSodaIntent({
      params: icxMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toMatch(/Insufficient liquidity/);
    }
  });

  it('wraps a getAvailableAmount failure as MIGRATION_INTENT_CREATION_FAILED with cause', async () => {
    // A plain Error stands in for the typed MigrationLookupError; Lookup ⊄ Create-narrow union, so it is wrapped.
    const liquidityError = new Error('LIQUIDITY_LOOKUP_FAILED');
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValueOnce({
      ok: false,
      error: liquidityError as never,
    });

    const result = await sodax.migration.createMigrateIcxToSodaIntent({
      params: icxMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(result.error.cause).toBe(liquidityError);
    expect(result.error.context?.phase).toBe('intentCreation');
    expect(result.error.context?.action).toBe('migrateIcxToSoda');
  });

  it('forwards a deposit failure as Result.error', async () => {
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValueOnce(ampleLiquidity);
    vi.spyOn(sodax.migration.icxMigration, 'migrateData').mockReturnValueOnce('0xicx-data');
    const depositError = new Error('DEPOSIT_FAILED');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const result = await sodax.migration.createMigrateIcxToSodaIntent({
      params: icxMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: depositError.message }) });
  });

  it('returns ok:false when getUserHubWalletAddress rejects', async () => {
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValueOnce(ampleLiquidity);
    const hubError = new Error('HUB_LOOKUP_FAILED');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);

    const result = await sodax.migration.createMigrateIcxToSodaIntent({
      params: icxMigrateParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: hubError.message }) });
  });
});

// =========================================================================
// createRevertSodaToIcxMigrationIntent
// =========================================================================

describe('MigrationService.createRevertSodaToIcxMigrationIntent', () => {
  it('builds revertMigration data and deposits via the Sonic spoke, with the walletProvider only when raw=false', async () => {
    const revertMigrationSpy = vi
      .spyOn(sodax.migration.icxMigration, 'revertMigration')
      .mockReturnValue('0xrevert-data');
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: spokeTxHash })
      .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

    const result = await sodax.migration.createRevertSodaToIcxMigrationIntent({
      params: icxRevertParams(),
      raw: false,
      walletProvider: mockEvmProvider,
    });
    const rawResult = await sodax.migration.createRevertSodaToIcxMigrationIntent({
      params: icxRevertParams(),
      raw: true,
    });

    expect(result).toEqual({
      ok: true,
      value: { tx: spokeTxHash, relayData: { address: hubWalletAddress, payload: '0xrevert-data' } },
    });
    expect(revertMigrationSpy.mock.calls[0]?.[0]).toMatchObject({
      wICX: sodax.config.sodaxConfig.chains[ChainKeys.ICON_MAINNET].addresses.wICX,
      amount: icxRevertParams().amount,
      userWallet: hubWalletAddress,
    });
    expect(mocks.encodeAddress).toHaveBeenCalledWith(ChainKeys.ICON_MAINNET, iconEoaAddress);
    expect(depositSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      to: hubWalletAddress,
      token: sodax.hubProvider.chainConfig.addresses.sodaToken,
      data: '0xrevert-data',
    });
    expect(rawResult.ok).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('returns ok:false when getUserHubWalletAddress rejects or icxMigration.revertMigration throws', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const revertError = new Error('REVERT_DATA_FAILED');
    mocks.getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.migration.icxMigration, 'revertMigration').mockImplementationOnce(() => {
      throw revertError;
    });
    const run = () =>
      sodax.migration.createRevertSodaToIcxMigrationIntent({
        params: icxRevertParams(),
        raw: false,
        walletProvider: mockEvmProvider,
      });

    expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: hubError.message }) });
    expect(await run()).toMatchObject({ ok: false, error: expect.objectContaining({ message: revertError.message }) });
  });

  it('forwards a deposit failure as Result.error', async () => {
    vi.spyOn(sodax.migration.icxMigration, 'revertMigration').mockReturnValueOnce('0xrevert-data');
    const depositError = new Error('DEPOSIT_FAILED');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const result = await sodax.migration.createRevertSodaToIcxMigrationIntent({
      params: icxRevertParams(),
      raw: false,
      walletProvider: mockEvmProvider,
    });

    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ message: depositError.message }) });
  });
});
