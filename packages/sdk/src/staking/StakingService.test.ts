/**
 * Integration tests for the StakingService orchestrators.
 *
 * Mirrors the fixture pattern established in MoneyMarketService.test.ts and
 * BridgeService.test.ts:
 *   - The statically imported `relayTxAndWaitPacket` is spied on its module namespace and bound
 *     to a standalone `vi.fn()`, so each test can configure relay outcomes.
 *   - One real `Sodax` instance backs every test; instance methods we want to control
 *     (`sodax.staking.createStakeIntent`, `sodax.spoke.verifyTxHash`, etc.) are stubbed
 *     per-test with `vi.spyOn(...).mockResolvedValueOnce(...)`.
 *
 * Scope: the wrap-paths in the 5 staking orchestrators that the unit-level error-types
 * and relay-error-mapping tests don't cover end-to-end. `stake()` gets full coverage
 * (it is the only orchestrator that calls `spoke.verifyTxHash`); the other 4 get a
 * shared out-of-union SodaxError wrap-path smoke test.
 *
 * Per the migration plan we use **local `satisfies SpokeChainKey` literal fixtures**
 * (no `../../../types/src/...` deep imports) — bridge's test file used the deep import
 * but staking should not repeat that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, type Address, type Result, type SpokeChainKey } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SodaxError } from '../errors/SodaxError.js';
import * as IntentRelayApiService from '../shared/services/intentRelay/IntentRelayApiService.js';
import { expectErr, expectOk } from '../test-utils/result.js';
import { mockEvmWalletProvider } from '../test-utils/walletProviders.js';
import type {
  CancelUnstakeAction,
  ClaimAction,
  InstantUnstakeAction,
  StakeAction,
  UnstakeAction,
} from './StakingService.js';

const mocks = { relayTxAndWaitPacket: vi.fn() };

const sodax = new Sodax();

// Local SpokeChainKey fixtures — staking is initiated from a non-hub chain so the
// relay branch fires. BSC is a well-supported EVM spoke.
const BSC = '0x38.bsc' satisfies SpokeChainKey;

// Every EVM spoke registering SODA, so a bad per-chain token entry fails on its own chain; Sonic
// guards the hub-as-source path that previously masked the SODA-asset bug.
const EVM_SPOKES = [
  'sonic',
  '0x2105.base',
  '0x38.bsc',
  '0xa4b1.arbitrum',
  '0xa86a.avax',
  '0xa.optimism',
  '0x89.polygon',
  'hyper',
  'lightlink',
  'ethereum',
  'redbelly',
  '0x2019.kaia',
] as const satisfies readonly SpokeChainKey[];
type EvmSpokeFixture = (typeof EVM_SPOKES)[number];

const SAMPLE_USER = '0x4444444444444444444444444444444444444444' as Address;
const SAMPLE_TOKEN = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address;
const SPOKE_TX_HASH = '0xspokeTxHash';

const mockEvmProvider = mockEvmWalletProvider();

const stakeInput = (): StakeAction<typeof BSC, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey: BSC,
      srcAddress: SAMPLE_USER,
      amount: 1_000_000n,
      minReceive: 900_000n,
      action: 'stake',
    },
  }) as StakeAction<typeof BSC, false>;

const unstakeInput = (): UnstakeAction<typeof BSC, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey: BSC,
      srcAddress: SAMPLE_USER,
      amount: 1_000_000n,
      action: 'unstake',
    },
  }) as UnstakeAction<typeof BSC, false>;

const instantUnstakeInput = (): InstantUnstakeAction<typeof BSC, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey: BSC,
      srcAddress: SAMPLE_USER,
      amount: 1_000_000n,
      minAmount: 900_000n,
      action: 'instantUnstake',
    },
  }) as InstantUnstakeAction<typeof BSC, false>;

const claimInput = (): ClaimAction<typeof BSC, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey: BSC,
      srcAddress: SAMPLE_USER,
      requestId: 1n,
      amount: 1_000_000n,
      action: 'claim',
    },
  }) as ClaimAction<typeof BSC, false>;

const cancelUnstakeInput = (): CancelUnstakeAction<typeof BSC, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey: BSC,
      srcAddress: SAMPLE_USER,
      requestId: 1n,
      action: 'cancelUnstake',
    },
  }) as CancelUnstakeAction<typeof BSC, false>;

const HUB_WALLET = '0x1111111111111111111111111111111111111111' as Address;
const validIntent = {
  tx: SPOKE_TX_HASH,
  relayData: { address: HUB_WALLET, payload: '0x' as Address, srcToken: SAMPLE_TOKEN },
};

// Every test stubs the other collaborators it cares about.
beforeEach(() => {
  vi.spyOn(IntentRelayApiService, 'relayTxAndWaitPacket').mockImplementation(mocks.relayTxAndWaitPacket);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('StakingService.stake — integration error-path coverage', () => {
  it('forwards an intent failure, maps verify and relay failures, and wraps a foreign SodaxError', async () => {
    // A createStakeIntent error code is in CreateStakeIntentErrorCode (a subset of StakeErrorCode), so
    // `stake()` returns the same SodaxError unchanged — no extra wrap, no code rewrite.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'spoke deposit reverted', {
      feature: 'staking',
      context: { srcChainKey: BSC, action: 'stake', phase: 'intentCreation' },
    });
    // The `isStakeOrchestrationError` guard rejects codes outside StakeErrorCode, so a foreign code thrown
    // inside the orchestration is wrapped with the original on cause. Mirrors the bridge & MM wrap-tests.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into staking', {
      feature: 'staking',
    });
    vi.spyOn(sodax.staking, 'createStakeIntent')
      .mockResolvedValueOnce({ ok: false, error: intentError })
      .mockResolvedValueOnce({ ok: true, value: validIntent })
      .mockResolvedValueOnce({ ok: true, value: validIntent })
      .mockRejectedValueOnce(outOfUnion);
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'verifyTxHash')
      .mockResolvedValueOnce({ ok: false, error: verifyError })
      .mockResolvedValueOnce({ ok: true, value: true });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });
    const run = () => sodax.staking.stake(stakeInput());

    // Identity check — the SodaxError must be the *same* instance, not a re-wrapped clone.
    const forwarded = expectErr(await run(), 'INTENT_CREATION_FAILED');
    expect(forwarded).toBe(intentError);

    // The original errors stay reachable on `cause` for forensics.
    const verifyFailure = expectErr(await run(), 'TX_VERIFICATION_FAILED', {
      phase: 'verify',
      srcChainKey: BSC,
      action: 'stake',
    });
    expect(verifyFailure.cause).toBe(verifyError);
    // Neither failure reached the relay.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();

    const relayFailure = expectErr(await run(), 'RELAY_TIMEOUT', { action: 'stake', relayCode: 'RELAY_TIMEOUT' });
    expect(relayFailure.cause).toBe(relayError);

    const wrapped = expectErr(await run(), 'EXECUTION_FAILED', { srcChainKey: BSC, action: 'stake' });
    expect(wrapped.cause).toBe(outOfUnion);
  });
});

describe('StakingService — out-of-union wrap-path smoke for non-stake orchestrators', () => {
  it('unstake / instantUnstake / claim / cancelUnstake each wrap a foreign SodaxError as EXECUTION_FAILED', async () => {
    const cases = [
      {
        action: 'unstake',
        stub: 'createUnstakeIntent',
        run: () => sodax.staking.unstake(unstakeInput()),
      },
      {
        action: 'instantUnstake',
        stub: 'createInstantUnstakeIntent',
        run: () => sodax.staking.instantUnstake(instantUnstakeInput()),
      },
      { action: 'claim', stub: 'createClaimIntent', run: () => sodax.staking.claim(claimInput()) },
      {
        action: 'cancelUnstake',
        stub: 'createCancelUnstakeIntent',
        run: () => sodax.staking.cancelUnstake(cancelUnstakeInput()),
      },
    ] as const;

    for (const { action, stub, run } of cases) {
      const outOfUnion = new SodaxError('BRIDGE_FAILED' as never, 'foreign code thrown into staking', {
        feature: 'staking',
      });
      vi.spyOn(sodax.staking, stub).mockRejectedValueOnce(outOfUnion);

      const error = expectErr(await run(), 'EXECUTION_FAILED', { action }, action);

      expect(error.cause, action).toBe(outOfUnion);
    }
  });
});

// Chain-context regression matrix.
//
// The previous createInstantUnstakeIntent implementation read SODA from the hub
// config and then queried the source-spoke registry by the hub-side address — a
// chain-context bug that returned undefined for every non-Sonic spoke and tripped
// the "SODA asset not found" invariant. createStakeIntent and createClaimIntent
// also perform per-spoke SODA lookups and are vulnerable to the same class of
// mistake. createUnstakeIntent reads only hub-side xSoda state and createCancel-
// UnstakeIntent has no per-chain token lookup, so neither participates here.
//
// Running each method on every SODA spoke catches both regressions per chain.
const stakeInputFor = <K extends EvmSpokeFixture>(srcChainKey: K): StakeAction<K, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey,
      srcAddress: SAMPLE_USER,
      amount: 1_000_000n,
      minReceive: 900_000n,
      action: 'stake',
    },
  }) as StakeAction<K, false>;

const instantUnstakeInputFor = <K extends EvmSpokeFixture>(srcChainKey: K): InstantUnstakeAction<K, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey,
      srcAddress: SAMPLE_USER,
      amount: 1_000_000n,
      minAmount: 900_000n,
      action: 'instantUnstake',
    },
  }) as InstantUnstakeAction<K, false>;

const claimInputFor = <K extends EvmSpokeFixture>(srcChainKey: K): ClaimAction<K, false> =>
  ({
    raw: false,
    walletProvider: mockEvmProvider,
    params: {
      srcChainKey,
      srcAddress: SAMPLE_USER,
      requestId: 1n,
      amount: 1_000_000n,
      action: 'claim',
    },
  }) as ClaimAction<K, false>;

describe('StakingService — per-chain SODA lookup', () => {
  it.each(EVM_SPOKES)('stake, instantUnstake and claim intents build on srcChainKey=%s', async srcChainKey => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValue(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: SPOKE_TX_HASH });
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValue({ ok: true, value: SPOKE_TX_HASH });

    const stake = expectOk(await sodax.staking.createStakeIntent(stakeInputFor(srcChainKey)), 'stake');
    expect(stake.tx).toBe(SPOKE_TX_HASH);
    expect(stake.relayData.payload.startsWith('0x')).toBe(true);

    for (const [label, result] of [
      ['instantUnstake', await sodax.staking.createInstantUnstakeIntent(instantUnstakeInputFor(srcChainKey))],
      ['claim', await sodax.staking.createClaimIntent(claimInputFor(srcChainKey))],
    ] as const) {
      const { tx, relayData } = expectOk(result, label);
      expect(tx, label).toBe(SPOKE_TX_HASH);
      expect(relayData.address, label).toBe(HUB_WALLET);
      expect(relayData.payload.startsWith('0x'), label).toBe(true);
    }
  });
});

// Staking settles through the intent relay, which an MPC-relay chain does not use.
describe('StakingService — MPC-relay source', () => {
  it.each([
    'tron',
    ChainKeys.MONAD_MAINNET,
  ] as const)('refuses every staking action from %s before signing', async srcChainKey => {
    const hubWallet = vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress');
    const sendMessage = vi.spyOn(sodax.spoke, 'sendMessage');
    const deposit = vi.spyOn(sodax.spoke, 'deposit');

    const results = [
      await sodax.staking.createStakeIntent({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, amount: 1n, minReceive: 1n, action: 'stake' },
      }),
      await sodax.staking.isAllowanceValid({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, amount: 1n, minReceive: 1n, action: 'stake' },
      }),
      await sodax.staking.approve({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, amount: 1n, minReceive: 1n, action: 'stake' },
      }),
      await sodax.staking.createUnstakeIntent({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, amount: 1n, action: 'unstake' },
      }),
      await sodax.staking.createCancelUnstakeIntent({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, requestId: 1n, action: 'cancelUnstake' },
      }),
      await sodax.staking.createInstantUnstakeIntent({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, amount: 1n, minAmount: 1n, action: 'instantUnstake' },
      }),
      await sodax.staking.createClaimIntent({
        raw: true,
        params: { srcChainKey, srcAddress: SAMPLE_USER, requestId: 1n, amount: 1n, action: 'claim' },
      }),
    ];

    results.forEach((result: Result<unknown, unknown>, index) => {
      expectErr(result, 'VALIDATION_FAILED', { field: 'srcChainKey' }, `action #${index}`);
    });
    expect(hubWallet).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(deposit).not.toHaveBeenCalled();
  });
});
