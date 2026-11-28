/**
 * Tests for the MigrationService public API, through one `new Sodax()` instance (`sodax.migration` is the SUT).
 *
 * The network-touching relay helpers and `encodeAddress` are spied on their source module namespaces, and the
 * hub provider, spoke service and sub-services (icxMigration, bnUSDMigrationService, balnSwapService) are spied
 * per test. MigrationService is the facade over those sub-services, which have their own tests; here we only
 * verify the orchestration on top of them.
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  ChainKeys,
  type Address,
  type IconEoaAddress,
  type IcxTokenType,
  type IIconWalletProvider,
} from '@sodax/types';
import { SodaxError } from '../errors/SodaxError.js';
import { Sodax } from '../shared/entities/Sodax.js';
import * as IntentRelayApiService from '../shared/services/intentRelay/IntentRelayApiService.js';
import type { PacketData } from '../shared/types/relay-types.js';
import * as sharedUtils from '../shared/utils/shared-utils.js';
import { expectErr, expectOk } from '../test-utils/result.js';
import {
  mockEvmWalletProvider,
  mockSolanaWalletProvider,
  mockStellarWalletProvider,
} from '../test-utils/walletProviders.js';
import type { IcxMigrateParams, IcxCreateRevertMigrationParams } from './IcxMigrationService.js';
import type { UnifiedBnUSDMigrateParams } from './BnUSDMigrationService.js';
import { LockupPeriod, type BalnMigrateParams } from './BalnSwapService.js';

// --- test fixtures --------------------------------------------------------

const sodax = new Sodax();

const mockEvmProvider = mockEvmWalletProvider();
const mockStellarProvider = mockStellarWalletProvider();
const mockSolanaProvider = mockSolanaWalletProvider();
const mockIconProvider: IIconWalletProvider = {
  chainType: 'ICON',
  getWalletAddress: vi.fn<IIconWalletProvider['getWalletAddress']>(),
  sendTransaction: vi.fn<IIconWalletProvider['sendTransaction']>(),
  waitForTransactionReceipt: vi.fn<IIconWalletProvider['waitForTransactionReceipt']>(),
};

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

const solanaBnUSDParams = (): UnifiedBnUSDMigrateParams<typeof ChainKeys.SOLANA_MAINNET> => ({
  srcAddress: 'SoLaNaSrCaDdReSs',
  srcChainKey: ChainKeys.SOLANA_MAINNET,
  srcbnUSD: '3rSPCLNEF7Quw4wX8S1NyKivELoyij8eYA2gJwBgt4V5',
  dstChainKey: ChainKeys.ICON_MAINNET,
  dstbnUSD: iconBnUSDAddress,
  amount: 1n,
  dstAddress: iconEoaAddress,
});

const balnMigrateParams = (): BalnMigrateParams => ({
  srcAddress: iconEoaAddress,
  srcChainKey: ChainKeys.ICON_MAINNET,
  amount: 1_000_000_000_000_000_000n,
  lockupPeriod: LockupPeriod.SIX_MONTHS,
  dstAddress: evmAddress,
  stake: true,
});

// Only `dst_tx_hash` is read by MigrationService; the rest is shape padding.
const okPacket: PacketData = {
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

/** Asserts `result` failed with a SodaxError whose message matches `message`. */
const expectFailure = (result: Parameters<typeof expectErr>[0], message: RegExp, label?: string): void => {
  expect(expectErr(result, undefined, undefined, label).message, label).toMatch(message);
};

let relay: MockInstance<typeof IntentRelayApiService.relayTxAndWaitPacket>;
let waitExecuted: MockInstance<typeof IntentRelayApiService.waitUntilIntentExecuted>;
let encodeAddress: MockInstance<typeof sharedUtils.encodeAddress>;
let getUserHubWalletAddress: MockInstance<typeof sodax.hubProvider.getUserHubWalletAddress>;
let getUserRouter: MockInstance<typeof sodax.hubProvider.getUserRouter>;

beforeEach(() => {
  // The default config doesn't know every chain-token pair used here; tests override it for specific failures.
  vi.spyOn(sodax.config, 'isValidSpokeChainKey').mockReturnValue(true);
  getUserHubWalletAddress = vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(hubWalletAddress);
  getUserRouter = vi.spyOn(sodax.hubProvider, 'getUserRouter').mockResolvedValue(userRouterAddress);
  vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  relay = vi
    .spyOn(IntentRelayApiService, 'relayTxAndWaitPacket')
    .mockRejectedValue(new Error('relayTxAndWaitPacket not stubbed'));
  waitExecuted = vi
    .spyOn(IntentRelayApiService, 'waitUntilIntentExecuted')
    .mockRejectedValue(new Error('waitUntilIntentExecuted not stubbed'));
  // The real codec is chain-specific; we only check that the dst address is forwarded through it.
  encodeAddress = vi.spyOn(sharedUtils, 'encodeAddress').mockImplementation((_chainKey, addr) => `0xencoded:${addr}`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// isAllowanceValid
// =========================================================================

describe('MigrationService.isAllowanceValid — migrate', () => {
  it('returns ok:true without a spoke check for ICX/BALN on Icon and for bnUSD on chains without allowances (Solana)', async () => {
    const isAllowanceValidSpy = vi.spyOn(sodax.spoke, 'isAllowanceValid');
    // Not Icon (so not the icx/baln short-circuit), not EVM, not Stellar — falls through to "no allowance required".
    const solanaToSonic = {
      ...solanaBnUSDParams(),
      dstChainKey: ChainKeys.SONIC_MAINNET,
      dstbnUSD: sonicBnUSDAddress,
      dstAddress: evmAddress,
    };

    expect(await sodax.migration.isAllowanceValid(icxMigrateParams(), 'migrate')).toEqual({ ok: true, value: true });
    expect(await sodax.migration.isAllowanceValid(balnMigrateParams(), 'migrate')).toEqual({ ok: true, value: true });
    expect(await sodax.migration.isAllowanceValid(solanaToSonic, 'migrate')).toEqual({ ok: true, value: true });
    expect(isAllowanceValidSpy).not.toHaveBeenCalled();
  });

  it('delegates to spoke.isAllowanceValid for bnUSD migration on EVM spoke', async () => {
    const params = bnUSDEvmSpokeParams();
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'migrate');

    expect(result).toEqual({ ok: true, value: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
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
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
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
});

describe('MigrationService.isAllowanceValid — revert', () => {
  it('delegates to spoke.isAllowanceValid for ICX revert on Sonic (hub)', async () => {
    const params = icxRevertParams();
    getUserHubWalletAddress.mockResolvedValueOnce(userRouterAddress);
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      token: sodax.hubProvider.chainConfig.addresses.sodaToken,
      amount: params.amount,
      owner: params.srcAddress,
      spender: userRouterAddress,
    });
  });

  it('uses hubProvider.getUserRouter to derive the spender for bnUSD revert on hub', async () => {
    const params = bnUSDNewToLegacyParams();
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(params, 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(getUserRouter).toHaveBeenCalledWith(params.srcAddress);
    expect(spy.mock.calls[0]?.[0]).toHaveProperty('spender', userRouterAddress);
  });

  it('uses assetManager as spender for bnUSD revert on EVM spoke (non-hub)', async () => {
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(bnUSDEvmSpokeParams(), 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(getUserRouter).not.toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[0]).toHaveProperty(
      'spender',
      sodax.config.sodaxConfig.chains[ChainKeys.BSC_MAINNET].addresses.assetManager,
    );
  });

  it('delegates to spoke.isAllowanceValid for bnUSD revert on Stellar', async () => {
    const spy = vi.spyOn(sodax.spoke, 'isAllowanceValid').mockResolvedValueOnce({ ok: true, value: true });

    const result = await sodax.migration.isAllowanceValid(bnUSDStellarParams(), 'revert');

    expect(result).toEqual({ ok: true, value: true });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty('spender');
  });
});

describe('MigrationService.isAllowanceValid — invalid input and errors', () => {
  it('refuses a zero amount and an empty dstAddress for migrate and revert, and an unknown action', async () => {
    const cases = [
      {
        label: 'migrate, zero amount',
        run: () => sodax.migration.isAllowanceValid({ ...icxMigrateParams(), amount: 0n }, 'migrate'),
        message: /Amount must be greater than 0/,
      },
      {
        label: 'migrate, empty dstAddress',
        run: () => sodax.migration.isAllowanceValid({ ...icxMigrateParams(), dstAddress: '' as Address }, 'migrate'),
        message: /To address is required/,
      },
      {
        label: 'revert, zero amount',
        run: () => sodax.migration.isAllowanceValid({ ...icxRevertParams(), amount: 0n }, 'revert'),
        message: /Amount must be greater than 0/,
      },
      {
        label: 'revert, empty dstAddress',
        run: () =>
          sodax.migration.isAllowanceValid({ ...icxRevertParams(), dstAddress: '' as IconEoaAddress }, 'revert'),
        message: /To address is required/,
      },
      {
        label: 'unknown action',
        // Cast past the union to reach the runtime guard against bad callers.
        run: () => sodax.migration.isAllowanceValid(icxMigrateParams(), 'wrong' as unknown as 'migrate'),
        message: /Invalid action/,
      },
    ];
    for (const { label, run, message } of cases) expectFailure(await run(), message, label);
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
    expectOk(rawResult);
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
    expectOk(rawResult);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
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
    expect(getUserRouter).not.toHaveBeenCalled();
    expect(approveSpy.mock.calls[0]?.[0]).toHaveProperty(
      'spender',
      sodax.config.sodaxConfig.chains[ChainKeys.BSC_MAINNET].addresses.assetManager,
    );
    expectOk(rawResult);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('approves ICX revert on Sonic (hub) — SODA token, user wallet as spender, walletProvider only when raw=false', async () => {
    const params = icxRevertParams();
    getUserHubWalletAddress.mockResolvedValue(userRouterAddress);
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
    expectOk(rawResult);
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

    expectOk(result);
    const call = approveSpy.mock.calls[0]?.[0];
    expect(call?.srcChainKey).toBe(ChainKeys.STELLAR_MAINNET);
    expect(call).not.toHaveProperty('spender');
    expectOk(rawResult);
    expect(approveSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(approveSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });
});

describe('MigrationService.approve — invalid input and errors', () => {
  it('refuses mismatched wallet providers, unsupported chains, a zero amount and an unknown action', async () => {
    type ApproveArgs = Parameters<typeof sodax.migration.approve>[0];
    const cases = [
      {
        label: 'migrate, EVM params with a Stellar provider',
        // Cast past the compile-time narrowing to reach the runtime provider check.
        run: () =>
          sodax.migration.approve(
            {
              params: bnUSDEvmSpokeParams(),
              raw: false,
              walletProvider: mockStellarProvider,
            } as unknown as ApproveArgs,
            'migrate',
          ),
        message: /Invalid wallet provider/,
      },
      {
        label: 'migrate, Stellar params with an EVM provider',
        // Cast past the compile-time narrowing to reach the runtime provider check.
        run: () =>
          sodax.migration.approve(
            { params: bnUSDStellarParams(), raw: false, walletProvider: mockEvmProvider } as unknown as ApproveArgs,
            'migrate',
          ),
        message: /Invalid wallet provider/,
      },
      {
        label: 'migrate, neither EVM spoke nor Stellar (Solana)',
        run: () =>
          sodax.migration.approve(
            { params: solanaBnUSDParams(), raw: false, walletProvider: mockSolanaProvider },
            'migrate',
          ),
        message: /Invalid params for migrate action/,
      },
      {
        label: 'migrate, zero amount',
        run: () =>
          sodax.migration.approve(
            { params: { ...bnUSDEvmSpokeParams(), amount: 0n }, raw: false, walletProvider: mockEvmProvider },
            'migrate',
          ),
        message: /Amount must be greater than 0/,
      },
      {
        // The bnUSD branch uses `isEvmSpokeOnlyChainKeyType`, which excludes Sonic, so a Sonic→Icon bnUSD
        // revert falls through like Solana does. The hub-side ternary inside that branch is unreachable.
        label: 'revert, bnUSD on Sonic (hub)',
        run: () =>
          sodax.migration.approve(
            { params: bnUSDNewToLegacyParams(), raw: false, walletProvider: mockEvmProvider },
            'revert',
          ),
        message: /Invalid params or chain type for revert action/,
      },
      {
        label: 'revert, bnUSD on Solana',
        run: () =>
          sodax.migration.approve(
            { params: solanaBnUSDParams(), raw: false, walletProvider: mockSolanaProvider },
            'revert',
          ),
        message: /Invalid params or chain type for revert action/,
      },
      {
        label: 'unknown action',
        run: () =>
          sodax.migration.approve(
            { params: bnUSDEvmSpokeParams(), raw: false, walletProvider: mockEvmProvider },
            // Cast past the union to reach the runtime guard against bad callers.
            'wrong' as unknown as 'migrate',
          ),
        message: /Invalid action/,
      },
    ];
    for (const { label, run, message } of cases) expectFailure(await run(), message, label);
  });

  it('wraps a spoke.approve failure, returned (migrate) or thrown (revert), keeping its message', async () => {
    const returnedError = new Error('APPROVE_REJECTED');
    const thrownError = new Error('SPOKE_APPROVE_THROWS');
    vi.spyOn(sodax.spoke, 'approve')
      .mockResolvedValueOnce({ ok: false, error: returnedError })
      .mockRejectedValueOnce(thrownError);
    const run = (action: 'migrate' | 'revert') =>
      sodax.migration.approve({ params: bnUSDEvmSpokeParams(), raw: false, walletProvider: mockEvmProvider }, action);

    expect(await run('migrate')).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: returnedError.message }),
    });
    expect(await run('revert')).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: thrownError.message }),
    });
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
    relay.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await sodax.migration.migratebnUSD({
      params: bnUSDLegacyToNewParams(),
      raw: false,
      walletProvider: mockIconProvider,
    });

    expect(expectOk(result)).toEqual({ srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash });
    // Sonic on either end → relay packet is the final step. Skip the hub→spoke wait.
    expect(waitExecuted).not.toHaveBeenCalled();
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
    relay.mockResolvedValueOnce({ ok: true, value: okPacket });
    waitExecuted.mockResolvedValueOnce({ ok: true, value: okPacket });

    await sodax.migration.migratebnUSD({
      params: stellarToIcon,
      raw: false,
      walletProvider: mockStellarProvider,
    });

    expect(waitExecuted).toHaveBeenCalledTimes(1);
    const waitCall = waitExecuted.mock.calls[0]?.[0];
    // Hub→spoke wait runs with the hub tx hash from the packet we just received.
    expect(waitCall?.srcTxHash).toBe(okPacket.dst_tx_hash);
    expect(waitCall?.apiUrl).toBe(sodax.migration.relayerApiEndpoint);
  });

  it('forwards an intent failure, maps verify, relay and destination-execution failures, and wraps a foreign SodaxError', async () => {
    // CreateMigrateIntentErrorCode ⊂ MigrateOrchestrationErrorCode, so the intent error is returned unwrapped.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'spoke deposit reverted', {
      feature: 'migration',
      context: { srcChainKey: ChainKeys.ICON_MAINNET, action: 'migratebnUSD', phase: 'intentCreation' },
    });
    const verifyError = new Error('TX_NOT_FOUND');
    const relayError = new Error('RELAY_TIMEOUT');
    const execError = new Error('RELAY_TIMEOUT');
    // The `isMigrateOrchestrationError` guard rejects codes outside the forward-orchestrator union.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into migration', {
      feature: 'migration',
    });
    vi.spyOn(sodax.migration, 'createMigratebnUSDIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(okIntent)
      .mockResolvedValueOnce(okIntent)
      .mockResolvedValueOnce(okIntent)
      .mockRejectedValueOnce(outOfUnion);
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });
    relay.mockResolvedValueOnce({ ok: false, error: relayError }).mockResolvedValueOnce({ ok: true, value: okPacket });
    waitExecuted.mockResolvedValueOnce({ ok: false, error: execError });
    const run = (params: UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET> = bnUSDLegacyToNewParams()) =>
      sodax.migration.migratebnUSD({ params, raw: false, walletProvider: mockIconProvider });

    const intentFailure = expectErr(await run(), 'INTENT_CREATION_FAILED', undefined, 'intent');
    expect(intentFailure).toBe(intentError);

    const verifyFailure = expectErr(await run(), 'TX_VERIFICATION_FAILED', { phase: 'verify', action: 'migratebnUSD' });
    expect(verifyFailure.cause).toBe(verifyError);
    expect(relay).not.toHaveBeenCalled();

    const relayFailure = expectErr(await run(), 'RELAY_TIMEOUT', {
      action: 'migratebnUSD',
      relayCode: 'RELAY_TIMEOUT',
    });
    expect(relayFailure.cause).toBe(relayError);

    // The secondary watcher fires only when NEITHER src NOR dst is Sonic (ICON→SUI here), tagged `destinationExecution`.
    const iconToSui = { ...bnUSDLegacyToNewParams(), dstChainKey: ChainKeys.SUI_MAINNET } as ReturnType<
      typeof bnUSDLegacyToNewParams
    >;
    const execFailure = expectErr(await run(iconToSui), 'RELAY_TIMEOUT', {
      phase: 'destinationExecution',
      action: 'migratebnUSD',
      relayCode: 'RELAY_TIMEOUT',
    });
    expect(execFailure.cause).toBe(execError);

    const foreignFailure = expectErr(await run(), 'EXECUTION_FAILED', { action: 'migratebnUSD' });
    expect(foreignFailure.cause).toBe(outOfUnion);
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
    relay.mockResolvedValueOnce({ ok: true, value: okPacket });

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
    relay.mockResolvedValueOnce({ ok: false, error: relayError });

    expect(await run()).toEqual({ ok: false, error: intentError });
    expect(relay).not.toHaveBeenCalled();
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
    relay.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await run();

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash } });
    // Revert always runs from the hub (Sonic) — relay must use SONIC_MAINNET.
    expect(relay.mock.calls[0]?.[0]?.chainKey).toBe(ChainKeys.SONIC_MAINNET);
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = intentFailure();
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = foreignError();
    vi.spyOn(sodax.migration, 'createRevertSodaToIcxMigrationIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(okIntent)
      .mockRejectedValueOnce(outOfUnion);
    relay.mockResolvedValueOnce({ ok: false, error: relayError });

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
    relay.mockResolvedValueOnce({ ok: true, value: okPacket });

    const result = await run();

    expect(result).toEqual({ ok: true, value: { srcChainTxHash: spokeTxHash, dstChainTxHash: hubTxHash } });
    // BALN swap is initiated from ICON; relay must reflect that.
    expect(relay.mock.calls[0]?.[0]?.chainKey).toBe(ChainKeys.ICON_MAINNET);
  });

  it('forwards an intent failure, maps a relay failure, and wraps a foreign SodaxError', async () => {
    const intentError = intentFailure();
    const relayError = new Error('RELAY_TIMEOUT');
    const outOfUnion = foreignError();
    vi.spyOn(sodax.migration, 'createMigrateBalnIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce(okIntent)
      .mockRejectedValueOnce(outOfUnion);
    relay.mockResolvedValueOnce({ ok: false, error: relayError });

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
    expectOk(rawResult);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('returns ok:false when getUserHubWalletAddress rejects, swapData throws or the deposit fails', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const swapDataError = new Error('BALN_TOKEN_NOT_FOUND');
    const depositError = new Error('DEPOSIT_REJECTED');
    getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.migration.balnSwapService, 'swapData')
      .mockReturnValueOnce('0xbaln-data')
      .mockImplementationOnce(() => {
        throw swapDataError;
      })
      .mockReturnValueOnce('0xbaln-data');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });
    const run = () =>
      sodax.migration.createMigrateBalnIntent({
        params: balnMigrateParams(),
        raw: false,
        walletProvider: mockIconProvider,
      });

    for (const error of [hubError, swapDataError, depositError]) {
      expect(await run(), error.message).toMatchObject({
        ok: false,
        error: expect.objectContaining({ message: error.message }),
      });
    }
  });
});

// =========================================================================
// createMigratebnUSDIntent — heaviest method, branches on legacy/new + chain key
// =========================================================================

describe('MigrationService.createMigratebnUSDIntent', () => {
  const create = (params: UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET>) =>
    sodax.migration.createMigratebnUSDIntent({ params, raw: false, walletProvider: mockIconProvider });

  it('on legacy→new (Icon→Sonic), calls migrateData and deposits, with the walletProvider only when raw=false', async () => {
    const params = bnUSDLegacyToNewParams();
    const migrateDataSpy = vi
      .spyOn(sodax.migration.bnUSDMigrationService, 'migrateData')
      .mockReturnValue('0xbnusd-migrate-data');
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: spokeTxHash })
      .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

    const result = await create(params);
    const rawResult = await sodax.migration.createMigratebnUSDIntent({ params, raw: true });

    const value = expectOk(result);
    expect(value.tx).toBe(spokeTxHash);
    // RelayExtraData is { address, payload } — payload must be the migrationData we built.
    expect(value.relayData).toEqual({ address: hubWalletAddress, payload: '0xbnusd-migrate-data' });
    expect(migrateDataSpy).toHaveBeenCalledTimes(2);
    expect(encodeAddress).toHaveBeenCalledWith(params.dstChainKey, params.dstAddress);
    expect(depositSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.ICON_MAINNET,
      to: hubWalletAddress,
      token: params.srcbnUSD,
      amount: params.amount,
      data: '0xbnusd-migrate-data',
    });
    expectOk(rawResult);
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

    expectOk(result);
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

    expectOk(result);
  });

  it('refuses invalid chain keys, missing addresses, a zero amount and pairs that do not migrate', async () => {
    vi.spyOn(sodax.config, 'isValidSpokeChainKey')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    expectFailure(await create(bnUSDLegacyToNewParams()), /Invalid spoke source chain key/, 'invalid source');
    expectFailure(await create(bnUSDLegacyToNewParams()), /Invalid spoke destination chain key/, 'invalid destination');

    const cases: [string, Partial<UnifiedBnUSDMigrateParams<typeof ChainKeys.ICON_MAINNET>>, RegExp][] = [
      ['empty srcbnUSD', { srcbnUSD: '' }, /Legacy bnUSD token address is required/],
      ['empty dstbnUSD', { dstbnUSD: '' }, /New bnUSD token address is required/],
      ['zero amount', { amount: 0n }, /Amount must be greater than 0/],
      ['empty dstAddress', { dstAddress: '' }, /Recipient address is required/],
      ['both legacy', { dstbnUSD: iconBnUSDAddress }, /cannot both be legacy bnUSD tokens/],
    ];
    for (const [label, override, message] of cases) {
      expectFailure(await create({ ...bnUSDLegacyToNewParams(), ...override }), message, label);
    }

    // With unchecked=true the invariant block is skipped; the explicit legacy-token check still throws.
    const neitherLegacy = await sodax.migration.createMigratebnUSDIntent({
      params: { ...bnUSDNewToLegacyParams(), srcbnUSD: sonicBnUSDAddress, dstbnUSD: sonicBnUSDAddress },
      raw: false,
      walletProvider: mockEvmProvider,
      unchecked: true,
    });
    expectFailure(neitherLegacy, /srcbnUSD or dstbnUSD must be a legacy bnUSD token/, 'neither legacy');
  });

  it('returns ok:false when getUserHubWalletAddress rejects, migrateData throws or the deposit fails', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const dataError = new Error('HUB_ASSET_NOT_FOUND');
    const depositError = new Error('DEPOSIT_FAILED');
    getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.migration.bnUSDMigrationService, 'migrateData')
      .mockReturnValueOnce('0xdata')
      .mockImplementationOnce(() => {
        throw dataError;
      })
      .mockReturnValueOnce('0xdata');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    for (const error of [hubError, dataError, depositError]) {
      expect(await create(bnUSDLegacyToNewParams()), error.message).toMatchObject({
        ok: false,
        error: expect.objectContaining({ message: error.message }),
      });
    }
  });
});

// =========================================================================
// createMigrateIcxToSodaIntent — invariants + liquidity check + deposit
// =========================================================================

const ampleLiquidity = { ok: true, value: 10_000_000_000_000_000_000n } as const;

describe('MigrationService.createMigrateIcxToSodaIntent', () => {
  const create = (params: IcxMigrateParams = icxMigrateParams()) =>
    sodax.migration.createMigrateIcxToSodaIntent({ params, raw: false, walletProvider: mockIconProvider });

  it('returns the deposit tx hash when all invariants pass, with the walletProvider only when raw=false', async () => {
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValue(ampleLiquidity);
    vi.spyOn(sodax.migration.icxMigration, 'migrateData').mockReturnValue('0xicx-migrate-data');
    const depositSpy = vi
      .spyOn(sodax.spoke, 'deposit')
      .mockResolvedValueOnce({ ok: true, value: spokeTxHash })
      .mockResolvedValueOnce({ ok: true, value: rawDepositTx });

    const result = await create();
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
    expectOk(rawResult);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('refuses a zero amount, a non-EVM recipient, a non-ICX token, a non-Icon source chain and short liquidity', async () => {
    const cases: [string, IcxMigrateParams, RegExp][] = [
      ['zero amount', { ...icxMigrateParams(), amount: 0n }, /Amount must be greater than 0/],
      [
        'non-EVM recipient',
        { ...icxMigrateParams(), dstAddress: '0xinvalid' as Address },
        /Recipient address is required/,
      ],
      [
        'non-ICX token',
        { ...icxMigrateParams(), address: 'cx1234567890abcdef1234567890abcdef12345678' as IcxTokenType },
        /Token must be wICX or native ICX/,
      ],
      [
        'non-Icon source chain',
        // Cast: the type forbids this, but the runtime invariant is the safety net.
        { ...icxMigrateParams(), srcChainKey: ChainKeys.SONIC_MAINNET as unknown as typeof ChainKeys.ICON_MAINNET },
        /Source chain key must be an Icon chain/,
      ],
    ];
    for (const [label, params, message] of cases) expectFailure(await create(params), message, label);

    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount').mockResolvedValueOnce({ ok: true, value: 1n });
    expectFailure(await create(), /Insufficient liquidity/, 'liquidity below amount');
  });

  it('wraps a liquidity lookup failure, and forwards a hub-wallet rejection and a deposit failure', async () => {
    // A plain Error stands in for the typed MigrationLookupError; Lookup ⊄ Create-narrow union, so it is wrapped.
    const liquidityError = new Error('LIQUIDITY_LOOKUP_FAILED');
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const depositError = new Error('DEPOSIT_FAILED');
    vi.spyOn(sodax.migration.icxMigration, 'getAvailableAmount')
      .mockResolvedValueOnce({ ok: false, error: liquidityError as never })
      .mockResolvedValue(ampleLiquidity);
    vi.spyOn(sodax.migration.icxMigration, 'migrateData').mockReturnValue('0xicx-data');
    getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });

    const lookupFailure = expectErr(await create(), 'INTENT_CREATION_FAILED', {
      phase: 'intentCreation',
      action: 'migrateIcxToSoda',
    });
    expect(lookupFailure.cause).toBe(liquidityError);
    for (const error of [hubError, depositError]) {
      expect(await create(), error.message).toMatchObject({
        ok: false,
        error: expect.objectContaining({ message: error.message }),
      });
    }
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
    expect(encodeAddress).toHaveBeenCalledWith(ChainKeys.ICON_MAINNET, iconEoaAddress);
    expect(depositSpy.mock.calls[0]?.[0]).toMatchObject({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      to: hubWalletAddress,
      token: sodax.hubProvider.chainConfig.addresses.sodaToken,
      data: '0xrevert-data',
    });
    expectOk(rawResult);
    expect(depositSpy.mock.calls[1]?.[0]?.raw).toBe(true);
    expect(depositSpy.mock.calls[1]?.[0]).not.toHaveProperty('walletProvider');
  });

  it('returns ok:false when getUserHubWalletAddress rejects, revertMigration throws or the deposit fails', async () => {
    const hubError = new Error('HUB_LOOKUP_FAILED');
    const revertError = new Error('REVERT_DATA_FAILED');
    const depositError = new Error('DEPOSIT_FAILED');
    getUserHubWalletAddress.mockRejectedValueOnce(hubError);
    vi.spyOn(sodax.migration.icxMigration, 'revertMigration')
      .mockImplementationOnce(() => {
        throw revertError;
      })
      .mockReturnValueOnce('0xrevert-data');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: false, error: depositError });
    const run = () =>
      sodax.migration.createRevertSodaToIcxMigrationIntent({
        params: icxRevertParams(),
        raw: false,
        walletProvider: mockEvmProvider,
      });

    for (const error of [hubError, revertError, depositError]) {
      expect(await run(), error.message).toMatchObject({
        ok: false,
        error: expect.objectContaining({ message: error.message }),
      });
    }
  });
});
