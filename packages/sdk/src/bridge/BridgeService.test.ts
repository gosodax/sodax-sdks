/**
 * Integration tests for the BridgeService `bridge()` orchestrator.
 *
 * Mirrors the fixture pattern established in MoneyMarketService.test.ts:
 *   - `vi.mock` at the source path replaces the static `relayTxAndWaitPacket` import
 *     with a hoisted `vi.fn()` so each test can configure relay outcomes.
 *   - One real `Sodax` instance backs every test; instance methods we want to control
 *     (`sodax.bridge.createBridgeIntent`, `sodax.spoke.verifyTxHash`) are stubbed
 *     per-test with `vi.spyOn(...).mockResolvedValueOnce(...)`.
 *
 * Scope: the 4 wrap-paths in `bridge()` that the unit-level error-types and
 * relay-error-mapping tests don't cover end-to-end:
 *
 *   1. createBridgeIntent failure → propagated unchanged (subset narrowing).
 *   2. verifyTxHash failure → wrapped as `BRIDGE_VERIFY_FAILED` with cause + phase + chains.
 *   3. relayTxAndWaitPacket failure → routed through `mapRelayFailureToBridgeError` and
 *      surfaced as `BRIDGE_RELAY_TIMEOUT` (or peer codes) with cause + relayCode + chains.
 *   4. Out-of-union SodaxError thrown from createBridgeIntent → wrapped as `BRIDGE_FAILED`
 *      (the `isBridgeOrchestrationError` guard's else-branch).
 */

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  AtomicityNotSupportedError,
  AtomicReadyWalletRejectedUpgradeError,
  decodeAbiParameters,
  decodeFunctionData,
  erc20Abi,
  pad,
  parseAbiParameters,
  toEventSelector,
  toHex,
  type TransactionReceipt,
  UserRejectedRequestError,
} from 'viem';
import type {
  Address,
  EvmAtomicBatchSupport,
  EvmBatchResult,
  EvmRawTransaction,
  IEvmWalletProvider,
  PartnerFee,
  SpokeChainKey,
} from '@sodax/types';
import {
  ChainKeys,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_RELAY_TX_TIMEOUT,
  getIntentRelayChainId,
  tronSupportedTokens,
  monadSupportedTokens,
  tonSupportedTokens,
  xrpSupportedTokens,
  hederaSupportedTokens,
} from '@sodax/types';
import { RELAY_FALLBACK_FLOOR_MS } from '../shared/services/intentRelay/IntentRelayApiService.js';
import { EvmVaultTokenService } from '../shared/services/hub/EvmVaultTokenService.js';
import { Sodax } from '../shared/entities/Sodax.js';
import type { XrpDestinationReadiness } from '../shared/services/spoke/XrpSpokeService.js';
import { SodaxError } from '../errors/SodaxError.js';
import { isAuthFailure } from '../errors/guards.js';
import { DETAILED_STATUS_NOT_DELIVERED } from '../backendApi/detailedStatusRouting.js';
import type { DepositRecord } from '../shared/services/mpcRelay/MpcRelayApiService.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import type { BridgeParams, BridgeWithApprovalParams } from './BridgeService.js';
import { ACCOUNT_UPGRADE_DECLINED, ATOMIC_BATCH_UNCONFIRMED } from '../shared/utils/approvalBatch.js';
import { TRON_TEST_ADDRESS } from '../shared/services/spoke/tron-test-fixtures.js';

const mocks = vi.hoisted(() => ({
  relayTxAndWaitPacket: vi.fn(),
  getTransactionPackets: vi.fn(),
  submitTransaction: vi.fn(),
  waitUntilIntentExecuted: vi.fn(),
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
    getTransactionPackets: mocks.getTransactionPackets,
    submitTransaction: mocks.submitTransaction,
    waitUntilIntentExecuted: mocks.waitUntilIntentExecuted,
  };
});

const sodax = new Sodax({ bridge: { useBackendSubmitTx: false } });

// Local SpokeChainKey fixtures. Matches the relay-error-mapping.test.ts pattern: avoids
// the `../../../types/src/...` deep import workaround so tests stay decoupled from the
// chain-config layout in @sodax/types.
const BSC = '0x38.bsc' satisfies SpokeChainKey;
const ARBITRUM = '0xa4b1.arbitrum' satisfies SpokeChainKey;
const SOLANA = 'solana' satisfies SpokeChainKey;

const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const SAMPLE_DST = '0x5555555555555555555555555555555555555555' as Address;
const SAMPLE_TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address;

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

const bridgeInput = <K extends SpokeChainKey>(
  srcChainKey: K,
  dstChainKey: SpokeChainKey,
  timeout?: number,
): BridgeParams<K, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    timeout,
    params: {
      srcAddress: SAMPLE_USER,
      srcChainKey,
      srcToken: SAMPLE_TOKEN,
      amount: 1_000_000n,
      dstChainKey,
      dstToken: SAMPLE_TOKEN,
      recipient: SAMPLE_DST,
    },
  }) as BridgeParams<K, false>;

beforeEach(() => {
  // No defaults needed — every test stubs the collaborators it cares about. The Sodax
  // wiring is real and untouched.
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// =========================================================================
// Bitcoin USER mode — createBridgeIntent invariants
// =========================================================================

const BTC = ChainKeys.BITCOIN_MAINNET;
// Must be checksum-valid: encodeAddress rejects malformed Bitcoin recipients.
const BTC_USER_ADDR = 'bc1qzy3rx3z4vemc3xgqzy3rx3z4vemc3xgq20evkx';
const BTC_TOKEN = '0:0';
const HUB_BTC_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;

const mockBtcProvider = {
  chainType: 'BITCOIN',
  signTransaction: vi.fn(),
  signEcdsaMessage: vi.fn(),
  signBip322Message: vi.fn(),
  sendBitcoin: vi.fn(),
  getWalletAddress: vi.fn(),
  getPublicKey: vi.fn(),
};

const btcBridgeInput = (): BridgeParams<typeof BTC, false> =>
  ({
    raw: false,
    walletProvider: mockBtcProvider,
    params: {
      srcAddress: BTC_USER_ADDR,
      srcChainKey: BTC,
      srcToken: BTC_TOKEN,
      amount: 100_000n,
      dstChainKey: BSC,
      dstToken: SAMPLE_TOKEN,
      recipient: SAMPLE_DST,
    },
  }) as BridgeParams<typeof BTC, false>;

describe('BridgeService.getFee — global-fee fallback', () => {
  it('falls back to the global fee, charges a per-call partnerFee, and 0n when no fee is configured', () => {
    // Regression: a global `fee` with no `bridge.partnerFee` must still be charged — the effective
    // bridge fee is `bridge.partnerFee ?? fee` (via config.bridgePartnerFee), so a global-only fee
    // is no longer silently dropped. `fee` is a typed SodaxOptions slot — no cast needed.
    const sodaxWithGlobalFee = new Sodax({
      fee: { address: '0x3333333333333333333333333333333333333333', percentage: 100 },
    });

    expect(sodaxWithGlobalFee.bridge.getFee(1_000_000n)).toBeGreaterThan(0n);

    // `sodax` has no configured fee; a per-call partnerFee is charged instead. 100 bps of 1_000_000 = 10_000.
    const perCall = { address: '0x4444444444444444444444444444444444444444', percentage: 100 } as const;
    expect(sodax.bridge.getFee(1_000_000n, perCall)).toBe(10_000n);
    expect(sodax.bridge.getFee(1_000_000n)).toBe(0n);
  });
});

describe('BridgeService.createBridgeIntent — Bitcoin USER mode', () => {
  let ensureRadfiSpy: MockInstance<typeof sodax.spoke.bitcoin.radfi.ensureRadfiAccessToken>;
  let depositSpy: MockInstance<typeof sodax.spoke.deposit>;

  beforeEach(() => {
    Object.defineProperty(sodax.spoke.bitcoin, 'walletMode', { value: 'USER', configurable: true });

    vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress').mockResolvedValue(BTC_USER_ADDR);
    ensureRadfiSpy = vi.spyOn(sodax.spoke.bitcoin.radfi, 'ensureRadfiAccessToken').mockResolvedValue(undefined);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_BTC_WALLET);
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: BTC_TOKEN,
      vault: '0xvault',
      symbol: 'BTC',
    } as never);
    // Short-circuit data encoding — the test only cares about the Bitcoin wiring before buildBridgeData.
    vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata');
    depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({
      ok: true,
      value: 'btctxhash',
    });
  });

  afterEach(() => {
    Object.defineProperty(sodax.spoke.bitcoin, 'walletMode', { value: 'TRADING', configurable: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('derives the hub wallet from the personal address, skips Radfi auth and EVM simulation', async () => {
    const getEffectiveSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress');
    const getHubSpy = vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress');

    const result = await sodax.bridge.createBridgeIntent(btcBridgeInput());

    expect(result.ok).toBe(true);
    // Bound Exchange auth is TRADING-only.
    expect(ensureRadfiSpy).not.toHaveBeenCalled();
    // The hub skips EVM simulation for Bitcoin USER deposits.
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ skipSimulation: true }));
    // The personal address (not a trading address) drives hub wallet derivation and the deposit.
    expect(getEffectiveSpy).toHaveBeenCalledWith(BTC_USER_ADDR);
    expect(getHubSpy).toHaveBeenCalledWith(BTC_USER_ADDR, BTC);
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ srcAddress: BTC_USER_ADDR }));
  });

  it('rejects a native-BTC deposit below the 546 sat dust limit', async () => {
    const dustInput = btcBridgeInput();
    const result = await sodax.bridge.createBridgeIntent({
      ...dustInput,
      params: { ...dustInput.params, amount: 100n },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Invalid amount');
      expect(result.error.message).toContain('dust limit');
    }
  });
});

// =========================================================================
// BTC destination — post-fee dust check runs its fee math in hub units
// =========================================================================

describe('BridgeService.createBridgeIntent — BTC destination post-fee dust', () => {
  // The partner fee is charged on the hub in 18-dp vault units (buildBridgeData), so the dust
  // estimate must translate sats → hub units, take the fee there, and translate back. A fixed
  // `PartnerFee.amount` is wei-denominated — treating it as sats either trips the
  // fee<=inputAmount invariant (fee wei >> sats) or inflates the fee by 10^10.
  const btcDestInput = (
    amount: bigint,
    partnerFee?: { address: Address; percentage: number } | { address: Address; amount: bigint },
  ): BridgeParams<typeof BSC, false> =>
    ({
      raw: false,
      walletProvider: mockEvmProvider,
      ...(partnerFee ? { extras: { partnerFee } } : {}),
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: BSC,
        srcToken: SAMPLE_TOKEN,
        amount,
        dstChainKey: BTC,
        dstToken: BTC_TOKEN,
        recipient: BTC_USER_ADDR,
      },
    }) as BridgeParams<typeof BSC, false>;

  const FEE_ADDR = '0x6666666666666666666666666666666666666666' as Address;

  beforeEach(() => {
    // Full XToken shape: the hub-unit dust math reads `decimals` and `hubAsset` off both endpoints.
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: BTC_TOKEN,
      vault: '0xvault',
      symbol: 'BTC',
      decimals: 8,
      hubAsset: '0xbtchub',
    } as never);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_BTC_WALLET);
    vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata');
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xtxhash' });
  });

  it('checks post-fee delivery against dust, taking a fixed fee as wei rather than sats', async () => {
    // 100 bps of 600 sats → 6 sats fee → delivered 594 ≥ 546.
    const percentage = await sodax.bridge.createBridgeIntent(
      btcDestInput(600n, { address: FEE_ADDR, percentage: 100 }),
    );
    expect(percentage.ok).toBe(true);

    // 10^10 wei = exactly 1 sat worth. 547 sats − 1 sat = 546 ≥ 546 → passes. Before the hub-unit
    // fix this path threw `fee.amount <= inputAmount` (10^10 wei vs 547 "sats").
    const fixed = await sodax.bridge.createBridgeIntent(btcDestInput(547n, { address: FEE_ADDR, amount: 10n ** 10n }));
    expect(fixed.ok).toBe(true);

    // 100 bps of 550 sats → delivered 544 < 546; 100 sats worth of fixed fee: 600 − 100 = 500 < 546.
    for (const input of [
      btcDestInput(550n, { address: FEE_ADDR, percentage: 100 }),
      btcDestInput(600n, { address: FEE_ADDR, amount: 100n * 10n ** 10n }),
    ]) {
      const result = await sodax.bridge.createBridgeIntent(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
        expect(result.error.message).toContain('Post-fee');
      }
    }
  });
});

// =========================================================================
// Stacks raw source — srcPublicKey pre-flight guard (parity with SwapService.createIntent)
// =========================================================================

const STACKS = ChainKeys.STACKS_MAINNET;
const STACKS_SRC_ADDR = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7';
const STACKS_TOKEN = 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.token-abtc::abtc';

const stacksRawBridgeInput = (extras?: { srcPublicKey?: string }): BridgeParams<typeof STACKS, true> =>
  ({
    raw: true,
    extras,
    params: {
      srcAddress: STACKS_SRC_ADDR,
      srcChainKey: STACKS,
      srcToken: STACKS_TOKEN,
      amount: 1_000_000n,
      dstChainKey: BSC,
      dstToken: SAMPLE_TOKEN,
      recipient: SAMPLE_DST,
    },
  }) as BridgeParams<typeof STACKS, true>;

// =========================================================================
// buildBridgeData and the BTC-destination dust guard share ONE fee/decimal
// pipeline (`computeBridgeAmounts`). These pin the basis that sharing relies
// on, using REAL config tokens and the real encoder (no buildBridgeData mock),
// so a change to the fee basis or a decimal translation fails here rather than
// silently desynchronizing the guard from what the hub calls withdraw.
// =========================================================================

describe('BridgeService.buildBridgeData — shared fee/decimal basis', () => {
  const FEE_ADDR = '0x6666666666666666666666666666666666666666' as Address;
  const realToken = (chainKey: SpokeChainKey, symbol: string) => {
    const token = sodax.config.findSupportedTokenBySymbol(chainKey, symbol);
    if (!token) throw new Error(`fixture missing: ${symbol} on ${chainKey}`);
    return token;
  };

  it('discovers the hub asset for native MON and TON and refuses to invent a vault limit', async () => {
    const mon = monadSupportedTokens.MON;
    const wrappedMon = { ...mon, chainKey: ChainKeys.SONIC_MAINNET, address: mon.hubAsset };
    const result = sodax.bridge.getBridgeableTokens(mon.chainKey, wrappedMon.chainKey, mon.address);
    expect(result).toMatchObject({ ok: true, value: [wrappedMon] });
    expect(sodax.bridge.isBridgeable({ from: mon, to: wrappedMon })).toBe(true);
    expect(sodax.bridge.isBridgeable({ from: wrappedMon, to: mon })).toBe(true);
    await expect(sodax.bridge.getBridgeableAmount(mon, wrappedMon)).resolves.toMatchObject({
      ok: false,
      error: { cause: expect.objectContaining({ message: expect.stringContaining('No vault limit') }) },
    });

    const ton = tonSupportedTokens.TON;
    const wrappedTon = { ...ton, chainKey: ChainKeys.SONIC_MAINNET, address: ton.hubAsset };
    expect(sodax.bridge.getBridgeableTokens(ton.chainKey, wrappedTon.chainKey, ton.address)).toMatchObject({
      ok: true,
      value: [wrappedTon],
    });
    expect(sodax.bridge.getBridgeableTokens(wrappedTon.chainKey, ton.chainKey, wrappedTon.address)).toMatchObject({
      ok: true,
      value: [ton],
    });
    await expect(sodax.bridge.getBridgeableAmount(ton, wrappedTon)).resolves.toMatchObject({
      ok: false,
      error: { cause: expect.objectContaining({ message: expect.stringContaining('native TON route') }) },
    });
  });

  it('enforces the ZEC, TON and Tron payout floors and the bridge destination chain', () => {
    const token = realToken(ChainKeys.ZCASH_MAINNET, 'ZEC');
    const address = 't1TFab5a31gE6bxzatfs1KSqiportHDCE3X';
    const params = {
      srcChainKey: ChainKeys.ZCASH_MAINNET,
      srcAddress: address,
      srcToken: token.address,
      dstChainKey: ChainKeys.ZCASH_MAINNET,
      dstToken: token.address,
      recipient: address,
      amount: 100_000n,
    };
    expect(() => sodax.bridge.buildBridgeData(params, token, token, undefined)).toThrow(/greater than 0.001 ZEC/);
    expect(sodax.bridge.buildBridgeData({ ...params, amount: 100_001n }, token, token, undefined)).toMatch(
      /^0x[0-9a-f]+$/i,
    );
    expect(() => sodax.bridge.buildBridgeData({ ...params, dstChainKey: ARBITRUM }, token, token, undefined)).toThrow(
      /Payout token chain must match/,
    );

    const tonToken = realToken(ChainKeys.TON_MAINNET, 'USDT');
    const tonParams = {
      srcChainKey: ChainKeys.TON_MAINNET,
      srcAddress: `0x${'12'.repeat(32)}`,
      srcToken: tonToken.address,
      dstChainKey: ChainKeys.TON_MAINNET,
      dstToken: tonToken.address,
      recipient: `0x${'34'.repeat(32)}`,
      amount: 3_000_000n,
    };
    expect(() => sodax.bridge.buildBridgeData(tonParams, tonToken, tonToken, undefined)).toThrow(/greater than 3 USDT/);
    expect(sodax.bridge.buildBridgeData({ ...tonParams, amount: 3_000_001n }, tonToken, tonToken, undefined)).toMatch(
      /^0x[0-9a-f]+$/i,
    );
    expect(() =>
      sodax.bridge.buildBridgeData({ ...tonParams, dstChainKey: ARBITRUM }, tonToken, tonToken, undefined),
    ).toThrow(/Payout token chain must match/);

    // A direct Tron bridge is refused at the delivered floor and encodes one unit above it.
    const tronToken = tronSupportedTokens.USDT;
    const buildTron = (amount: bigint) =>
      sodax.bridge.buildBridgeData(
        {
          srcChainKey: ChainKeys.TRON_MAINNET,
          srcAddress: TRON_TEST_ADDRESS,
          srcToken: tronToken.address,
          dstChainKey: ChainKeys.TRON_MAINNET,
          dstToken: tronToken.address,
          recipient: TRON_TEST_ADDRESS,
          amount,
        },
        tronToken,
        tronToken,
        undefined,
      );
    expect(() => buildTron(3_000_000n)).toThrow(/must be greater than 3 USDT/);
    expect(buildTron(3_000_001n)).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('refuses a destination token descriptor from the wrong chain, or a Tron descriptor for a non-MPC destination', () => {
    const token = tronSupportedTokens.USDT;
    expect(() =>
      sodax.bridge.buildBridgeData(
        {
          srcChainKey: ChainKeys.TRON_MAINNET,
          srcAddress: TRON_TEST_ADDRESS,
          srcToken: token.address,
          dstChainKey: ChainKeys.TRON_MAINNET,
          dstToken: token.address,
          recipient: TRON_TEST_ADDRESS,
          amount: 4_000_000n,
        },
        token,
        { ...token, chainKey: ARBITRUM },
        undefined,
      ),
    ).toThrow(/Payout token chain must match/);
    expect(() =>
      sodax.bridge.buildBridgeData(
        {
          srcChainKey: ChainKeys.TRON_MAINNET,
          srcAddress: TRON_TEST_ADDRESS,
          srcToken: token.address,
          dstChainKey: ARBITRUM,
          dstToken: token.address,
          recipient: FEE_ADDR,
          amount: 4_000_000n,
        },
        token,
        token,
        undefined,
      ),
    ).toThrow(/Payout token chain must match/);
  });

  it('charges the partner fee in 18-dp hub units on the vault after a deposit, never on the spoke token', () => {
    const src = realToken(ARBITRUM, 'USDC');
    const dst = realToken(ChainKeys.SONIC_MAINNET, 'USDC');
    const amount = 1_000_000n; // 1 USDC at 6 dp
    const params = {
      srcChainKey: src.chainKey,
      srcAddress: SAMPLE_USER,
      srcToken: src.address,
      amount,
      dstChainKey: dst.chainKey,
      dstToken: dst.address,
      recipient: SAMPLE_DST,
    } as never;

    // The fee basis is the amount AFTER the incoming vault translation, so 1% of 1 USDC is
    // 1e16 hub-wei — not 1e4 spoke-base-units. A fixed fee of that exact size must therefore
    // encode identically to the percentage that computes it.
    const hubUnits = EvmVaultTokenService.translateIncomingDecimals(src.decimals, amount);
    const percentageFee = { address: FEE_ADDR, percentage: 100 } as const;
    const expectedFee = sodax.bridge.getFee(hubUnits, percentageFee);
    expect(expectedFee).toBe(hubUnits / 100n);

    const data = sodax.bridge.buildBridgeData(params, src, dst, percentageFee);
    expect(data).toBe(sodax.bridge.buildBridgeData(params, src, dst, { address: FEE_ADDR, amount: expectedFee }));

    // USDC on Arbitrum takes the deposit branch (hubAsset !== vault): the fee targets the vault.
    expect(src.hubAsset.toLowerCase()).not.toBe(src.vault.toLowerCase());
    const { feeTarget, targets } = decodeFeeCall(data, hubUnits / 100n);
    expect(feeTarget.toLowerCase()).toBe(src.vault.toLowerCase());
    expect(targets.map(t => t.toLowerCase())).not.toContain(src.address.toLowerCase());
  });

  it('encodes the delivered amount in the destination token’s units, not hub units', () => {
    const src = realToken(ARBITRUM, 'USDC');
    const dst = realToken(BTC, 'BTC');
    const amount = 1_000_000n; // 1 USDC at 6 dp
    const data = sodax.bridge.buildBridgeData(
      {
        srcChainKey: src.chainKey,
        srcAddress: SAMPLE_USER,
        srcToken: src.address,
        amount,
        dstChainKey: dst.chainKey,
        dstToken: dst.address,
        recipient: BTC_USER_ADDR,
      },
      src,
      dst,
      undefined,
    );

    // 6 dp → 18 dp hub → 8 dp destination: 1e6 → 1e18 → 1e8. The destination transfer must carry the
    // OUTGOING-translated value, which is exactly the `delivered` amount the BTC dust guard checks;
    // encoding the untranslated hub amount would overpay by 10^10.
    // (Hub units legitimately appear too — that is what the vault withdrawal is denominated in — so
    // this asserts the translated value is present, which it never would be without the translation.)
    const hubUnits = EvmVaultTokenService.translateIncomingDecimals(src.decimals, amount);
    const delivered = EvmVaultTokenService.translateOutgoingDecimals(dst.decimals, hubUnits);
    expect(delivered).toBe(100_000_000n);
    expect(data).toContain(delivered.toString(16).padStart(64, '0'));
  });

  // Decode the `(address,uint256,bytes)[]` batch (see encodeContractCalls) and isolate the fee call —
  // the ERC-20 `transfer` whose recipient is FEE_ADDR — so the assertions pin the fee call's own
  // target rather than substring-matching a payload whose delivery call shares the same address.
  const decodeFeeCall = (data: `0x${string}`, feeAmount: bigint) => {
    const [calls] = decodeAbiParameters(parseAbiParameters('(address,uint256,bytes)[]'), data);
    const decoded = calls.map(([target, , cd]) => {
      try {
        const fn = decodeFunctionData({ abi: erc20Abi, data: cd });
        return { target, fn };
      } catch {
        return { target, fn: undefined };
      }
    });
    const feeCalls = decoded.filter(c => c.fn?.functionName === 'transfer' && c.fn.args[0] === FEE_ADDR);
    expect(feeCalls).toHaveLength(1);
    expect(feeCalls[0]?.fn?.args[1]).toBe(feeAmount);
    return { feeTarget: feeCalls[0]?.target as string, targets: decoded.map(c => c.target as string) };
  };

  // The fee-transfer target is the hub-side asset the wallet holds after step 1: the vault after a
  // deposit, the hub asset itself when the source already IS a vault asset (no-deposit path). It was
  // previously initialised from `params.srcToken` — a SPOKE-chain address, wrong on Sonic — kept
  // correct only by the accident that every bridgeable token so far took the deposit branch.
  it('targets the source hub asset — never the spoke token address — for the fee on the no-deposit path, EVM or not', () => {
    const src = realToken(ARBITRUM, 'ARB'); // hubAsset === vault → no-deposit branch
    expect(src.hubAsset.toLowerCase()).toBe(src.vault.toLowerCase());
    const hubToken = sodax.config.getXTokenFromHubAsset(src.hubAsset);
    if (!hubToken) throw new Error('fixture missing: hub XToken for ARB hub asset');
    const dst = { ...hubToken, chainKey: ChainKeys.SONIC_MAINNET };
    const amount = 10n ** 18n;

    const data = sodax.bridge.buildBridgeData(
      {
        srcChainKey: src.chainKey,
        srcAddress: SAMPLE_USER,
        srcToken: src.address,
        amount,
        dstChainKey: ChainKeys.SONIC_MAINNET,
        dstToken: dst.address,
        recipient: SAMPLE_DST,
      },
      src,
      dst,
      { address: FEE_ADDR, percentage: 100 },
    );

    // No deposit → no decimal translation: 100 bps of the raw amount.
    const { feeTarget, targets } = decodeFeeCall(data, amount / 100n);
    expect(feeTarget.toLowerCase()).toBe(src.hubAsset.toLowerCase());
    // The caller-supplied spoke address must appear NOWHERE in a batch executed on Sonic.
    expect(targets.map(t => t.toLowerCase())).not.toContain(src.address.toLowerCase());

    // sodaUSDC@sonic → USDC@arbitrum: same vault, but dst.hubAsset differs from src.hubAsset — the fee
    // asset is the SOURCE hub asset the wallet holds, never anything destination-derived.
    const sonicSrc = realToken(ChainKeys.SONIC_MAINNET, 'sodaUSDC');
    expect(sonicSrc.hubAsset.toLowerCase()).toBe(sonicSrc.vault.toLowerCase());
    const arbDst = realToken(ARBITRUM, 'USDC');
    expect(arbDst.hubAsset.toLowerCase()).not.toBe(sonicSrc.hubAsset.toLowerCase());
    expect(arbDst.vault.toLowerCase()).toBe(sonicSrc.vault.toLowerCase());

    const sonicData = sodax.bridge.buildBridgeData(
      {
        srcChainKey: sonicSrc.chainKey,
        srcAddress: SAMPLE_USER,
        srcToken: sonicSrc.address,
        amount,
        dstChainKey: ARBITRUM,
        dstToken: arbDst.address,
        recipient: SAMPLE_DST,
      },
      sonicSrc,
      arbDst,
      { address: FEE_ADDR, percentage: 100 },
    );

    expect(decodeFeeCall(sonicData, amount / 100n).feeTarget.toLowerCase()).toBe(sonicSrc.hubAsset.toLowerCase());

    // BONK's spoke address is base58; as the fee target it threw `Address … is invalid` out of
    // encodeContractCalls, failing every fee-bearing Solana→hub bridge of a vault-asset token.
    const bonk = realToken(SOLANA, 'BONK');
    expect(bonk.hubAsset.toLowerCase()).toBe(bonk.vault.toLowerCase());
    const bonkHub = sodax.config.getXTokenFromHubAsset(bonk.hubAsset);
    if (!bonkHub) throw new Error('fixture missing: hub XToken for BONK hub asset');
    const bonkDst = { ...bonkHub, chainKey: ChainKeys.SONIC_MAINNET };
    const bonkParams = {
      srcChainKey: bonk.chainKey,
      srcAddress: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
      srcToken: bonk.address,
      amount: 10n ** 9n,
      dstChainKey: ChainKeys.SONIC_MAINNET,
      dstToken: bonkDst.address,
      recipient: SAMPLE_DST,
    } as never;

    expect(() =>
      sodax.bridge.buildBridgeData(bonkParams, bonk, bonkDst, { address: FEE_ADDR, percentage: 100 }),
    ).not.toThrow();
  });
});

describe('BridgeService.createBridgeIntent — Stacks raw srcPublicKey guard', () => {
  beforeEach(() => {
    // Reach the guard: both endpoint tokens must resolve so the token invariants pass. The guard
    // sits after the token/dust invariants and before hub-wallet derivation + deposit.
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: STACKS_TOKEN,
      vault: '0xvault',
      symbol: 'aBTC',
    } as never);
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata');
  });

  it('rejects a Stacks raw intent without extras.srcPublicKey and passes a given one through to the deposit', async () => {
    const result = await sodax.bridge.createBridgeIntent(stacksRawBridgeInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('srcPublicKey');
    }

    const srcPublicKey = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
    const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: { payload: '0xraw' } });

    const passed = await sodax.bridge.createBridgeIntent(stacksRawBridgeInput({ srcPublicKey }));

    expect(passed.ok).toBe(true);
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ srcPublicKey }));
  });
});

// =========================================================================
// createBridgeIntent front-loaded validation invariants (parity with SwapService.createIntent)
// =========================================================================

describe('BridgeService.createBridgeIntent — validation invariants', () => {
  it('rejects a wallet provider of the wrong family and an unregistered spoke chain key up front as VALIDATION_FAILED', async () => {
    // BSC is EVM; a Bitcoin provider (via cast, as a JS consumer might pass) must fail up front as
    // VALIDATION_FAILED rather than routing to a wrong-chain deposit that fails deep as
    // INTENT_CREATION_FAILED.
    const result = await sodax.bridge.createBridgeIntent({
      raw: false,
      walletProvider: mockBtcProvider,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: BSC,
        srcToken: SAMPLE_TOKEN,
        amount: 1_000_000n,
        dstChainKey: ARBITRUM,
        dstToken: SAMPLE_TOKEN,
        recipient: SAMPLE_DST,
      },
      // Deliberate cast: the wrong-family provider above is exactly the case under test.
    } as unknown as BridgeParams<typeof BSC, false>);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Invalid wallet provider');
    }

    // Stub token resolution to succeed so the chain-key guard — not the token invariant — is what
    // rejects the unregistered key (reachable via casts / JS consumers).
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: SAMPLE_TOKEN,
      vault: '0xvault',
      symbol: 'X',
    } as never);

    const unregistered = await sodax.bridge.createBridgeIntent({
      raw: true,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: 'unregistered.chain' as SpokeChainKey,
        srcToken: SAMPLE_TOKEN,
        amount: 1_000_000n,
        dstChainKey: BSC,
        dstToken: SAMPLE_TOKEN,
        recipient: SAMPLE_DST,
      },
    } as BridgeParams<SpokeChainKey, true>);

    expect(unregistered.ok).toBe(false);
    if (!unregistered.ok) {
      expect(unregistered.error).toBeInstanceOf(SodaxError);
      expect(unregistered.error.code).toBe('VALIDATION_FAILED');
      expect(unregistered.error.message).toContain('Invalid spoke chain');
    }
  });
});

// =========================================================================
// Sonic-sourced "withdraw directly" — hub-asset token resolution
// =========================================================================
//
// Partner fees are held on Sonic as hub assets (e.g. the BTC hub asset), which have no
// spoke-token entry under the hub chain — their only XToken lives on the native spoke
// (Bitcoin). createBridgeIntent must resolve those by hub-asset address so the withdraw goes
// through instead of throwing `Unsupported spoke chain (sonic) token: <hub asset>`.

describe('BridgeService.createBridgeIntent — Sonic-sourced hub-asset resolution', () => {
  const SONIC = ChainKeys.SONIC_MAINNET;
  // BTC hub asset on Sonic (bitcoinSupportedTokens.BTC.hubAsset) — no Sonic spoke-token entry.
  const BTC_HUB_ASSET = '0xeb0393893b5bf98a50073d6740738b08e575058b' as Address;
  // sodaBTC vault — bitcoinSupportedTokens.BTC.vault.
  const SODA_BTC_VAULT = '0x7A1A5555842Ad2D0eD274d09b5c4406a95799D5d';

  const sonicWithdrawInput = (srcToken: Address, dstToken: Address): BridgeParams<typeof SONIC, false> =>
    ({
      raw: false,
      walletProvider: mockEvmProvider,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey: SONIC,
        srcToken,
        amount: 100_000n,
        dstChainKey: SONIC,
        dstToken,
        recipient: SAMPLE_DST,
      },
    }) as BridgeParams<typeof SONIC, false>;

  beforeEach(() => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: 'sonictxhash' });
  });

  it('resolves a hub-asset srcToken/dstToken via the hub-asset map, but still rejects an unknown token', async () => {
    const buildSpy = vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata');

    const result = await sodax.bridge.createBridgeIntent(sonicWithdrawInput(BTC_HUB_ASSET, BTC_HUB_ASSET));

    expect(result.ok).toBe(true);
    // Both endpoints resolved to the BTC descriptor (sodaBTC vault), proving the hub-asset fallback.
    const buildCall = buildSpy.mock.calls[0];
    invariant(buildCall, 'buildBridgeData was not called');
    const [, srcToken, dstToken] = buildCall;
    expect(srcToken.vault.toLowerCase()).toBe(SODA_BTC_VAULT.toLowerCase());
    expect(dstToken.vault.toLowerCase()).toBe(SODA_BTC_VAULT.toLowerCase());

    // An unknown hub token that is neither a Sonic spoke token nor a hub asset is still rejected.
    const unknown = await sodax.bridge.createBridgeIntent(sonicWithdrawInput(SAMPLE_TOKEN, SAMPLE_TOKEN));

    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.error.message).toContain('Unsupported spoke chain');
    }
  });
});

describe('BridgeService.bridge — integration error-path coverage', () => {
  it('propagates a returned createBridgeIntent error unchanged, and wraps a thrown out-of-union one', async () => {
    // `bridge()` first calls `createBridgeIntent`. When that returns `{ ok: false, error }`,
    // the error code should be in CreateBridgeIntentErrorCode (a subset of
    // BridgeOrchestrationErrorCode), so `bridge()` returns the same SodaxError unchanged —
    // no extra wrap, no code rewrite.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'spoke deposit reverted', {
      feature: 'bridge',
      context: { srcChainKey: BSC, phase: 'intentCreation' },
    });
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({ ok: false, error: intentError });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Identity check — the SodaxError must be the *same* instance, not a re-wrapped clone.
    expect(result.error).toBe(intentError);
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    // Nothing was broadcast, so there is no source tx to keep reading.
    expect(result.error.context?.srcTxHash).toBeUndefined();
    // verifyTxHash and relayTxAndWaitPacket must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();

    // A code outside BridgeOrchestrationErrorCode fails the `isBridgeOrchestrationError` guard and is wrapped.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into bridge', {
      feature: 'bridge',
    });
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockRejectedValueOnce(outOfUnion);

    const wrapped = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(wrapped.ok).toBe(false);
    if (wrapped.ok) return;
    expect(wrapped.error.code).toBe('EXECUTION_FAILED');
    expect(wrapped.error.cause).toBe(outOfUnion);
    expect(wrapped.error.context?.srcChainKey).toBe(BSC);
    expect(wrapped.error.context?.dstChainKey).toBe(ARBITRUM);
  });

  it('wraps a verifyTxHash failure as BRIDGE_VERIFY_FAILED with cause + phase + chain context', async () => {
    // createBridgeIntent succeeds, then verifyTxHash returns ok:false. `bridge()` must wrap
    // the underlying error as BRIDGE_VERIFY_FAILED with the original on `cause` and the
    // chain context preserved on `error.context`.
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTxHash',
        relayData: { address: HUB_WALLET, payload: '0x' },
      },
    });
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    // Identity check on cause — the original error is reachable for forensics.
    expect(result.error.cause).toBe(verifyError);
    expect(result.error.context?.phase).toBe('verify');
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.dstChainKey).toBe(ARBITRUM);
    expect(result.error.context?.srcTxHash).toBe('0xspokeTxHash');
    expect(result.error.context?.relayData).toEqual({ address: HUB_WALLET, payload: '0x' });
    // Relay must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a relayTxAndWaitPacket failure via mapRelayFailureToBridgeError', async () => {
    // createBridgeIntent + verifyTxHash succeed, then relayTxAndWaitPacket returns ok:false.
    // `bridge()` must route the failure through `mapRelayFailureToBridgeError` so the result
    // surfaces as `BRIDGE_RELAY_TIMEOUT` with the original on `cause` and `context.relayCode`
    // mirroring the relay-layer contract. The mapper itself is unit-tested in
    // `relay-error-mapping.test.ts`; this test pins the *wiring* inside `bridge()`.
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTxHash',
        relayData: { address: HUB_WALLET, payload: '0x' },
      },
    });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    // Identity check on cause — the original Error is reachable for forensics.
    expect(result.error.cause).toBe(relayError);
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
    expect(result.error.context?.phase).toBe('relay');
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.dstChainKey).toBe(ARBITRUM);
    expect(result.error.context?.srcTxHash).toBe('0xspokeTxHash');
  });
});

// =========================================================================
// bridge — backend submit-tx flow (bridge.useBackendSubmitTx, default ON).
// Mirrors SwapService.test.ts Batch 7, with bridge deltas: no intent / intent_hash,
// success value is TxHashPair, fallback relays (no post-execution).
// =========================================================================

describe('BridgeService.bridge — backend submit-tx (useBackendSubmitTx)', () => {
  // A separate Sodax instance with backend submit-tx ON (the default). Per-test we stub createBridgeIntent +
  // verifyTxHash on this instance and the backend bridge API it calls (submitTx / getSubmitTxStatus);
  // the module-level `mocks.relayTxAndWaitPacket` covers the client-side fallback path.
  const sodaxBE = new Sodax({ logger: 'silent' });

  // createBridgeIntent (broadcast) succeeds + on-chain verify succeeds, so bridge() reaches the
  // submit/fallback branch. verifyTxHash is only consumed on the fallback path — returned so a test can
  // assert whether it ran.
  const stubCreatedAndVerified = () => {
    vi.spyOn(sodaxBE.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
    });
    return vi.spyOn(sodaxBE.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  };

  // The backend only uses the intent relay and never notifies the MPC relay: a bridge paying out on
  // Tron would burn and never release.
  it('settles an MPC-relay source, or a bridge to an MPC-relay chain, client-side without trying the backend', async () => {
    vi.spyOn(sodaxBE.bridge, 'createBridgeIntent').mockResolvedValue({
      ok: true,
      value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
    });
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx');
    const settleSpy = vi
      .spyOn(sodaxBE.spoke, 'settle')
      .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xHUBMINT' } })
      .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: 'TronPayout' } });

    const fromTron = await sodaxBE.bridge.bridge(bridgeInput(ChainKeys.TRON_MAINNET, ARBITRUM));

    expect(fromTron.ok).toBe(true);
    if (fromTron.ok) expect(fromTron.value.dstChainTxHash).toBe('0xHUBMINT');
    expect(settleSpy).toHaveBeenCalledWith(expect.objectContaining({ chainKey: ChainKeys.TRON_MAINNET }));

    const toTron = await sodaxBE.bridge.bridge(bridgeInput(ARBITRUM, ChainKeys.TRON_MAINNET));

    expect(toTron.ok).toBe(true);
    expect(settleSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ chainKey: ARBITRUM, dstChainKey: ChainKeys.TRON_MAINNET }),
    );
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('on backend "executed", returns its TxHashPair without verifying or relaying, threading extras.apiKey', async () => {
    const verifySpy = stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    const statusSpy = vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: true,
      value: {
        success: true,
        data: {
          txHash: '0xspokeTx',
          srcChainKey: BSC,
          status: 'executed',
          processingAttempts: 1,
          result: { dstIntentTxHash: '0xDST' },
        },
      },
    });

    const result = await sodaxBE.bridge.bridge({
      ...bridgeInput(BSC, ARBITRUM),
      extras: { apiKey: 'per-action-key' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.srcChainTxHash).toBe('0xspokeTx');
      expect(result.value.dstChainTxHash).toBe('0xDST');
    }
    // The backend owns the relay — the client-side relay must NOT run.
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    // Both the POST and the status poll carry the per-action key (as RequestOverrideConfig.apiKey).
    expect(submitSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
    expect(statusSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
    // Verifying first would delay backend success by the source chain's confirmation wait.
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('falls back to the client-side relay, verifying exactly once, on a rejected POST or a terminal "failed" status', async () => {
    const verifySpy = stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    const statusSpy = vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, 30_000));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dstChainTxHash).toBe('0xFALLBACKDST');
    expect(statusSpy).not.toHaveBeenCalled(); // POST failed before any status polling
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
    // A backend that fails fast leaves the fallback the SAME full budget a stalled one does — the two
    // paths never share a deadline. The stalled counterpart is asserted below.
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(30_000);
    expect(verifySpy).toHaveBeenCalledOnce();

    mocks.relayTxAndWaitPacket.mockClear();
    stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: true,
      value: {
        success: true,
        data: { txHash: '0xspokeTx', srcChainKey: BSC, status: 'failed', processingAttempts: 1, failureReason: 'boom' },
      },
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    const failed = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(failed.ok).toBe(true);
    if (failed.ok) expect(failed.value.dstChainTxHash).toBe('0xFALLBACKDST');
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('keeps the source tx on the error when the fallback relay also fails', async () => {
    // The backend may still finish this bridge, so the caller needs the tx to keep reading status.
    stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.context).toMatchObject({ srcChainKey: BSC, srcTxHash: '0xspokeTx' });
  });

  /** Backend accepts the submission but never reaches `executed`, so the attempt runs to its full budget. */
  const stubStalledBackend = () => {
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValue({
      ok: true,
      value: {
        success: true,
        data: { txHash: '0xspokeTx', srcChainKey: BSC, status: 'pending', processingAttempts: 1 },
      },
    });
  };

  it('gives the fallback a FRESH full timeout after a stalled backend consumed its own', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      stubCreatedAndVerified();
      stubStalledBackend();
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

      const overallTimeout = 30_000;
      const bridgePromise = sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, overallTimeout));
      // Drive the backend attempt past its own deadline so bridge() falls back.
      await vi.advanceTimersByTimeAsync(overallTimeout);
      const result = await bridgePromise;

      expect(result.ok).toBe(true);
      // `timeout` is per-attempt: the backend spending all of its own budget must not shorten the relay
      // wait. Sharing one deadline left this at the ~5s floor, which is how a slow chain hit RELAY_TIMEOUT.
      const relayTimeout = mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout as number;
      expect(relayTimeout).toBe(overallTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a non-finite caller timeout as the default, and skips the POST when the caller leaves no budget', async () => {
    stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    // `?? DEFAULT` does not catch NaN; unresolved it would skip the POST and hand the relay
    // `Math.max(NaN, floor)` = NaN, which reads as an already-expired budget — RELAY_TIMEOUT in
    // milliseconds on a deposit that is live on-chain.
    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, Number.NaN));

    expect(result.ok).toBe(true);
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.calls[0]?.[1]).toEqual({ timeout: DEFAULT_BACKEND_API_TIMEOUT });
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(DEFAULT_RELAY_TX_TIMEOUT);

    // A zero budget: firing the POST would only arm an abort at 0ms; the relay still runs on its floor
    // because the deposit has already landed on-chain. The spy stays stubbed so a regression never POSTs live.
    submitSpy.mockClear().mockResolvedValue({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'unreachable', { feature: 'backend' }),
    });
    vi.spyOn(sodaxBE.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    const noBudget = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, 0));

    expect(noBudget.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(RELAY_FALLBACK_FLOOR_MS);
  });

  it('with the flag off, never touches the backend and raises a sub-floor caller timeout to the relay floor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
        ok: true,
        value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
      });
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      // The module-level `sodax` opts out via `bridge.useBackendSubmitTx: false` → pure client-side flow.
      const submitSpy = vi.spyOn(sodax.api.bridge, 'submitTx');
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });

      const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM, 2_000));

      expect(result.ok).toBe(true);
      expect(submitSpy).not.toHaveBeenCalled();
      // The floor deliberately outranks a sub-floor caller `timeout` (matching SwapService): the spoke
      // deposit has already landed, and `relayTxAndWaitPacket` submits before `timeout` bounds the wait.
      const relayTimeout = mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout as number;
      expect(relayTimeout).toBe(RELAY_FALLBACK_FLOOR_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a slow source-chain confirmation eat the relay budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
        ok: true,
        value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
      });
      // A slow source-chain confirmation (Stacks polls for up to its full 120s `maxTimeoutMs`) used to
      // come out of the relay's share, because the fallback's deadline started before `verifyTxHash`.
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockImplementationOnce(async () => {
        vi.setSystemTime(10_000);
        return { ok: true, value: true };
      });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });

      const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM, 30_000));

      // Verification is now a separate phase, bounded by the chain's own `maxTimeoutMs`, so the relay
      // wait gets the caller's `timeout` in full however long confirmation took.
      expect(result.ok).toBe(true);
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
      expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

// =========================================================================
// Backend submit-tx call-through: extras.apiKey on the wire. Same flow as above, but the real
// BridgeApiService transport runs against a test-local global fetch stub, so the `x-api-key`
// asserted is the header actually sent — not an argument recorded on a stubbed method.
// =========================================================================

describe('BridgeService.bridge — backend submit-tx extras.apiKey on the wire (call-through)', () => {
  const sodaxKeyed = new Sodax({ apiKey: 'instance-key', logger: 'silent' });

  // The same payloads the spied specs above return — they satisfy the real bridge response schemas.
  const SUBMIT_TX_BODY = { success: true, data: { status: 'inserted', message: 'accepted' } };
  const EXECUTED_STATUS_BODY = {
    success: true,
    data: {
      txHash: '0xspokeTx',
      srcChainKey: BSC,
      status: 'executed',
      processingAttempts: 1,
      result: { dstIntentTxHash: '0xDST' },
    },
  };

  const wireFetch = vi.fn();

  beforeEach(() => {
    wireFetch.mockReset();
    // Only the two submit-tx legs may reach fetch; anything else fails the test loudly.
    wireFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/v1/bridge/submit-tx' && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => SUBMIT_TX_BODY };
      }
      if (pathname === '/v1/bridge/submit-tx/status' && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => EXECUTED_STATUS_BODY };
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(url)}`);
    });
    vi.stubGlobal('fetch', wireFetch);
  });

  afterEach(() => {
    // Scoped to this suite — no other suite in this file stubs fetch.
    vi.unstubAllGlobals();
  });

  const stubKeyedCreated = () => {
    vi.spyOn(sodaxKeyed.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx' as never, relayData: { address: HUB_WALLET, payload: '0x' } },
    } as never);
    vi.spyOn(sodaxKeyed.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
  };

  /** The `x-api-key` actually sent to (pathname, method), read through `Headers` so any casing counts. */
  const keySentTo = (pathname: string, method: string): string | null => {
    const matches = wireFetch.mock.calls.filter(
      call => new URL(String(call[0])).pathname === pathname && (call[1]?.method ?? 'GET') === method,
    );
    expect(matches).toHaveLength(1);
    return new Headers(matches[0]?.[1]?.headers).get('x-api-key');
  };

  const runKeyedBridge = async (extras?: { apiKey?: string }) => {
    stubKeyedCreated();
    const args = bridgeInput(BSC, ARBITRUM);
    const result = await sodaxKeyed.bridge.bridge(extras ? { ...args, extras } : args);
    expect(result.ok).toBe(true);
    // The value round-tripped through the real transport + schemas, not a stubbed method.
    if (result.ok) expect(result.value.dstChainTxHash).toBe('0xDST');
    expect(wireFetch).toHaveBeenCalledTimes(2);
  };

  it('sends extras.apiKey over the instance key on both requests, and the instance key when it is omitted or empty', async () => {
    await runKeyedBridge({ apiKey: 'action-key' });
    expect(keySentTo('/v1/bridge/submit-tx', 'POST')).toBe('action-key');
    expect(keySentTo('/v1/bridge/submit-tx/status', 'GET')).toBe('action-key');

    wireFetch.mockClear();
    await runKeyedBridge();
    expect(keySentTo('/v1/bridge/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/bridge/submit-tx/status', 'GET')).toBe('instance-key');

    // An empty extras.apiKey counts as unset.
    wireFetch.mockClear();
    await runKeyedBridge({ apiKey: '' });
    expect(keySentTo('/v1/bridge/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/bridge/submit-tx/status', 'GET')).toBe('instance-key');
  });
});

// =========================================================================
// Sodax wiring — bridge.useBackendSubmitTx flows into BridgeService,
// and sodax.api.bridge is reachable.
// =========================================================================

describe('Sodax bridge.useBackendSubmitTx wiring', () => {
  it('defaults useBackendSubmitTx to true, exposes sodax.api.bridge, keeps the toggles independent and resolves them on ConfigService', () => {
    const s = new Sodax();
    expect(s.bridge.useBackendSubmitTx).toBe(true);
    expect(s.swaps.useBackendSubmitTx).toBe(true);
    expect(s.api.bridge).toBeDefined();

    const bridgeOff = new Sodax({ bridge: { useBackendSubmitTx: false } });
    expect(bridgeOff.bridge.useBackendSubmitTx).toBe(false);
    expect(bridgeOff.swaps.useBackendSubmitTx).toBe(true);

    const swapsOff = new Sodax({ swaps: { useBackendSubmitTx: false } });
    expect(swapsOff.swaps.useBackendSubmitTx).toBe(false);
    expect(swapsOff.bridge.useBackendSubmitTx).toBe(true);

    const defaults = new Sodax();
    // The raw slot is legitimately absent when the caller omits the flag; the effective accessor —
    // the one the services read — is what reports the ON default.
    expect(defaults.config.swaps.useBackendSubmitTx).toBeUndefined();
    expect(defaults.config.swapUseBackendSubmitTx).toBe(true);
    expect(defaults.config.bridgeUseBackendSubmitTx).toBe(true);

    const optedOut = new Sodax({ swaps: { useBackendSubmitTx: false }, bridge: { useBackendSubmitTx: false } });
    expect(optedOut.config.swapUseBackendSubmitTx).toBe(false);
    expect(optedOut.config.bridgeUseBackendSubmitTx).toBe(false);
    expect(optedOut.swaps.useBackendSubmitTx).toBe(false);
    expect(optedOut.bridge.useBackendSubmitTx).toBe(false);
  });

  it('honours the deprecated swapsOptions / bridgeOptions, with the new keys taking precedence', () => {
    // Pre-existing callers that explicitly turned the flag OFF must keep the client-side path —
    // the default flips to ON only for callers that never set it.
    const legacyOff = new Sodax({
      swapsOptions: { useBackendSubmitTx: false },
      bridgeOptions: { useBackendSubmitTx: false },
    });
    expect(legacyOff.config.swapUseBackendSubmitTx).toBe(false);
    expect(legacyOff.config.bridgeUseBackendSubmitTx).toBe(false);
    expect(legacyOff.swaps.useBackendSubmitTx).toBe(false);
    expect(legacyOff.bridge.useBackendSubmitTx).toBe(false);

    const legacyOn = new Sodax({
      swapsOptions: { useBackendSubmitTx: true },
      bridgeOptions: { useBackendSubmitTx: true },
    });
    expect(legacyOn.swaps.useBackendSubmitTx).toBe(true);
    expect(legacyOn.bridge.useBackendSubmitTx).toBe(true);

    const s = new Sodax({
      swaps: { useBackendSubmitTx: true },
      swapsOptions: { useBackendSubmitTx: false },
      bridge: { useBackendSubmitTx: false },
      bridgeOptions: { useBackendSubmitTx: true },
    });
    expect(s.swaps.useBackendSubmitTx).toBe(true);
    expect(s.bridge.useBackendSubmitTx).toBe(false);
  });
});

// =========================================================================
// buildApproveTxs — spender resolution, the only logic this layer owns
// =========================================================================

describe('BridgeService.buildApproveTxs', () => {
  const SONIC = ChainKeys.SONIC_MAINNET;
  const STELLAR = ChainKeys.STELLAR_MAINNET;
  const rawTx = { from: SAMPLE_USER, to: '0x0', value: 0n, data: '0x' } as never;

  const approveInput = <K extends SpokeChainKey>(srcChainKey: K): BridgeParams<K, true> =>
    ({
      raw: true,
      params: {
        srcAddress: SAMPLE_USER,
        srcChainKey,
        srcToken: SAMPLE_TOKEN,
        amount: 1_000_000n,
        dstChainKey: ARBITRUM,
        dstToken: SAMPLE_TOKEN,
        recipient: SAMPLE_DST,
      },
    }) as BridgeParams<K, true>;

  it("approves the caller's own hub wallet on Sonic and the asset manager on an EVM spoke, for the bridge amount", async () => {
    // Swaps resolves the hub spender synchronously from `solver.intentsContract`; reusing that here
    // would approve the wrong contract and still typecheck.
    vi.spyOn(sodax.bridge.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValue({ ok: true, value: { approveTx: rawTx } });

    const hub = await sodax.bridge.buildApproveTxs(approveInput(SONIC));

    expect(hub).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(sodax.bridge.hubProvider.getUserHubWalletAddress).toHaveBeenCalledWith(SAMPLE_USER, SONIC);
    expect(sodax.bridge.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({ srcChainKey: SONIC, spender: HUB_WALLET, raw: true }),
    );

    const input = approveInput(BSC);
    const spoke = await sodax.bridge.buildApproveTxs(input);

    expect(spoke).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(sodax.bridge.spoke.buildApproveTxs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        srcChainKey: BSC,
        spender: sodax.bridge.config.getChainConfig(BSC).addresses.assetManager,
        raw: true,
        token: input.params.srcToken,
        amount: input.params.amount,
        owner: input.params.srcAddress,
      }),
    );
  });

  it('resolves the same spender as approve() does, on both EVM branches', async () => {
    // Pins the property, not the shared call, so an inlined copy of the resolver would fail it.
    vi.spyOn(sodax.bridge.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    const buildSpy = vi
      .spyOn(sodax.bridge.spoke, 'buildApproveTxs')
      .mockResolvedValue({ ok: true, value: { approveTx: rawTx } });
    const approveSpy = vi.spyOn(sodax.bridge.spoke, 'approve').mockResolvedValue({ ok: true, value: rawTx });

    for (const chainKey of [SONIC, BSC] as const) {
      await sodax.bridge.buildApproveTxs(approveInput(chainKey));
      await sodax.bridge.approve({ ...approveInput(chainKey), raw: true } as BridgeParams<typeof chainKey, true>);
    }

    const spenderOf = (spy: typeof buildSpy | typeof approveSpy) =>
      spy.mock.calls.map(([args]) => (args as { spender: string }).spender);
    expect(spenderOf(buildSpy)).toEqual(spenderOf(approveSpy));
    expect(spenderOf(buildSpy)).toEqual([HUB_WALLET, sodax.bridge.config.getChainConfig(BSC).addresses.assetManager]);
  });

  it('surfaces the reset under its own name when the plan needs one', async () => {
    const resetTx = { ...(rawTx as object), data: '0xreset' };
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValueOnce({
      ok: true,
      value: { resetTx, approveTx: rawTx },
    });

    const result = await sodax.bridge.buildApproveTxs(approveInput(BSC));

    // Named, not ordered: no consumer has to know which index is which.
    expect(result).toEqual({ ok: true, value: { resetTx, approveTx: rawTx } });
  });

  it('routes Stellar to the trustline branch without a spender', async () => {
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    await sodax.bridge.buildApproveTxs(approveInput(STELLAR));

    expect(sodax.bridge.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.not.objectContaining({ spender: expect.anything() }),
    );
  });

  it('wraps a spoke failure as SodaxError(APPROVE_FAILED) on the bridge feature, cause preserved', async () => {
    const spokeError = new Error('BUILD_FAILED');
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: false, error: spokeError });

    const result = await sodax.bridge.buildApproveTxs(approveInput(BSC));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SodaxError);
    expect(result.error.code).toBe('APPROVE_FAILED');
    expect(result.error.feature).toBe('bridge');
    expect(result.error.cause).toBe(spokeError);
  });

  it('rejects an unsupported chain (Solana) and a zero amount rather than building a meaningless approval', async () => {
    const result = await sodax.bridge.buildApproveTxs(approveInput(SOLANA));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(String(result.error.message)).toMatch(/Approval only supported/);

    // A zero amount is refused, matching approve().
    const input = approveInput(BSC);
    const zero = await sodax.bridge.buildApproveTxs({ ...input, params: { ...input.params, amount: 0n } });

    expect(zero.ok).toBe(false);
    if (zero.ok) return;
    expect(String(zero.error.message)).toMatch(/Amount must be greater than 0/);
  });

  it('ignores a raw:false forced past the type system and still builds unsigned', async () => {
    // A JavaScript caller can still pass `raw: false`, and the Stellar branch reads it at runtime —
    // carrying it through would have a method named "build" broadcast.
    const buildSpy = vi
      .spyOn(sodax.bridge.spoke, 'buildApproveTxs')
      .mockResolvedValue({ ok: true, value: { approveTx: rawTx } });
    const approveSpy = vi.spyOn(sodax.bridge.spoke, 'approve');

    for (const chainKey of [BSC, STELLAR] as const) {
      const forced = {
        ...approveInput(chainKey),
        raw: false,
        walletProvider: mockEvmProvider,
      } as unknown as BridgeParams<typeof chainKey, true>;
      await expect(sodax.bridge.buildApproveTxs(forced)).resolves.toEqual({ ok: true, value: { approveTx: rawTx } });
    }

    for (const [args] of buildSpy.mock.calls) expect((args as { raw: boolean }).raw).toBe(true);
    expect(approveSpy).not.toHaveBeenCalled(); // nothing took the signing path
  });
});

describe('BridgeService.getDetailedStatus', () => {
  const sodaxBE = new Sodax({ logger: 'silent' });
  const SRC_TX = '0xabc123';
  const DST_TX = '0xdef456';
  const key = { srcChainKey: ARBITRUM, srcTxHash: SRC_TX } as const;

  const statusData = (data: Record<string, unknown>) => ({
    txHash: SRC_TX,
    srcChainKey: ARBITRUM,
    status: 'pending',
    processingAttempts: 1,
    ...data,
  });

  const record = (data: Record<string, unknown>) =>
    vi
      .spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus')
      .mockResolvedValueOnce({ ok: true, value: { success: true, data: statusData(data) } });

  const recordNotFound = () =>
    vi
      .spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus')
      .mockResolvedValueOnce({ ok: true, value: { success: false, data: statusData({}) } });

  const backendFails = (message: string, status: number) =>
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', message, {
        feature: 'backend',
        context: { api: 'bridge', endpoint: '/bridge/submit-tx/status', status },
      }),
    });

  const packets = (data: unknown[]) =>
    mocks.getTransactionPackets.mockResolvedValueOnce({ ok: true, value: { success: true, data } });
  // Carries the identity fields the attribution guard matches on, so the happy paths exercise it.
  // The relay has its own chain numbering, so derive it rather than hardcoding a chain id.
  const RELAY_CHAIN_ID = Number(getIntentRelayChainId(ARBITRUM));
  const HUB_RELAY_CHAIN_ID = Number(getIntentRelayChainId(ChainKeys.SONIC_MAINNET));
  const delivered = [{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }];

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getTransactionPackets.mockReset();
    vi.spyOn(sodaxBE.spoke, 'getHubRelease').mockResolvedValue(undefined);
  });

  it('returns the unmodified submit-tx record without touching the relay, passing a per-request override', async () => {
    const statusSpy = record({ status: 'relaying' });

    const result = await sodaxBE.bridge.getDetailedStatus(key, { apiKey: 'per-action-key' });

    expect(statusSpy).toHaveBeenCalledWith({ txHash: SRC_TX, srcChainKey: ARBITRUM }, { apiKey: 'per-action-key' });

    invariant(result.ok, 'expected a backend answer');
    expect(result.value.source).toBe('backend');
    invariant(result.value.source === 'backend', 'narrowing');
    expect(result.value.data.status).toBe('relaying');
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
  });

  it('routes to the relay packet when the backend has no usable record or is unreachable', async () => {
    const cases = [
      // no record exists
      () => backendFails('not found', 404),
      // the record reports a success:false envelope
      () => recordNotFound(),
      // the backend gave up terminally
      () => record({ status: 'failed' }),
      // the backend abandoned the record mid-flight
      () => record({ status: 'relayed', abandonedAt: 'now' }),
      // the backend is unreachable
      () => backendFails('backend unavailable', 503),
    ];
    for (const arrange of cases) {
      arrange();
      packets(delivered);

      const result = await sodaxBE.bridge.getDetailedStatus(key);

      invariant(result.ok, 'expected the relay to answer');
      expect(result.value.source).toBe('relay');
      invariant(result.value.source === 'relay', 'narrowing');
      expect(result.value.data.dst_tx_hash).toBe(DST_TX);
    }
  });

  it('never returns an undelivered or unmatched packet, tagging only a miss behind a live backend as budgetable', async () => {
    backendFails('not found', 404);
    packets([
      { status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: '0xsomeoneelse', src_chain_id: RELAY_CHAIN_ID },
      { status: 'validating', dst_tx_hash: '', src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID },
    ]);

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(!result.ok, 'expected LOOKUP_FAILED');
    expect(result.error.code).toBe('LOOKUP_FAILED');

    backendFails('not found', 404);
    packets([]);
    const budgetable = await sodaxBE.bridge.getDetailedStatus(key);

    backendFails('backend unavailable', 503);
    packets([]);
    const unprovable = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(!budgetable.ok && !unprovable.ok, 'expected both to fail');
    // A relay miss behind a backend outage proves nothing, so it must not consume a caller's budget.
    expect(budgetable.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
    expect(unprovable.error.context?.reason).toBeUndefined();
  });

  it('treats a rejected API key (401/403) as terminal instead of degrading', async () => {
    for (const status of [401, 403]) {
      backendFails('rejected', status);

      const result = await sodaxBE.bridge.getDetailedStatus(key);

      invariant(!result.ok, 'expected LOOKUP_FAILED');
      // Lifted so `isAuthFailure` recognises the wrapped error — it reads `context.status` only.
      expect(result.error.context?.status).toBe(status);
      expect(isAuthFailure(result.error)).toBe(true);
      expect(result.error.context?.reason).toBeUndefined();
    }
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
  });

  // An MPC-relay source never produces an intent-relay packet: the relay's deposit record answers instead.
  describe('from an MPC-relay source', () => {
    const tronKey = { srcChainKey: ChainKeys.TRON_MAINNET, srcTxHash: 'ab'.repeat(32) } as const;
    const deposit = (status: DepositRecord['status'], txs: DepositRecord['txs']) =>
      vi
        .spyOn(sodaxBE.spoke, 'getMpcRelayDeposit')
        .mockResolvedValueOnce({ ok: true, value: { depositId: 'id', status, createdAt: 0, txs } });

    it('returns the minted deposit record whole for a bridge to the hub, without asking the intent relay', async () => {
      recordNotFound();
      const hubMint = { chain: 'sonic', hash: DST_TX, ts: 0 };
      deposit('minted', { hubMint });

      const result = await sodaxBE.bridge.getDetailedStatus({ ...tronKey, dstChainKey: ChainKeys.SONIC_MAINNET });

      expect(result).toEqual({
        ok: true,
        value: { source: 'mpcRelay', data: { depositId: 'id', status: 'minted', createdAt: 0, txs: { hubMint } } },
      });
      expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    });

    it('keeps a hub mint with no destination, or an unminted deposit, a budgetable not-delivered miss', async () => {
      recordNotFound();
      deposit('minted', { hubMint: { chain: 'sonic', hash: DST_TX, ts: 0 } });

      const result = await sodaxBE.bridge.getDetailedStatus(tronKey);

      invariant(!result.ok, 'expected a non-terminal lookup');
      expect(result.error.context).toMatchObject({ reason: DETAILED_STATUS_NOT_DELIVERED, hubTxHash: DST_TX });

      recordNotFound();
      deposit('attested', {});

      const unminted = await sodaxBE.bridge.getDetailedStatus(tronKey);

      invariant(!unminted.ok, 'expected LOOKUP_FAILED');
      expect(unminted.error.code).toBe('LOOKUP_FAILED');
      expect(unminted.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      expect(unminted.error.context?.mpcRelay).toBe(true);
      expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
    });

    describe('to another spoke', () => {
      const toArbitrum = { ...tronKey, dstChainKey: ARBITRUM } as const;
      const onwardPacket = {
        status: 'executed',
        dst_tx_hash: '0xa7b1',
        src_tx_hash: DST_TX,
        src_chain_id: HUB_RELAY_CHAIN_ID,
      };

      beforeEach(() => {
        recordNotFound();
        deposit('minted', { hubMint: { chain: 'sonic', hash: DST_TX, ts: 0 } });
      });

      it('waits for the hub-to-spoke packet — the hub mint alone is not delivered — and answers with it once it lands', async () => {
        packets([]);

        const result = await sodaxBE.bridge.getDetailedStatus(toArbitrum);

        invariant(!result.ok, 'expected LOOKUP_FAILED');
        expect(result.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
        expect(result.error.context?.hubTxHash).toBe(DST_TX);
        expect(result.error.context?.mpcRelay).toBe(true);

        recordNotFound();
        deposit('minted', { hubMint: { chain: 'sonic', hash: DST_TX, ts: 0 } });
        packets([onwardPacket]);

        const landed = await sodaxBE.bridge.getDetailedStatus(toArbitrum);

        expect(landed).toEqual({ ok: true, value: { source: 'relay', data: onwardPacket } });
      });

      it('never asks the backend, which holds no bridge from Tron and rejects its chain key', async () => {
        vi.restoreAllMocks();
        const backend = vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus');
        deposit('minted', { hubMint: { chain: 'sonic', hash: DST_TX, ts: 0 } });
        packets([]);

        const result = await sodaxBE.bridge.getDetailedStatus(toArbitrum);

        expect(backend).not.toHaveBeenCalled();
        invariant(!result.ok, 'expected LOOKUP_FAILED');
        expect(result.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      });

      it('waits for the release when the destination is the source chain, pending until it is paid', async () => {
        const result = await sodaxBE.bridge.getDetailedStatus({ ...tronKey, dstChainKey: ChainKeys.TRON_MAINNET });

        invariant(!result.ok, 'expected LOOKUP_FAILED');
        expect(result.error.code).toBe('LOOKUP_FAILED');
        expect(result.error.context).toMatchObject({
          reason: DETAILED_STATUS_NOT_DELIVERED,
          hubTxHash: DST_TX,
          mpcRelay: true,
        });
        expect(sodaxBE.spoke.getHubRelease).toHaveBeenCalledWith(DST_TX);
        expect(mocks.getTransactionPackets).not.toHaveBeenCalled();

        for (const state of ['unpaid', 'failed'] as const) {
          recordNotFound();
          deposit('minted', { hubMint: { chain: 'sonic', hash: DST_TX, ts: 0 } });
          vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce(
            state === 'failed'
              ? { ok: false, error: new Error('rpc down') }
              : { ok: true, value: { depositId: 'release', status: 'submitted', createdAt: 0, txs: {} } },
          );
          const pending = await sodaxBE.bridge.getDetailedStatus({ ...tronKey, dstChainKey: ChainKeys.TRON_MAINNET });
          invariant(!pending.ok, 'expected LOOKUP_FAILED');
          expect(pending.error.context).toMatchObject({ hubTxHash: DST_TX, mpcRelay: true });
          // An unreadable release is an outage, not a budgetable miss.
          expect(pending.error.context?.reason).toBe(state === 'unpaid' ? DETAILED_STATUS_NOT_DELIVERED : undefined);
        }

        recordNotFound();
        deposit('minted', { hubMint: { chain: 'sonic', hash: DST_TX, ts: 0 } });
        const release = {
          depositId: 'release',
          status: 'submitted',
          createdAt: 0,
          txs: { release: { chain: 'tron', hash: 'tronPayout', ts: 0 } },
        } as const;
        vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce({ ok: true, value: release });
        const paid = await sodaxBE.bridge.getDetailedStatus({ ...tronKey, dstChainKey: ChainKeys.TRON_MAINNET });
        expect(paid).toEqual({ ok: true, value: { source: 'mpcRelay', data: release } });
      });
    });
  });

  // The hub emits a `BridgeRequest` for an MPC-relay payout, so the intent relay has no packet for that leg.
  describe('to an MPC-relay destination', () => {
    const HUB_SOURCE = ChainKeys.SONIC_MAINNET;
    const hubKey = { srcChainKey: HUB_SOURCE, srcTxHash: SRC_TX } as const;
    const release = (txs: DepositRecord['txs']) =>
      vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce({
        ok: true,
        value: { depositId: 'id', status: 'submitted', createdAt: 0, txs },
      });
    const paid = { release: { chain: 'tron', hash: 'tronPayout', ts: 0 } };

    it('answers a hub-source bridge from the release record once paid, and keeps an unpaid one a budgetable miss', async () => {
      recordNotFound();
      packets([]);
      release(paid);

      const result = await sodaxBE.bridge.getDetailedStatus(hubKey);

      expect(sodaxBE.spoke.getHubRelease).toHaveBeenCalledWith(SRC_TX);
      invariant(result.ok && result.value.source === 'mpcRelay', 'expected the mpcRelay arm');
      expect(result.value.data.txs.release?.hash).toBe('tronPayout');

      // The mpcRelay arm stops pollers, so an unpaid release must stay a miss.
      recordNotFound();
      packets([]);
      release({});

      const unpaid = await sodaxBE.bridge.getDetailedStatus(hubKey);

      invariant(!unpaid.ok, 'expected LOOKUP_FAILED');
      expect(unpaid.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      expect(unpaid.error.context?.mpcRelay).toBe(true);
    });

    it('answers a hub-source bridge from its packet without the receipt, and keeps the packet miss while the receipt is unreadable', async () => {
      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: HUB_RELAY_CHAIN_ID }]);

      const result = await sodaxBE.bridge.getDetailedStatus(hubKey);

      invariant(result.ok, 'expected the relay arm');
      expect(result.value.source).toBe('relay');
      expect(sodaxBE.spoke.getHubRelease).not.toHaveBeenCalled();

      recordNotFound();
      packets([]);
      vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce({ ok: false, error: new Error('no receipt') });

      const unreadable = await sodaxBE.bridge.getDetailedStatus(hubKey);

      invariant(!unreadable.ok, 'expected LOOKUP_FAILED');
      expect(unreadable.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      expect(unreadable.error.context?.mpcRelay).toBe(false);
    });

    it('keeps retrying a hub-source bridge to an MPC-relay chain while its release cannot be read', async () => {
      packets([]);
      vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce({ ok: false, error: new Error('rpc down') });

      const result = await sodaxBE.bridge.getDetailedStatus({ ...hubKey, dstChainKey: ChainKeys.TRON_MAINNET });

      // No packet can exist for that bridge, so a budgetable packet miss would spend its budget on an outage.
      invariant(!result.ok, 'expected LOOKUP_FAILED');
      expect(result.error.context?.reason).toBeUndefined();
      expect(result.error.context?.mpcRelay).toBe(true);
    });

    it('does not report a spoke-source bridge final when its packet only reached the hub, and answers once paid', async () => {
      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
      release({});

      const result = await sodaxBE.bridge.getDetailedStatus(key);

      expect(sodaxBE.spoke.getHubRelease).toHaveBeenCalledWith(DST_TX);
      invariant(!result.ok, 'expected LOOKUP_FAILED');
      expect(result.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      expect(result.error.context?.mpcRelay).toBe(true);
      // The first leg reached the hub, so the release gets a budget of its own.
      expect(result.error.context?.hubTxHash).toBe(DST_TX);

      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
      release(paid);

      const answered = await sodaxBE.bridge.getDetailedStatus(key);

      invariant(answered.ok && answered.value.source === 'mpcRelay', 'expected the mpcRelay arm');
      expect(answered.value.data.txs.release?.hash).toBe('tronPayout');
    });

    it('does not report a spoke-source bridge to an MPC-relay chain final when its hub tx sends no release', async () => {
      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
      vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce(undefined);

      const result = await sodaxBE.bridge.getDetailedStatus({ ...key, dstChainKey: ChainKeys.TRON_MAINNET });

      invariant(!result.ok, 'expected LOOKUP_FAILED');
      expect(result.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      expect(result.error.context?.mpcRelay).toBe(true);
      expect(result.error.context?.hubTxHash).toBe(DST_TX);
    });

    it('keeps retrying when the hub receipt behind a packet is unreadable, unless dstChainKey is off the MPC relay', async () => {
      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
      vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce({ ok: false, error: new Error('rpc down') });

      const result = await sodaxBE.bridge.getDetailedStatus(key);

      invariant(!result.ok, 'expected LOOKUP_FAILED');
      expect(result.error.context?.reason).toBeUndefined();

      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
      vi.mocked(sodaxBE.spoke.getHubRelease).mockResolvedValueOnce({ ok: false, error: new Error('rpc down') });

      const offMpc = await sodaxBE.bridge.getDetailedStatus({ ...key, dstChainKey: BSC });

      invariant(offMpc.ok && offMpc.value.source === 'relay', 'expected the relay arm');
      expect(offMpc.value.data.dst_tx_hash).toBe(DST_TX);
    });

    it('still finds a release the hub tx sends to Tron when dstChainKey says otherwise', async () => {
      recordNotFound();
      packets([{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }]);
      release({});

      const result = await sodaxBE.bridge.getDetailedStatus({ ...key, dstChainKey: BSC });

      invariant(!result.ok, 'expected LOOKUP_FAILED');
      expect(result.error.context?.reason).toBe(DETAILED_STATUS_NOT_DELIVERED);
      expect(result.error.context?.mpcRelay).toBe(true);
    });
  });

  it('returns a Result rather than rejecting when a dependency throws', async () => {
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockRejectedValueOnce(new Error('boom'));

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(!result.ok, 'expected LOOKUP_FAILED');
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });
});

// Below `settle`: only the relay seams are stubbed, so the hub release a bridge to Tron needs is driven for real.
describe('BridgeService.bridge — to Tron, through the MPC relay seams', () => {
  it('submits the hub delivery as a Tron release, waits on that release, and returns its payout', async () => {
    const hubTx = `0x${'9'.repeat(64)}` as const;
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
    });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: hubTx } });
    const bridgeRequest = {
      address: sodax.hubProvider.chainConfig.addresses.assetManager,
      logIndex: 2,
      topics: [toEventSelector('BridgeRequest(uint256,bytes,bytes)'), pad(toHex(728126428n), { size: 32 })],
    };
    vi.spyOn(sodax.hubProvider.publicClient, 'waitForTransactionReceipt')
      // Only `status` and `logs` are read; a full receipt carries block data the test has no use for.
      .mockResolvedValue({ status: 'success', logs: [bridgeRequest] } as unknown as TransactionReceipt);
    const submit = vi.spyOn(sodax.spoke.tron, 'submitHubRelease').mockResolvedValue({ ok: true, value: undefined });
    const wait = vi.spyOn(sodax.spoke.tron, 'waitForHubRelease').mockResolvedValue({
      ok: true,
      value: {
        depositId: 'id',
        status: 'submitted',
        createdAt: null,
        txs: { release: { chain: 'tron', hash: 'tronPayout', ts: 0 } },
      },
    });

    const result = await sodax.bridge.bridge(bridgeInput(ARBITRUM, ChainKeys.TRON_MAINNET));

    const release = { dstChainKey: ChainKeys.TRON_MAINNET, hubChainId: '146', hubTxHash: hubTx, logIndex: 2 };
    expect(submit).toHaveBeenCalledWith(release);
    expect(wait).toHaveBeenCalledWith(release, expect.any(Number));
    expect(result).toEqual({ ok: true, value: { srcChainTxHash: '0xspokeTx', dstChainTxHash: 'tronPayout' } });
  });
});

describe('BridgeService.createBridgeIntent — small payout to an MPC-relay chain', () => {
  const sodaxBE = new Sodax({ logger: 'silent' });
  // Any non-vault hub asset: each endpoint translates through the 18-dp vault units.
  const hubAsset = '0x2222222222222222222222222222222222222222' as Address;
  const src = { address: SAMPLE_TOKEN, chainKey: ARBITRUM, symbol: 'USDT', decimals: 18, hubAsset };
  const dst = {
    address: String(tronSupportedTokens.USDT.address),
    chainKey: ChainKeys.TRON_MAINNET,
    symbol: 'USDT',
    decimals: 6,
    hubAsset,
  };

  const run = async (amount: bigint, partnerFee?: PartnerFee, destination = dst) => {
    // Private, and the only seam that gives the two endpoints decimals that differ.
    const resolver = sodaxBE.bridge as unknown as { resolveBridgeEndpointToken: (chainKey: string) => unknown };
    vi.spyOn(resolver, 'resolveBridgeEndpointToken').mockImplementation(chainKey =>
      chainKey === ChainKeys.TRON_MAINNET ? destination : src,
    );
    const pastValidation = vi
      .spyOn(sodaxBE.hubProvider, 'getUserHubWalletAddress')
      .mockRejectedValue(new Error('past validation'));
    const input = bridgeInput(ARBITRUM, ChainKeys.TRON_MAINNET);
    const result = await sodaxBE.bridge.createBridgeIntent({
      ...input,
      params: { ...input.params, amount, recipient: TRON_TEST_ADDRESS },
      extras: partnerFee ? { partnerFee } : undefined,
    });
    return { result, pastValidation };
  };

  const expectRefused = ({ result, pastValidation }: Awaited<ReturnType<typeof run>>) => {
    invariant(!result.ok, 'expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context?.reason).toBe('mpc-payout-below-minimum');
    expect(pastValidation).not.toHaveBeenCalled();
  };

  it('refuses the converted, post-fee payout at the minimum — whatever the symbol — and passes above it', async () => {
    // The source amount is converted to the payout decimals before the floor applies.
    expectRefused(await run(3n * 10n ** 18n));
    // The floor follows the token, not a custom symbol on it.
    expectRefused(await run(3n * 10n ** 18n, undefined, { ...dst, symbol: 'CUSTOM' }));
    // What arrives after the partner fee is what is checked, not the gross amount.
    expectRefused(await run(31n * 10n ** 17n, { address: SAMPLE_USER, percentage: 500 }));
    // However large the source decimals make it look, above the minimum passes.
    expect((await run(4n * 10n ** 18n)).pastValidation).toHaveBeenCalled();
  });

  it('refuses a token address without a floor even when it uses the USDT symbol', async () => {
    const { result, pastValidation } = await run(4n * 10n ** 18n, undefined, { ...dst, address: TRON_TEST_ADDRESS });
    invariant(!result.ok, 'expected a refusal');
    expect(result.error.context?.reason).toBe('mpc-payout-minimum-missing');
    expect(pastValidation).not.toHaveBeenCalled();
  });
});

// An XRPL account can refuse a release outright, after the hub has already burned the funds.
describe('BridgeService.createBridgeIntent — XRPL recipient', () => {
  const sodaxBE = new Sodax({ logger: 'silent' });
  const XRPL_ADDRESS = 'rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah';
  const hubAsset = '0x2222222222222222222222222222222222222222' as Address;
  const src = { address: SAMPLE_TOKEN, chainKey: ARBITRUM, symbol: 'USDC', decimals: 6, hubAsset };
  const dst = {
    address: xrpSupportedTokens.USDC.address,
    chainKey: ChainKeys.XRP_MAINNET,
    symbol: 'USDC',
    decimals: 6,
    hubAsset,
  };

  const run = async (readiness: XrpDestinationReadiness) => {
    // Private, and the only seam that resolves both endpoints without a configured route.
    const resolver = sodaxBE.bridge as unknown as { resolveBridgeEndpointToken: (chainKey: string) => unknown };
    vi.spyOn(resolver, 'resolveBridgeEndpointToken').mockImplementation(chainKey =>
      chainKey === ChainKeys.XRP_MAINNET ? dst : src,
    );
    const checkSpy = vi.spyOn(sodaxBE.spoke.xrp, 'checkDestination').mockResolvedValue(readiness);
    const pastValidation = vi
      .spyOn(sodaxBE.hubProvider, 'getUserHubWalletAddress')
      .mockRejectedValue(new Error('past validation'));
    const input = bridgeInput(ARBITRUM, ChainKeys.XRP_MAINNET);
    const result = await sodaxBE.bridge.createBridgeIntent({
      ...input,
      params: { ...input.params, amount: 5_000_000n, recipient: XRPL_ADDRESS },
    });
    return { result, pastValidation, checkSpy };
  };

  it('refuses a bridge to an XRPL account that cannot receive the release, and passes one that can', async () => {
    const { result, pastValidation, checkSpy } = await run({ ready: false, reason: 'destination_tag_required' });

    invariant(!result.ok, 'expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context).toMatchObject({ field: 'recipient', reason: 'xrpl-destination_tag_required' });
    expect(checkSpy).toHaveBeenCalledWith(expect.objectContaining({ address: XRPL_ADDRESS, token: dst.address }));
    expect(pastValidation).not.toHaveBeenCalled();

    expect((await run({ ready: true })).pastValidation).toHaveBeenCalled();
  });
});

describe('BridgeService.createBridgeIntent — Hedera recipient', () => {
  const sodaxBE = new Sodax({ logger: 'silent' });
  const hubAsset = '0x2222222222222222222222222222222222222222' as Address;
  const src = { address: SAMPLE_TOKEN, chainKey: ARBITRUM, symbol: 'USDC', decimals: 6, hubAsset };
  const dst = { ...hederaSupportedTokens.USDC, chainKey: ChainKeys.HEDERA_MAINNET, hubAsset };

  const run = async (ready: boolean) => {
    // Resolve a shared bridge route without relying on backend configuration.
    const resolver = sodaxBE.bridge as unknown as { resolveBridgeEndpointToken: (chainKey: string) => unknown };
    vi.spyOn(resolver, 'resolveBridgeEndpointToken').mockImplementation(chainKey =>
      chainKey === ChainKeys.HEDERA_MAINNET ? dst : src,
    );
    const checkSpy = vi
      .spyOn(sodaxBE.spoke.hedera, 'checkDestination')
      .mockResolvedValue(ready ? { ready: true } : { ready: false, reason: 'not_associated' });
    vi.spyOn(sodaxBE.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodaxBE.bridge, 'buildBridgeData').mockReturnValue('0x');
    const depositSpy = vi.spyOn(sodaxBE.spoke, 'deposit').mockResolvedValue({ ok: true, value: '0xdeposit' });
    const input = bridgeInput(ARBITRUM, ChainKeys.HEDERA_MAINNET);
    const result = await sodaxBE.bridge.createBridgeIntent({
      ...input,
      params: { ...input.params, dstToken: dst.address },
    });
    return { result, checkSpy, depositSpy };
  };

  it('refuses an unassociated Hedera recipient before depositing on the source chain', async () => {
    const { result, checkSpy, depositSpy } = await run(false);

    expect(depositSpy).not.toHaveBeenCalled();
    invariant(!result.ok, 'expected a refusal');
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(result.error.context).toMatchObject({ reason: 'hedera-not_associated' });
    expect(checkSpy).toHaveBeenCalledWith(expect.objectContaining({ address: SAMPLE_DST, token: dst.address }));
  });

  it('deposits on the source chain for an associated Hedera recipient', async () => {
    const { result, checkSpy, depositSpy } = await run(true);

    expect(result.ok).toBe(true);
    expect(checkSpy).toHaveBeenCalledWith(expect.objectContaining({ address: SAMPLE_DST, token: dst.address }));
    expect(depositSpy).toHaveBeenCalledOnce();
  });
});

describe('BridgeService.getApprovalStrategy and bridgeWithApproval', () => {
  const RAW_APPROVE: EvmRawTransaction = { from: SAMPLE_USER, to: HUB_WALLET, value: 0n, data: '0x095ea7b3' };
  const RAW_DEPOSIT: EvmRawTransaction = { from: SAMPLE_USER, to: HUB_WALLET, value: 0n, data: '0xdeadbeef' };
  const RELAY_DATA = { address: HUB_WALLET, payload: '0x' as const };
  const BSC_CHAIN_ID = 56;
  const confirmedBatch: EvmBatchResult = {
    status: 'success',
    statusCode: 200,
    atomic: true,
    receipts: [{ transactionHash: '0xbatchTx', status: 'success' }],
  };

  const makeBatchProvider = (support: EvmAtomicBatchSupport = 'supported') => ({
    chainType: 'EVM' as const,
    getWalletAddress: vi.fn<IEvmWalletProvider['getWalletAddress']>(),
    sendTransaction: vi.fn<IEvmWalletProvider['sendTransaction']>(),
    waitForTransactionReceipt: vi.fn<IEvmWalletProvider['waitForTransactionReceipt']>(),
    getAtomicBatchSupport: vi.fn(async (_chainId: number) => support),
    sendAtomicBatch: vi.fn(
      async (_txs: readonly EvmRawTransaction[], _options: { expectedChainId: number }) => 'batch-1',
    ),
    waitForBatch: vi.fn(async (_batchId: string) => confirmedBatch),
  });

  const input = (
    walletProvider: IEvmWalletProvider,
    srcChainKey: SpokeChainKey = BSC,
    allowAccountUpgrade?: boolean,
  ): BridgeWithApprovalParams<SpokeChainKey> => ({
    ...bridgeInput(srcChainKey, ARBITRUM),
    walletProvider,
    allowAccountUpgrade,
  });
  const allowance = (valid: boolean) =>
    vi.spyOn(sodax.bridge, 'isAllowanceValid').mockResolvedValue({ ok: true, value: valid });
  const stubCreate = () =>
    vi
      .spyOn(sodax.bridge, 'createBridgeIntent')
      .mockImplementation(
        async ({ raw }) =>
          ({ ok: true, value: { tx: raw ? RAW_DEPOSIT : '0xspokeTx', relayData: RELAY_DATA } }) as never,
      );
  const stubCompletion = () => {
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xDST' } });
  };

  describe('getApprovalStrategy', () => {
    it('needs no approval when the allowance covers the amount, batches on an EIP-5792 EVM spoke, else goes sequential', async () => {
      const covered = allowance(true);
      await expect(sodax.bridge.getApprovalStrategy(input(makeBatchProvider()))).resolves.toEqual({
        ok: true,
        value: 'not-required',
      });

      covered.mockResolvedValue({ ok: true, value: false });
      const wallet = makeBatchProvider('ready');
      await expect(sodax.bridge.getApprovalStrategy(input(wallet))).resolves.toEqual({
        ok: true,
        value: 'atomic-batch',
      });
      expect(wallet.getAtomicBatchSupport).toHaveBeenCalledWith(BSC_CHAIN_ID);

      // A ready wallet stays sequential when the upgrade is not allowed, and the hub always does.
      await expect(sodax.bridge.getApprovalStrategy(input(makeBatchProvider('ready'), BSC, false))).resolves.toEqual({
        ok: true,
        value: 'sequential',
      });
      await expect(
        sodax.bridge.getApprovalStrategy(input(makeBatchProvider(), ChainKeys.SONIC_MAINNET)),
      ).resolves.toEqual({ ok: true, value: 'sequential' });
    });

    it('keeps invalid params a VALIDATION_FAILED, as bridge() reports them, and a failed allowance read ALLOWANCE_CHECK_FAILED', async () => {
      const result = await sodax.bridge.getApprovalStrategy({
        ...input(makeBatchProvider()),
        params: { ...input(makeBatchProvider()).params, amount: 0n },
      });
      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({ field: 'amount', action: 'bridgeWithApproval' });

      vi.spyOn(sodax.bridge, 'isAllowanceValid').mockResolvedValueOnce({
        ok: false,
        error: new SodaxError('ALLOWANCE_CHECK_FAILED', 'rpc down', { feature: 'bridge' }),
      });
      const allowanceFailure = await sodax.bridge.getApprovalStrategy(input(makeBatchProvider()));
      expect(!allowanceFailure.ok && allowanceFailure.error.code).toBe('ALLOWANCE_CHECK_FAILED');
      expect(!allowanceFailure.ok && allowanceFailure.error.context?.action).toBe('bridgeWithApproval');
    });
  });

  describe('bridgeWithApproval', () => {
    it('sends approve + deposit as one batch — any allowance reset first — and relays the batch tx', async () => {
      allowance(false);
      vi.spyOn(sodax.bridge, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.bridge, 'approve');
      stubCompletion();
      const wallet = makeBatchProvider();

      const result = await sodax.bridge.bridgeWithApproval(input(wallet));

      expect(result).toEqual({
        ok: true,
        value: { srcChainTxHash: '0xbatchTx', dstChainTxHash: '0xDST', approvalStrategy: 'atomic-batch' },
      });
      expect(wallet.sendAtomicBatch).toHaveBeenCalledWith([RAW_APPROVE, RAW_DEPOSIT], {
        expectedChainId: BSC_CHAIN_ID,
      });
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
      expect(approveSpy).not.toHaveBeenCalled();

      const RAW_RESET = { ...RAW_APPROVE, data: '0x00' as const };
      vi.spyOn(sodax.bridge, 'buildApproveTxs').mockResolvedValueOnce({
        ok: true,
        value: { resetTx: RAW_RESET, approveTx: RAW_APPROVE },
      });
      stubCompletion();

      await sodax.bridge.bridgeWithApproval(input(wallet));

      expect(wallet.sendAtomicBatch.mock.calls[1]?.[0]).toEqual([RAW_RESET, RAW_APPROVE, RAW_DEPOSIT]);
    });

    it('approves separately when the wallet refuses the batch before signing', async () => {
      allowance(false);
      vi.spyOn(sodax.bridge, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.bridge, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      stubCompletion();
      const wallet = makeBatchProvider();
      wallet.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));

      const result = await sodax.bridge.bridgeWithApproval(input(wallet));

      expect(result.ok && result.value.approvalStrategy).toBe('sequential');
      expect(result.ok && result.value.srcChainTxHash).toBe('0xspokeTx');
      expect(approveSpy).toHaveBeenCalledOnce();
      // The batch path already built the deposit, so the fallback skips a second unsigned build.
      expect(createSpy).toHaveBeenCalledTimes(2);
    });

    it("returns bridge()'s own error once the deposit is broadcast", async () => {
      allowance(true);
      stubCreate();
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValue({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

      const result = await sodax.bridge.bridgeWithApproval(input(makeBatchProvider()));

      expect(!result.ok && result.error.code).toBe('RELAY_TIMEOUT');
      expect(!result.ok && result.error.context?.phase).toBe('relay');
      expect(!result.ok && result.error.context?.action).not.toBe('bridgeWithApproval');
      expect(!result.ok && result.error.context?.approvalStrategy).toBeUndefined();
    });

    it('reports a rejected batch or a declined upgrade as USER_REJECTED without approving separately', async () => {
      const cases = [
        [new UserRejectedRequestError(new Error('User rejected')), undefined],
        [new AtomicReadyWalletRejectedUpgradeError(new Error('declined')), ACCOUNT_UPGRADE_DECLINED],
      ] as const;
      allowance(false);
      stubCreate();
      const approveSpy = vi.spyOn(sodax.bridge, 'approve');
      for (const [cause, reason] of cases) {
        vi.spyOn(sodax.bridge, 'buildApproveTxs').mockResolvedValueOnce({
          ok: true,
          value: { approveTx: RAW_APPROVE },
        });
        const wallet = makeBatchProvider('ready');
        wallet.sendAtomicBatch.mockRejectedValueOnce(cause);

        const result = await sodax.bridge.bridgeWithApproval(input(wallet));

        expect(!result.ok && result.error.code).toBe('USER_REJECTED');
        expect(!result.ok && result.error.context?.reason).toBe(reason);
      }
      expect(approveSpy).not.toHaveBeenCalled();
    });

    it('never relays or resends a batch that was sent but not confirmed, having waited at least the default', async () => {
      allowance(false);
      vi.spyOn(sodax.bridge, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      stubCreate();
      const approveSpy = vi.spyOn(sodax.bridge, 'approve');
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('timed out'));

      // A short relay timeout must not cut the batch wait short: that reports a landing batch as unconfirmed.
      const result = await sodax.bridge.bridgeWithApproval({ ...input(wallet), timeout: 0 });

      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
      expect(!result.ok && result.error.code).toBe('TX_VERIFICATION_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({
        reason: ATOMIC_BATCH_UNCONFIRMED,
        batchId: 'batch-1',
        action: 'bridgeWithApproval',
      });
      expect(approveSpy).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('approves, waits, then deposits on a wallet that cannot batch or a Stellar source', async () => {
      allowance(false);
      const createSpy = stubCreate();
      vi.spyOn(sodax.bridge, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      const waitSpy = vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'success', receipt: {} as never },
      });
      stubCompletion();

      const result = await sodax.bridge.bridgeWithApproval(input(mockEvmProvider));

      expect(result.ok && result.value.approvalStrategy).toBe('sequential');
      expect(waitSpy).toHaveBeenCalledWith({ txHash: '0xapproveTx', chainKey: BSC });
      expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ raw: true });
      expect(createSpy.mock.calls[1]?.[0]).toMatchObject({ raw: false });

      createSpy.mockClear();
      const approveSpy = vi.spyOn(sodax.bridge, 'approve').mockResolvedValueOnce({ ok: true, value: '0xtrustline' });
      waitSpy.mockResolvedValueOnce({ ok: true, value: { status: 'success', receipt: {} as never } });
      stubCompletion();

      const stellar = await sodax.bridge.bridgeWithApproval({
        ...input(mockEvmProvider, ChainKeys.STELLAR_MAINNET),
        walletProvider: { chainType: 'STELLAR' } as never,
      });

      expect(stellar.ok && stellar.value.approvalStrategy).toBe('sequential');
      expect(approveSpy).toHaveBeenCalledTimes(2);
      expect(waitSpy).toHaveBeenLastCalledWith({ txHash: '0xtrustline', chainKey: ChainKeys.STELLAR_MAINNET });
      expect(createSpy.mock.calls.map(([call]) => call.raw)).toEqual([true, false]);
    });

    it('does not deposit over an approval that did not confirm', async () => {
      allowance(false);
      const createSpy = stubCreate();
      vi.spyOn(sodax.bridge, 'approve').mockResolvedValueOnce({ ok: true, value: '0xapproveTx' });
      vi.spyOn(sodax.spoke, 'waitForTxReceipt').mockResolvedValueOnce({
        ok: true,
        value: { status: 'failure', error: new Error('reverted') },
      });

      const result = await sodax.bridge.bridgeWithApproval(input(mockEvmProvider));

      expect(!result.ok && result.error.code).toBe('APPROVE_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({
        reason: 'approve-not-confirmed',
        approveTxHash: '0xapproveTx',
        approvalStrategy: 'sequential',
      });
      // Only the unsigned preflight build ran; no deposit went out over the failed approval.
      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ raw: true }));
    });

    it('asks for no approval when the deposit cannot be built', async () => {
      allowance(false);
      const invalid = new SodaxError('VALIDATION_FAILED', 'Unsupported destination token', { feature: 'bridge' });
      vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({ ok: false, error: invalid });
      const approveSpy = vi.spyOn(sodax.bridge, 'approve');

      const result = await sodax.bridge.bridgeWithApproval(input(mockEvmProvider));

      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
      expect(!result.ok && result.error.context?.approvalStrategy).toBe('sequential');
      expect(approveSpy).not.toHaveBeenCalled();
    });

    it('bridges straight away when no approval is needed', async () => {
      allowance(true);
      const createSpy = stubCreate();
      const buildSpy = vi.spyOn(sodax.bridge, 'buildApproveTxs');
      const approveSpy = vi.spyOn(sodax.bridge, 'approve');
      stubCompletion();

      const result = await sodax.bridge.bridgeWithApproval(input(makeBatchProvider()));

      expect(result.ok && result.value).toMatchObject({
        srcChainTxHash: '0xspokeTx',
        approvalStrategy: 'not-required',
      });
      expect(createSpy).toHaveBeenCalledOnce();
      expect(buildSpy).not.toHaveBeenCalled();
      expect(approveSpy).not.toHaveBeenCalled();
    });
  });
  describe('bridgeWithApproval — resuming an unconfirmed batch', () => {
    const stubResumeRelay = () => {
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xDST' } });
    };
    const resumeToTron = (wallet: ReturnType<typeof makeBatchProvider>) =>
      sodax.bridge.bridgeWithApproval({
        ...bridgeInput(BSC, ChainKeys.TRON_MAINNET),
        walletProvider: wallet,
        resumeBatchId: 'batch-1',
      });
    const resume = (wallet: ReturnType<typeof makeBatchProvider>, resumeBatchCallCount?: number) =>
      sodax.bridge.bridgeWithApproval({ ...input(wallet), resumeBatchId: 'batch-1', resumeBatchCallCount });
    const perCallReceipts: EvmBatchResult = {
      ...confirmedBatch,
      receipts: [
        { transactionHash: '0xapproveTx', status: 'success' },
        { transactionHash: '0xdepositTx', status: 'success' },
      ],
    };

    it('finishes a batch that confirms after the first wait, without sending anything again', async () => {
      allowance(false);
      vi.spyOn(sodax.bridge, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: RAW_APPROVE } });
      const createSpy = stubCreate();
      const approveSpy = vi.spyOn(sodax.bridge, 'approve');
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));

      const first = await sodax.bridge.bridgeWithApproval(input(wallet));
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.error.context).toMatchObject({ reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 2 });

      stubResumeRelay();
      const result = await resume(wallet);

      expect(result).toEqual({
        ok: true,
        value: { srcChainTxHash: '0xbatchTx', dstChainTxHash: '0xDST', approvalStrategy: 'atomic-batch' },
      });
      expect(wallet.sendAtomicBatch).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledOnce();
      expect(approveSpy).not.toHaveBeenCalled();
      expect(wallet.waitForBatch).toHaveBeenLastCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });
      // The relay takes an EVM tx by hash, so the relayData lost with the first call is not needed.
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]).toEqual({
        srcTxHash: '0xbatchTx',
        chainKey: BSC,
        relayerApiEndpoint: sodax.config.relay.relayerApiEndpoint,
        timeout: DEFAULT_RELAY_TX_TIMEOUT,
      });
    });

    it('skips the approval strategy and the submit-tx backend', async () => {
      const wallet = makeBatchProvider();
      const backendOn = new Sodax({ logger: 'silent', bridge: { useBackendSubmitTx: true } });
      const allowanceSpy = vi.spyOn(backendOn.bridge, 'isAllowanceValid');
      const submitSpy = vi.spyOn(backendOn.api.bridge, 'submitTx');
      stubResumeRelay();

      const result = await backendOn.bridge.bridgeWithApproval({
        ...input(wallet),
        resumeBatchId: 'batch-1',
      });

      expect(result.ok).toBe(true);
      expect(allowanceSpy).not.toHaveBeenCalled();
      expect(wallet.getAtomicBatchSupport).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('stays unconfirmed while the batch is still pending, keeping the call count, after waiting at least the default', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockRejectedValueOnce(new Error('Timed out while waiting for call bundle'));

      const result = await sodax.bridge.bridgeWithApproval({
        ...input(wallet),
        resumeBatchId: 'batch-1',
        resumeBatchCallCount: 2,
        timeout: 0,
      });

      expect(wallet.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: DEFAULT_RELAY_TX_TIMEOUT });

      expect(!result.ok && result.error.code).toBe('TX_VERIFICATION_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({
        reason: ATOMIC_BATCH_UNCONFIRMED,
        batchId: 'batch-1',
        callCount: 2,
        action: 'bridgeWithApproval',
      });
      expect(wallet.sendAtomicBatch).not.toHaveBeenCalled();
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('relays the deposit of a late batch confirmed as one tx per call only when given the call count', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce(perCallReceipts);
      stubResumeRelay();

      const result = await resume(wallet, 2);

      expect(result.ok && result.value.srcChainTxHash).toBe('0xdepositTx');
      expect(mocks.relayTxAndWaitPacket.mock.calls[0]?.[0]).toMatchObject({ srcTxHash: '0xdepositTx' });

      wallet.waitForBatch.mockResolvedValueOnce(perCallReceipts);

      const withoutCount = await resume(wallet);

      expect(!withoutCount.ok && withoutCount.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
      expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
    });

    it('reports a batch that never landed as atomic-batch-failed', async () => {
      const wallet = makeBatchProvider();
      wallet.waitForBatch.mockResolvedValueOnce({ status: 'failure', statusCode: 400, atomic: true, receipts: [] });

      const result = await resume(wallet);

      expect(!result.ok && result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(!result.ok && result.error.context).toMatchObject({ reason: 'atomic-batch-failed', batchId: 'batch-1' });
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });

    it('keeps the deposit tx on a relay timeout or a rejected submission, so the bridge can be resumed or tracked', async () => {
      const wallet = makeBatchProvider();
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('RELAY_TIMEOUT') });

      const result = await resume(wallet);

      expect(!result.ok && result.error.code).toBe('RELAY_TIMEOUT');
      expect(!result.ok && result.error.context).toMatchObject({
        srcTxHash: '0xbatchTx',
        action: 'bridgeWithApproval',
      });

      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: new Error('SUBMIT_TX_FAILED') });

      const rejected = await resume(wallet);

      expect(!rejected.ok && rejected.error.code).toBe('TX_SUBMIT_FAILED');
      expect(!rejected.ok && rejected.error.context?.srcTxHash).toBe('0xbatchTx');
    });

    it('releases the payout of a resumed batch to Tron, keeping the deposit tx if the release fails or reverts', async () => {
      const wallet = makeBatchProvider();
      stubResumeRelay();
      const release = vi
        .spyOn(sodax.bridge.spoke, 'settleHubRelease')
        .mockResolvedValueOnce({ ok: true, value: { srcChainTxHash: '0xDST', dstChainTxHash: 'tronPayout' } });

      const result = await resumeToTron(wallet);

      expect(release).toHaveBeenCalledWith('0xDST', ChainKeys.TRON_MAINNET, DEFAULT_RELAY_TX_TIMEOUT);
      expect(result).toEqual({
        ok: true,
        value: { srcChainTxHash: '0xbatchTx', dstChainTxHash: 'tronPayout', approvalStrategy: 'atomic-batch' },
      });

      stubResumeRelay();
      release.mockResolvedValueOnce({ ok: false, error: { phase: 'relay', cause: new Error('RELAY_TIMEOUT') } });

      const notLanded = await resumeToTron(wallet);

      expect(!notLanded.ok && notLanded.error.code).toBe('RELAY_TIMEOUT');
      expect(!notLanded.ok && notLanded.error.context?.srcTxHash).toBe('0xbatchTx');

      stubResumeRelay();
      vi.spyOn(sodax.bridge.spoke, 'settleHubRelease').mockResolvedValueOnce({
        ok: false,
        error: { phase: 'verification', cause: new Error('hub tx 0xDST reverted') },
      });

      const reverted = await resumeToTron(wallet);

      expect(!reverted.ok && reverted.error.code).toBe('TX_VERIFICATION_FAILED');
      expect(!reverted.ok && reverted.error.context?.srcTxHash).toBe('0xbatchTx');
    });

    it('rejects resuming with a wallet that cannot batch', async () => {
      const result = await sodax.bridge.bridgeWithApproval({ ...input(mockEvmProvider), resumeBatchId: 'batch-1' });

      expect(!result.ok && result.error.code).toBe('VALIDATION_FAILED');
      expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
    });
  });
});
