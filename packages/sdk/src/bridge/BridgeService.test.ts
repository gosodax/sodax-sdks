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
import { decodeAbiParameters, decodeFunctionData, erc20Abi, parseAbiParameters } from 'viem';
import type { Address, IEvmWalletProvider, SpokeChainKey } from '@sodax/types';
import { ChainKeys, DEFAULT_BACKEND_API_TIMEOUT, DEFAULT_RELAY_TX_TIMEOUT, getIntentRelayChainId } from '@sodax/types';
import { RELAY_FALLBACK_FLOOR_MS } from '../shared/services/intentRelay/IntentRelayApiService.js';
import { EvmVaultTokenService } from '../shared/services/hub/EvmVaultTokenService.js';
import { Sodax } from '../shared/entities/Sodax.js';
import { SodaxError } from '../errors/SodaxError.js';
import { isAuthFailure } from '../errors/guards.js';
import { DETAILED_STATUS_NOT_DELIVERED } from '../backendApi/detailedStatusRouting.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import type { BridgeParams } from './BridgeService.js';

const mocks = vi.hoisted(() => ({
  relayTxAndWaitPacket: vi.fn(),
  getTransactionPackets: vi.fn(),
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
    getTransactionPackets: mocks.getTransactionPackets,
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
  it('returns 0n when neither a bridge nor a global fee is configured', () => {
    expect(sodax.bridge.getFee(1_000_000n)).toBe(0n);
  });

  it('falls back to the global fee when no bridge-specific partnerFee is set', () => {
    // Regression: a global `fee` with no `bridge.partnerFee` must still be charged — the effective
    // bridge fee is `bridge.partnerFee ?? fee` (via config.bridgePartnerFee), so a global-only fee
    // is no longer silently dropped. `fee` is a typed SodaxOptions slot — no cast needed.
    const sodaxWithGlobalFee = new Sodax({
      fee: { address: '0x3333333333333333333333333333333333333333', percentage: 100 },
    });

    expect(sodaxWithGlobalFee.bridge.getFee(1_000_000n)).toBeGreaterThan(0n);
  });

  it('uses the per-call partnerFee over the configured fee', () => {
    // `sodax` has no configured fee (getFee(1M) === 0n above); a per-call partnerFee is charged instead.
    // 100 bps (1%) of 1_000_000 = 10_000.
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

  it('does NOT call ensureRadfiAccessToken (Bound Exchange auth is TRADING-only)', async () => {
    const result = await sodax.bridge.createBridgeIntent(btcBridgeInput());
    expect(result.ok).toBe(true);
    expect(ensureRadfiSpy).not.toHaveBeenCalled();
  });

  it('passes skipSimulation=true so the hub skips EVM simulation for Bitcoin USER deposits', async () => {
    await sodax.bridge.createBridgeIntent(btcBridgeInput());
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ skipSimulation: true }));
  });

  it('derives hub wallet from personal address, not a trading address', async () => {
    const getEffectiveSpy = vi.spyOn(sodax.spoke.bitcoin, 'getEffectiveWalletAddress');
    const getHubSpy = vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress');

    await sodax.bridge.createBridgeIntent(btcBridgeInput());

    // getEffectiveWalletAddress is called with the user's personal address
    expect(getEffectiveSpy).toHaveBeenCalledWith(BTC_USER_ADDR);
    // The returned personal address (not a trading address) is forwarded to hub wallet derivation
    expect(getHubSpy).toHaveBeenCalledWith(BTC_USER_ADDR, BTC);
    // The spoke deposit srcAddress also uses the personal address
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

  it('passes when the post-fee delivery clears dust (percentage fee)', async () => {
    // 100 bps of 600 sats → 6 sats fee → delivered 594 ≥ 546.
    const result = await sodax.bridge.createBridgeIntent(btcDestInput(600n, { address: FEE_ADDR, percentage: 100 }));
    expect(result.ok).toBe(true);
  });

  it('rejects when the post-fee delivery falls below dust (percentage fee)', async () => {
    // 100 bps of 550 sats → delivered 544 < 546.
    const result = await sodax.bridge.createBridgeIntent(btcDestInput(550n, { address: FEE_ADDR, percentage: 100 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Post-fee');
    }
  });

  it('treats a fixed-amount fee as wei, not sats (regression: previously threw the fee invariant)', async () => {
    // 10^10 wei = exactly 1 sat worth. 547 sats − 1 sat = 546 ≥ 546 → passes. Before the hub-unit
    // fix this path threw `fee.amount <= inputAmount` (10^10 wei vs 547 "sats") for EVERY
    // BTC-destination bridge with a fixed-amount fee.
    const result = await sodax.bridge.createBridgeIntent(btcDestInput(547n, { address: FEE_ADDR, amount: 10n ** 10n }));
    expect(result.ok).toBe(true);
  });

  it('rejects with the dust message when a large fixed wei fee pushes delivery below dust', async () => {
    // 100 sats worth of fee (100 × 10^10 wei): 600 − 100 = 500 < 546 → the specific post-fee
    // dust invariant, not a generic fee-invariant failure.
    const result = await sodax.bridge.createBridgeIntent(
      btcDestInput(600n, { address: FEE_ADDR, amount: 100n * 10n ** 10n }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Post-fee');
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

  it('charges the partner fee in 18-dp hub units, not the spoke token’s units', () => {
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

    expect(sodax.bridge.buildBridgeData(params, src, dst, percentageFee)).toBe(
      sodax.bridge.buildBridgeData(params, src, dst, { address: FEE_ADDR, amount: expectedFee }),
    );
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
  it('targets the hub asset — never the spoke token address — for the fee on the no-deposit path', () => {
    const src = realToken(ARBITRUM, 'ARB'); // hubAsset === vault → no-deposit branch
    expect(src.hubAsset.toLowerCase()).toBe(src.vault.toLowerCase());
    const dst = sodax.config.getXTokenFromHubAsset(src.hubAsset);
    if (!dst) throw new Error('fixture missing: hub XToken for ARB hub asset');
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
  });

  it('takes the fee in the SOURCE-side holding, not anything destination-derived', () => {
    // sodaUSDC@sonic → USDC@arbitrum: no-deposit source, same vault, but dst.hubAsset differs from
    // src.hubAsset — so this pins that the fee asset is the source hub asset the wallet holds, and
    // would catch an implementation deriving the fee target from the destination token.
    const src = realToken(ChainKeys.SONIC_MAINNET, 'sodaUSDC');
    expect(src.hubAsset.toLowerCase()).toBe(src.vault.toLowerCase());
    const dst = realToken(ARBITRUM, 'USDC');
    expect(dst.hubAsset.toLowerCase()).not.toBe(src.hubAsset.toLowerCase());
    expect(dst.vault.toLowerCase()).toBe(src.vault.toLowerCase());
    const amount = 10n ** 18n;

    const data = sodax.bridge.buildBridgeData(
      {
        srcChainKey: src.chainKey,
        srcAddress: SAMPLE_USER,
        srcToken: src.address,
        amount,
        dstChainKey: ARBITRUM,
        dstToken: dst.address,
        recipient: SAMPLE_DST,
      },
      src,
      dst,
      { address: FEE_ADDR, percentage: 100 },
    );

    const { feeTarget } = decodeFeeCall(data, amount / 100n);
    expect(feeTarget.toLowerCase()).toBe(src.hubAsset.toLowerCase());
  });

  it('builds a fee-bearing payload for a non-EVM no-deposit source instead of throwing', () => {
    // BONK's spoke address is base58; as the fee target it threw `Address … is invalid` out of
    // encodeContractCalls, failing every fee-bearing Solana→hub bridge of a vault-asset token.
    const src = realToken(SOLANA, 'BONK');
    expect(src.hubAsset.toLowerCase()).toBe(src.vault.toLowerCase());
    const dst = sodax.config.getXTokenFromHubAsset(src.hubAsset);
    if (!dst) throw new Error('fixture missing: hub XToken for BONK hub asset');
    const params = {
      srcChainKey: src.chainKey,
      srcAddress: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
      srcToken: src.address,
      amount: 10n ** 9n,
      dstChainKey: ChainKeys.SONIC_MAINNET,
      dstToken: dst.address,
      recipient: SAMPLE_DST,
    } as never;

    expect(() => sodax.bridge.buildBridgeData(params, src, dst, { address: FEE_ADDR, percentage: 100 })).not.toThrow();
  });

  it('leaves the deposit path untouched: fee still targets the vault, spoke address still absent', () => {
    const src = realToken(ARBITRUM, 'USDC'); // hubAsset !== vault → deposit branch
    expect(src.hubAsset.toLowerCase()).not.toBe(src.vault.toLowerCase());
    const dst = realToken(ChainKeys.SONIC_MAINNET, 'USDC');
    const amount = 1_000_000n;

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

    // Deposit translates 6 dp → 18 dp before the fee: 100 bps of the hub-unit amount.
    const hubUnits = EvmVaultTokenService.translateIncomingDecimals(src.decimals, amount);
    const { feeTarget, targets } = decodeFeeCall(data, hubUnits / 100n);
    expect(feeTarget.toLowerCase()).toBe(src.vault.toLowerCase());
    expect(targets.map(t => t.toLowerCase())).not.toContain(src.address.toLowerCase());
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

  it('rejects a Stacks raw intent when extras.srcPublicKey is missing', async () => {
    const result = await sodax.bridge.createBridgeIntent(stacksRawBridgeInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('srcPublicKey');
    }
  });

  it('passes extras.srcPublicKey through to the spoke deposit for a Stacks raw intent', async () => {
    const srcPublicKey = '025259f813b57dd5c3fcac09776d767a49f6dd77bba5895823b891e31b10a96a5d';
    const depositSpy = vi.spyOn(sodax.spoke, 'deposit').mockResolvedValue({ ok: true, value: { payload: '0xraw' } });

    const result = await sodax.bridge.createBridgeIntent(stacksRawBridgeInput({ srcPublicKey }));

    expect(result.ok).toBe(true);
    expect(depositSpy).toHaveBeenCalledWith(expect.objectContaining({ srcPublicKey }));
  });
});

// =========================================================================
// createBridgeIntent front-loaded validation invariants (parity with SwapService.createIntent)
// =========================================================================

describe('BridgeService.createBridgeIntent — validation invariants', () => {
  it('rejects raw=false when the wallet provider family mismatches the source chain', async () => {
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
  });

  it('rejects an unregistered spoke chain key up front as VALIDATION_FAILED', async () => {
    // Stub token resolution to succeed so the chain-key guard — not the token invariant — is what
    // rejects the unregistered key (reachable via casts / JS consumers).
    vi.spyOn(sodax.config, 'getSpokeTokenFromOriginalAssetAddress').mockReturnValue({
      address: SAMPLE_TOKEN,
      vault: '0xvault',
      symbol: 'X',
    } as never);

    const result = await sodax.bridge.createBridgeIntent({
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SodaxError);
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Invalid spoke chain');
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

  it('resolves a hub-asset srcToken/dstToken via the hub-asset map and bridges (no "Unsupported spoke chain")', async () => {
    const buildSpy = vi.spyOn(sodax.bridge, 'buildBridgeData').mockReturnValue('0xdata');

    const result = await sodax.bridge.createBridgeIntent(sonicWithdrawInput(BTC_HUB_ASSET, BTC_HUB_ASSET));

    expect(result.ok).toBe(true);
    // Both endpoints resolved to the BTC descriptor (sodaBTC vault), proving the hub-asset fallback.
    const buildCall = buildSpy.mock.calls[0];
    invariant(buildCall, 'buildBridgeData was not called');
    const [, srcToken, dstToken] = buildCall;
    expect(srcToken.vault.toLowerCase()).toBe(SODA_BTC_VAULT.toLowerCase());
    expect(dstToken.vault.toLowerCase()).toBe(SODA_BTC_VAULT.toLowerCase());
  });

  it('still rejects an unknown hub token that is neither a Sonic spoke token nor a hub asset', async () => {
    const result = await sodax.bridge.createBridgeIntent(sonicWithdrawInput(SAMPLE_TOKEN, SAMPLE_TOKEN));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Unsupported spoke chain');
    }
  });
});

describe('BridgeService.bridge — integration error-path coverage', () => {
  it('propagates a BridgeCreateIntentError from createBridgeIntent (subset narrowing)', async () => {
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
    // verifyTxHash and relayTxAndWaitPacket must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
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
  });

  it('wraps an out-of-union SodaxError thrown from createBridgeIntent as BRIDGE_FAILED', async () => {
    // The `isBridgeOrchestrationError` guard rejects codes outside BridgeOrchestrationErrorCode
    // (e.g. an accidental SWAP_RELAY_TIMEOUT thrown from somewhere inside the bridge
    // orchestration). The else-branch wraps it as BRIDGE_FAILED with the original on cause —
    // pinning that path here so a future regression that widens isBridgeOrchestrationError
    // (or accidentally narrows the catch behavior) surfaces immediately. Mirrors the 4 MM
    // out-of-union wrap-tests added in the previous review.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into bridge', {
      feature: 'bridge',
    });
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.dstChainKey).toBe(ARBITRUM);
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

  it('on backend "executed", returns the TxHashPair from the backend (no client-side relay)', async () => {
    stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
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

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.srcChainTxHash).toBe('0xspokeTx');
      expect(result.value.dstChainTxHash).toBe('0xDST');
    }
    // The backend owns the relay — the client-side relay must NOT run.
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('threads extras.apiKey into the backend submit-tx leg as a per-request override', async () => {
    stubCreatedAndVerified();
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    } as never);
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
    } as never);

    const result = await sodaxBE.bridge.bridge({
      ...bridgeInput(BSC, ARBITRUM),
      extras: { apiKey: 'per-action-key' },
    });

    expect(result.ok).toBe(true);
    // Both the POST and the status poll carry the per-action key (as RequestOverrideConfig.apiKey).
    expect(submitSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
    expect(statusSpy.mock.calls[0]?.[1]).toMatchObject({ apiKey: 'per-action-key' });
  });

  it('falls back to the client-side relay when the backend submit POST is rejected', async () => {
    stubCreatedAndVerified();
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
  });

  it('falls back when the backend reports a terminal "failed" status', async () => {
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

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dstChainTxHash).toBe('0xFALLBACKDST');
    expect(mocks.relayTxAndWaitPacket).toHaveBeenCalledOnce();
  });

  it('does not touch the backend submit API when the flag is off', async () => {
    // The module-level `sodax` opts out via `bridge.useBackendSubmitTx: false` → pure client-side flow.
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
    });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    const submitSpy = vi.spyOn(sodax.api.bridge, 'submitTx');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });

    const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM));

    expect(result.ok).toBe(true);
    expect(submitSpy).not.toHaveBeenCalled();
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

  it('treats a non-finite caller timeout as the default rather than stranding the broadcast deposit', async () => {
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
  });

  it('skips the backend POST entirely when the caller leaves no budget', async () => {
    stubCreatedAndVerified();
    // Stubbed even though the assertion is that it never runs: an unmocked spy calls through, so a
    // regression in the budget guard would turn this unit test into a real POST to the live backend.
    const submitSpy = vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValue({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'unreachable', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    const result = await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM, 0));

    expect(result.ok).toBe(true);
    // Firing the POST would only arm an abort at 0ms; the relay still runs on its floor because the
    // deposit has already landed on-chain.
    expect(submitSpy).not.toHaveBeenCalled();
    expect(mocks.relayTxAndWaitPacket.mock.calls.at(-1)?.[0]?.timeout).toBe(RELAY_FALLBACK_FLOOR_MS);
  });

  it('does not verify on-chain before handing the deposit to the backend', async () => {
    const verifySpy = stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: true,
      value: { success: true, data: { status: 'inserted', message: 'accepted' } },
    });
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockResolvedValueOnce({
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

    expect((await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM))).ok).toBe(true);
    // Backend success costs nothing in verification — verifying first would delay it by the source
    // chain's confirmation wait (up to its full `maxTimeoutMs`) and could fail a bridge the backend's
    // own infrastructure would have completed.
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('verifies exactly once, on the fallback, when the backend attempt does not complete', async () => {
    const verifySpy = stubCreatedAndVerified();
    vi.spyOn(sodaxBE.api.bridge, 'submitTx').mockResolvedValueOnce({
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', 'backend down', { feature: 'backend' }),
    });
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xFALLBACKDST' } });

    expect((await sodaxBE.bridge.bridge(bridgeInput(BSC, ARBITRUM))).ok).toBe(true);
    // The backend attempt costs nothing in verification; the fallback pays for it once, and only then.
    expect(verifySpy).toHaveBeenCalledOnce();
  });

  it('raises a sub-floor caller timeout to the relay floor on the default path', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
        ok: true,
        value: { tx: '0xspokeTx', relayData: { address: HUB_WALLET, payload: '0x' } },
      });
      vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
      mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: true, value: { dst_tx_hash: '0xdstTx' } });

      const result = await sodax.bridge.bridge(bridgeInput(BSC, ARBITRUM, 2_000));

      expect(result.ok).toBe(true);
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

  it('sends extras.apiKey over the instance key on both the submit POST and the status poll', async () => {
    await runKeyedBridge({ apiKey: 'action-key' });
    expect(keySentTo('/v1/bridge/submit-tx', 'POST')).toBe('action-key');
    expect(keySentTo('/v1/bridge/submit-tx/status', 'GET')).toBe('action-key');
  });

  it('sends the instance key on both requests when extras is omitted', async () => {
    await runKeyedBridge();
    expect(keySentTo('/v1/bridge/submit-tx', 'POST')).toBe('instance-key');
    expect(keySentTo('/v1/bridge/submit-tx/status', 'GET')).toBe('instance-key');
  });

  it('treats an empty extras.apiKey as unset: the instance key still rides both requests', async () => {
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
  it('defaults useBackendSubmitTx to true and exposes sodax.api.bridge', () => {
    const s = new Sodax();
    expect(s.bridge.useBackendSubmitTx).toBe(true);
    expect(s.swaps.useBackendSubmitTx).toBe(true);
    expect(s.api.bridge).toBeDefined();
  });

  it('threads bridge.useBackendSubmitTx=false into the BridgeService', () => {
    const s = new Sodax({ bridge: { useBackendSubmitTx: false } });
    expect(s.bridge.useBackendSubmitTx).toBe(false);
    expect(s.swaps.useBackendSubmitTx).toBe(true);
  });

  it('keeps the bridge toggle independent of swaps.useBackendSubmitTx', () => {
    const s = new Sodax({ swaps: { useBackendSubmitTx: false } });
    expect(s.swaps.useBackendSubmitTx).toBe(false);
    expect(s.bridge.useBackendSubmitTx).toBe(true);
  });

  it('resolves the effective toggle on ConfigService, so config and behavior never disagree', () => {
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

  it('honours the deprecated swapsOptions / bridgeOptions opt-out', () => {
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
  });

  it('gives the new swaps / bridge keys precedence over the deprecated ones', () => {
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

  it("approves the caller's own hub wallet on the hub (Sonic), not the swaps intents contract", async () => {
    // Swaps resolves the hub spender synchronously from `solver.intentsContract`; reusing that here
    // would approve the wrong contract and still typecheck.
    vi.spyOn(sodax.bridge.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    const result = await sodax.bridge.buildApproveTxs(approveInput(SONIC));

    expect(result).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(sodax.bridge.hubProvider.getUserHubWalletAddress).toHaveBeenCalledWith(SAMPLE_USER, SONIC);
    expect(sodax.bridge.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({ srcChainKey: SONIC, spender: HUB_WALLET, raw: true }),
    );
  });

  it('approves the asset manager on an EVM spoke', async () => {
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    const result = await sodax.bridge.buildApproveTxs(approveInput(BSC));

    expect(result).toEqual({ ok: true, value: { approveTx: rawTx } });
    expect(sodax.bridge.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({
        srcChainKey: BSC,
        spender: sodax.bridge.config.getChainConfig(BSC).addresses.assetManager,
        raw: true,
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

  it('passes the bridge amount, source token and owner through as the approval target', async () => {
    const input = approveInput(BSC);
    vi.spyOn(sodax.bridge.spoke, 'buildApproveTxs').mockResolvedValueOnce({ ok: true, value: { approveTx: rawTx } });

    await sodax.bridge.buildApproveTxs(input);

    expect(sodax.bridge.spoke.buildApproveTxs).toHaveBeenCalledWith(
      expect.objectContaining({
        token: input.params.srcToken,
        amount: input.params.amount,
        owner: input.params.srcAddress,
      }),
    );
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

  it('rejects an unsupported chain (Solana) rather than building a meaningless approval', async () => {
    const result = await sodax.bridge.buildApproveTxs(approveInput(SOLANA));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(String(result.error.message)).toMatch(/Approval only supported/);
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

  it('rejects a zero amount, matching approve()', async () => {
    const input = approveInput(BSC);
    const result = await sodax.bridge.buildApproveTxs({ ...input, params: { ...input.params, amount: 0n } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(String(result.error.message)).toMatch(/Amount must be greater than 0/);
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
  const delivered = [{ status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID }];

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getTransactionPackets.mockReset();
  });

  it('returns the unmodified submit-tx record without touching the relay', async () => {
    record({ status: 'relaying' });

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(result.ok, 'expected a backend answer');
    expect(result.value.source).toBe('backend');
    invariant(result.value.source === 'backend', 'narrowing');
    expect(result.value.data.status).toBe('relaying');
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
  });

  it('passes a per-request override to the backend read', async () => {
    const statusSpy = record({ status: 'pending' });

    await sodaxBE.bridge.getDetailedStatus(key, { apiKey: 'per-action-key' });

    expect(statusSpy).toHaveBeenCalledWith({ txHash: SRC_TX, srcChainKey: ARBITRUM }, { apiKey: 'per-action-key' });
  });

  it.each([
    ['no record exists', () => backendFails('not found', 404)],
    ['the record reports a success:false envelope', () => recordNotFound()],
    ['the backend gave up terminally', () => record({ status: 'failed' })],
    ['the backend abandoned the record mid-flight', () => record({ status: 'relayed', abandonedAt: 'now' })],
    ['the backend is unreachable', () => backendFails('backend unavailable', 503)],
  ])('routes to the relay packet when %s', async (_case, arrange) => {
    arrange();
    packets(delivered);

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(result.ok, 'expected the relay to answer');
    expect(result.value.source).toBe('relay');
    invariant(result.value.source === 'relay', 'narrowing');
    expect(result.value.data.dst_tx_hash).toBe(DST_TX);
  });

  it('never returns a packet that is not a delivered match for this tx', async () => {
    backendFails('not found', 404);
    packets([
      { status: 'executed', dst_tx_hash: DST_TX, src_tx_hash: '0xsomeoneelse', src_chain_id: RELAY_CHAIN_ID },
      { status: 'validating', dst_tx_hash: '', src_tx_hash: SRC_TX, src_chain_id: RELAY_CHAIN_ID },
    ]);

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(!result.ok, 'expected LOOKUP_FAILED');
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });

  it('tags only the undelivered-packet miss as budgetable, not an outage', async () => {
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

  it.each([401, 403])('treats a rejected API key as terminal instead of degrading (%i)', async status => {
    backendFails('rejected', status);

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(!result.ok, 'expected LOOKUP_FAILED');
    // Lifted so `isAuthFailure` recognises the wrapped error — it reads `context.status` only.
    expect(result.error.context?.status).toBe(status);
    expect(isAuthFailure(result.error)).toBe(true);
    expect(result.error.context?.reason).toBeUndefined();
    expect(mocks.getTransactionPackets).not.toHaveBeenCalled();
  });

  it('returns a Result rather than rejecting when a dependency throws', async () => {
    vi.spyOn(sodaxBE.api.bridge, 'getSubmitTxStatus').mockRejectedValueOnce(new Error('boom'));

    const result = await sodaxBE.bridge.getDetailedStatus(key);

    invariant(!result.ok, 'expected LOOKUP_FAILED');
    expect(result.error.code).toBe('LOOKUP_FAILED');
  });
});
