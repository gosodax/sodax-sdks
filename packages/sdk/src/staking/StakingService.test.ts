/**
 * Integration tests for the StakingService orchestrators.
 *
 * Mirrors the fixture pattern established in MoneyMarketService.test.ts and
 * BridgeService.test.ts:
 *   - `vi.mock` at the source path replaces the static `relayTxAndWaitPacket` import
 *     with a hoisted `vi.fn()` so each test can configure relay outcomes.
 *   - One real `Sodax` instance backs every test; instance methods we want to control
 *     (`sodax.staking.createStakeIntent`, `sodax.spoke.verifyTxHash`, etc.) are stubbed
 *     per-test with `vi.spyOn(...).mockResolvedValueOnce(...)`.
 *
 * Scope: the wrap-paths in the 5 staking orchestrators that the unit-level error-types
 * and relay-error-mapping tests don't cover end-to-end. `stake()` gets full coverage
 * (it is the only orchestrator that calls `spoke.verifyTxHash`); the other 4 get a
 * single out-of-union SodaxError wrap-path smoke test each.
 *
 * Per the migration plan we use **local `satisfies SpokeChainKey` literal fixtures**
 * (no `../../../types/src/...` deep imports) — bridge's test file used the deep import
 * but staking should not repeat that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, IEvmWalletProvider, SpokeChainKey } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SodaxError } from '../errors/SodaxError.js';
import type {
  CancelUnstakeAction,
  ClaimAction,
  InstantUnstakeAction,
  StakeAction,
  UnstakeAction,
} from './StakingService.js';

const mocks = vi.hoisted(() => ({
  relayTxAndWaitPacket: vi.fn(),
}));
vi.mock('../shared/services/intentRelay/IntentRelayApiService.js', async () => {
  const actual = await vi.importActual<object>('../shared/services/intentRelay/IntentRelayApiService.js');
  return {
    ...actual,
    relayTxAndWaitPacket: mocks.relayTxAndWaitPacket,
  };
});

const sodax = new Sodax();

// Local SpokeChainKey fixtures — staking is initiated from a non-hub chain so the
// relay branch fires. BSC is a well-supported EVM spoke.
const BSC = '0x38.bsc' satisfies SpokeChainKey;

// Every EVM spoke that registers a SODA token. The matrix below runs the staking
// intent creators across all of them so any chain-context regression surfaces on
// the affected chain instead of hiding behind a single fixture. Sonic is included
// to guard the hub-as-source path that previously masked the SODA-asset bug.
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

const mockEvmProvider = {
  chainType: 'EVM',
  sendTransaction: vi.fn(),
  getWalletAddress: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
} as unknown as IEvmWalletProvider;

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

beforeEach(() => {
  // No defaults needed — every test stubs the collaborators it cares about.
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('StakingService.stake — integration error-path coverage', () => {
  it('propagates a StakingCreateIntentError from createStakeIntent (subset narrowing, identity)', async () => {
    // `stake()` first calls `createStakeIntent`. When that returns `{ ok: false, error }`,
    // the error code is in CreateStakeIntentErrorCode (a subset of StakeErrorCode), so
    // `stake()` returns the same SodaxError unchanged — no extra wrap, no code rewrite.
    const intentError = new SodaxError('INTENT_CREATION_FAILED', 'spoke deposit reverted', {
      feature: 'staking',
      context: { srcChainKey: BSC, action: 'stake', phase: 'intentCreation' },
    });
    vi.spyOn(sodax.staking, 'createStakeIntent').mockResolvedValueOnce({ ok: false, error: intentError });

    const result = await sodax.staking.stake(stakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Identity check — the SodaxError must be the *same* instance, not a re-wrapped clone.
    expect(result.error).toBe(intentError);
    expect(result.error.code).toBe('INTENT_CREATION_FAILED');
    // verifyTxHash and relayTxAndWaitPacket must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a verifyTxHash failure as STAKING_VERIFY_FAILED with cause + phase + chain + action', async () => {
    // createStakeIntent succeeds, then verifyTxHash returns ok:false. `stake()` must wrap
    // the underlying error as STAKING_VERIFY_FAILED with the original on `cause` and the
    // chain context preserved on `error.context`.
    vi.spyOn(sodax.staking, 'createStakeIntent').mockResolvedValueOnce({ ok: true, value: validIntent });
    const verifyError = new Error('VERIFY_FAILED');
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: false, error: verifyError });

    const result = await sodax.staking.stake(stakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TX_VERIFICATION_FAILED');
    // Identity check on cause — the original error is reachable for forensics.
    expect(result.error.cause).toBe(verifyError);
    expect(result.error.context?.phase).toBe('verify');
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.action).toBe('stake');
    // Relay must not have been called.
    expect(mocks.relayTxAndWaitPacket).not.toHaveBeenCalled();
  });

  it('wraps a relayTxAndWaitPacket failure via mapRelayFailureToStakingError', async () => {
    vi.spyOn(sodax.staking, 'createStakeIntent').mockResolvedValueOnce({ ok: true, value: validIntent });
    vi.spyOn(sodax.spoke, 'verifyTxHash').mockResolvedValueOnce({ ok: true, value: true });
    const relayError = new Error('RELAY_TIMEOUT');
    mocks.relayTxAndWaitPacket.mockResolvedValueOnce({ ok: false, error: relayError });

    const result = await sodax.staking.stake(stakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('RELAY_TIMEOUT');
    expect(result.error.cause).toBe(relayError);
    expect(result.error.context?.action).toBe('stake');
    expect(result.error.context?.relayCode).toBe('RELAY_TIMEOUT');
  });

  it('wraps an out-of-union SodaxError thrown from createStakeIntent as STAKING_STAKE_FAILED', async () => {
    // The `isStakeOrchestrationError` guard rejects codes outside StakeErrorCode (e.g. an accidental
    // SWAP_RELAY_TIMEOUT thrown from somewhere inside the stake orchestration). The
    // else-branch wraps it as STAKING_STAKE_FAILED with the original on cause —
    // pinning that path here so a future regression that widens isStakeOrchestrationError surfaces
    // immediately. Mirrors the bridge & MM out-of-union wrap-tests.
    const outOfUnion = new SodaxError('SWAP_RELAY_TIMEOUT' as never, 'foreign code thrown into staking', {
      feature: 'staking',
    });
    vi.spyOn(sodax.staking, 'createStakeIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.staking.stake(stakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.srcChainKey).toBe(BSC);
    expect(result.error.context?.action).toBe('stake');
  });
});

// Smoke tests — confirm every other orchestrator wraps a thrown out-of-union SodaxError
// to its STAKING_<OP>_FAILED catch-all (the `is<Op>Error` guard's else-branch). Pins the
// wrap machinery on every orchestrator without duplicating the full 4-test matrix.

describe('StakingService — out-of-union wrap-path smoke for non-stake orchestrators', () => {
  it('unstake wraps as STAKING_UNSTAKE_FAILED', async () => {
    const outOfUnion = new SodaxError('BRIDGE_FAILED' as never, 'foreign code thrown into staking', {
      feature: 'staking',
    });
    vi.spyOn(sodax.staking, 'createUnstakeIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.staking.unstake(unstakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.action).toBe('unstake');
  });

  it('instantUnstake wraps as STAKING_INSTANT_UNSTAKE_FAILED', async () => {
    const outOfUnion = new SodaxError('MM_SUPPLY_FAILED' as never, 'foreign code thrown into staking', {
      feature: 'staking',
    });
    vi.spyOn(sodax.staking, 'createInstantUnstakeIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.staking.instantUnstake(instantUnstakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.action).toBe('instantUnstake');
  });

  it('claim wraps as STAKING_CLAIM_FAILED', async () => {
    const outOfUnion = new SodaxError('SWAP_FAILED' as never, 'foreign code thrown into staking', {
      feature: 'staking',
    });
    vi.spyOn(sodax.staking, 'createClaimIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.staking.claim(claimInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.action).toBe('claim');
  });

  it('cancelUnstake wraps as STAKING_CANCEL_UNSTAKE_FAILED', async () => {
    const outOfUnion = new SodaxError('MM_BORROW_FAILED' as never, 'foreign code thrown into staking', {
      feature: 'staking',
    });
    vi.spyOn(sodax.staking, 'createCancelUnstakeIntent').mockRejectedValueOnce(outOfUnion);

    const result = await sodax.staking.cancelUnstake(cancelUnstakeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXECUTION_FAILED');
    expect(result.error.cause).toBe(outOfUnion);
    expect(result.error.context?.action).toBe('cancelUnstake');
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
// Running each method across BSC + BASE + SONIC catches both the non-Sonic-only
// regression and any future regression on the hub-as-source path.
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

describe.each(EVM_SPOKES)('StakingService — per-chain SODA lookup on srcChainKey=%s', srcChainKey => {
  it('createStakeIntent builds the intent payload without throwing chain-context invariants', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'deposit').mockResolvedValueOnce({ ok: true, value: SPOKE_TX_HASH });

    const result = await sodax.staking.createStakeIntent(stakeInputFor(srcChainKey));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe(SPOKE_TX_HASH);
    expect(result.value.relayData.payload.startsWith('0x')).toBe(true);
  });

  it('createInstantUnstakeIntent builds the intent payload without throwing chain-context invariants', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: SPOKE_TX_HASH });

    const result = await sodax.staking.createInstantUnstakeIntent(instantUnstakeInputFor(srcChainKey));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe(SPOKE_TX_HASH);
    expect(result.value.relayData.address).toBe(HUB_WALLET);
    expect(result.value.relayData.payload.startsWith('0x')).toBe(true);
  });

  it('createClaimIntent builds the intent payload without throwing chain-context invariants', async () => {
    vi.spyOn(sodax.hubProvider, 'getUserHubWalletAddress').mockResolvedValueOnce(HUB_WALLET);
    vi.spyOn(sodax.spoke, 'sendMessage').mockResolvedValueOnce({ ok: true, value: SPOKE_TX_HASH });

    const result = await sodax.staking.createClaimIntent(claimInputFor(srcChainKey));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tx).toBe(SPOKE_TX_HASH);
    expect(result.value.relayData.address).toBe(HUB_WALLET);
    expect(result.value.relayData.payload.startsWith('0x')).toBe(true);
  });
});
