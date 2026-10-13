import {
  ATOMIC_BATCH_UNCONFIRMED,
  ChainKeys,
  HookKind,
  SodaxError,
  type CreateIntentParams,
  type SwapWithApprovalResponse,
} from '@sodax/sdk';
import { describe, expect, it } from 'vitest';
import type { NearStorageGateState } from './nearStorageGate.js';
import type { StellarGateState } from './stellarGate.js';
import {
  isSameIntent,
  resolveSwapLifecycle,
  toSwapAttempt,
  type SwapAttemptSource,
  type SwapLifecycleInputs,
} from './swapLifecycle.js';

const PARAMS: CreateIntentParams = {
  inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 100n,
  allowPartialFill: false,
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};

const RESPONSE = {
  intentDeliveryInfo: { srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc' },
  approvalStrategy: 'atomic-batch',
} as unknown as SwapWithApprovalResponse; // Only intentDeliveryInfo is read; the rest is irrelevant here.

const mutation = (overrides: Partial<SwapAttemptSource> = {}): SwapAttemptSource => ({
  status: 'idle',
  data: undefined,
  error: null,
  variables: undefined,
  ...overrides,
});

const OPEN_STELLAR: StellarGateState = {
  isStellar: false,
  needsActivation: false,
  needsFunding: false,
  needsTrustline: false,
  checkFailed: false,
  blocksAction: false,
};
const OPEN_NEAR: NearStorageGateState = { isNear: false, needsRegistration: false, blocksAction: false };

const inputs = (overrides: Partial<SwapLifecycleInputs> = {}): SwapLifecycleInputs => ({
  attempt: { phase: 'none' },
  status: undefined,
  statusError: undefined,
  hasInputs: true,
  stellar: OPEN_STELLAR,
  nearStorage: OPEN_NEAR,
  externalBlocked: false,
  setupBusy: false,
  isWrongChain: false,
  strategy: { data: 'atomic-batch', error: null },
  ...overrides,
});

describe('isSameIntent', () => {
  it('treats a rebuilt deadline as the same swap', () => {
    expect(isSameIntent(PARAMS, { ...PARAMS, deadline: 999n })).toBe(true);
  });

  it('treats a different amount or recipient as a different swap', () => {
    expect(isSameIntent(PARAMS, { ...PARAMS, inputAmount: 2n })).toBe(false);
    expect(isSameIntent(PARAMS, { ...PARAMS, dstAddress: '0x3333333333333333333333333333333333333333' })).toBe(false);
  });

  it('treats turning a delivery hook on, or changing data or fill mode, as a different swap', () => {
    expect(isSameIntent(PARAMS, { ...PARAMS, hook: { kind: HookKind.FLINT_DEPOSIT } })).toBe(false);
    expect(isSameIntent(PARAMS, { ...PARAMS, data: '0x01' })).toBe(false);
    expect(isSameIntent(PARAMS, { ...PARAMS, allowPartialFill: true })).toBe(false);
    expect(isSameIntent(PARAMS, { ...PARAMS, deliveryData: '0x02' })).toBe(false);
  });
});

describe('toSwapAttempt', () => {
  it('has no attempt before the first swap', () => {
    expect(toSwapAttempt(mutation(), PARAMS)).toEqual({ phase: 'none' });
  });

  it('reports any in-flight swap, even after the params changed', () => {
    const pending = mutation({ status: 'pending', variables: { params: PARAMS } });
    expect(toSwapAttempt(pending, { ...PARAMS, inputAmount: 5n })).toEqual({ phase: 'submitting' });
  });

  it('tracks a successful swap by its source tx while the params are unchanged', () => {
    const done = mutation({ status: 'success', data: RESPONSE, variables: { params: PARAMS } });
    expect(toSwapAttempt(done, PARAMS)).toEqual({
      phase: 'broadcast',
      srcChainKey: ChainKeys.BSC_MAINNET,
      srcTxHash: '0xsrc',
    });
  });

  it('forgets a finished swap once the params change', () => {
    const done = mutation({ status: 'success', data: RESPONSE, variables: { params: PARAMS } });
    expect(toSwapAttempt(done, { ...PARAMS, inputAmount: 5n })).toEqual({ phase: 'none' });
    expect(toSwapAttempt(done, undefined)).toEqual({ phase: 'none' });
  });

  // A refreshed quote rebuilds the params with a new minimum output.
  const REQUOTED: CreateIntentParams = { ...PARAMS, minOutputAmount: 899_000n };

  it('keeps tracking a swap that failed after broadcast, even after the params changed', () => {
    const error = new SodaxError('RELAY_TIMEOUT', 'relay timed out', {
      feature: 'swap',
      context: { srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc' },
    });
    const failed = mutation({ status: 'error', error, variables: { params: PARAMS } });
    const tracked = { phase: 'broadcast', srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc', error };
    expect(toSwapAttempt(failed, PARAMS)).toEqual(tracked);
    expect(toSwapAttempt(failed, REQUOTED)).toEqual(tracked);
    expect(toSwapAttempt(failed, undefined)).toEqual(tracked);
  });

  it('holds a batch the wallet accepted but never confirmed as unconfirmed, never as a retryable failure', () => {
    const error = new SodaxError('TX_VERIFICATION_FAILED', 'batch not confirmed', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' },
    });
    const failed = mutation({ status: 'error', error, variables: { params: PARAMS } });
    expect(toSwapAttempt(failed, PARAMS)).toEqual({ phase: 'unconfirmed', batchId: 'batch-1', error });
    // It may still land, so new params must not re-enable the swap.
    expect(toSwapAttempt(failed, REQUOTED)).toEqual({ phase: 'unconfirmed', batchId: 'batch-1', error });
  });

  it('reports a failure before broadcast as failed', () => {
    const error = new SodaxError('USER_REJECTED', 'User rejected the request', { feature: 'swap' });
    const failed = mutation({ status: 'error', error, variables: { params: PARAMS } });
    expect(toSwapAttempt(failed, PARAMS)).toEqual({ phase: 'failed', error });
    expect(toSwapAttempt(failed, REQUOTED)).toEqual({ phase: 'none' });
  });
});

describe('resolveSwapLifecycle', () => {
  const broadcast = { phase: 'broadcast', srcChainKey: ChainKeys.BSC_MAINNET, srcTxHash: '0xsrc' } as const;

  it('is ready with the approval strategy once nothing blocks', () => {
    expect(resolveSwapLifecycle(inputs())).toEqual({ kind: 'ready', approvalStrategy: 'atomic-batch' });
  });

  it('is idle without intent params or a wallet', () => {
    expect(resolveSwapLifecycle(inputs({ hasInputs: false }))).toEqual({ kind: 'idle' });
  });

  it('is submitting while the swap is in flight, whatever else holds', () => {
    expect(resolveSwapLifecycle(inputs({ attempt: { phase: 'submitting' }, isWrongChain: true }))).toEqual({
      kind: 'submitting',
    });
  });

  it('follows a broadcast swap through pending, settled and failed', () => {
    expect(resolveSwapLifecycle(inputs({ attempt: broadcast }))).toEqual({ kind: 'pending', ...stripPhase(broadcast) });
    expect(
      resolveSwapLifecycle(inputs({ attempt: broadcast, status: { state: 'solved', fillTxHash: '0xfill' } })),
    ).toEqual({ kind: 'settled', ...stripPhase(broadcast), fillTxHash: '0xfill' });
    const failed = resolveSwapLifecycle(inputs({ attempt: broadcast, status: { state: 'failed' } }));
    expect(failed).toMatchObject({ kind: 'failed', ...stripPhase(broadcast) });
  });

  it('keeps a post-broadcast failure pending, with its error, until the status says otherwise', () => {
    const error = new Error('relay timed out');
    expect(resolveSwapLifecycle(inputs({ attempt: { ...broadcast, error } }))).toEqual({
      kind: 'pending',
      ...stripPhase(broadcast),
      error,
    });
    expect(resolveSwapLifecycle(inputs({ attempt: { ...broadcast, error }, status: { state: 'failed' } }))).toEqual({
      kind: 'failed',
      error,
      ...stripPhase(broadcast),
    });
  });

  it('surfaces a status read that cannot recover on the pending state', () => {
    const statusError = new Error('API key rejected');
    expect(resolveSwapLifecycle(inputs({ attempt: broadcast, statusError }))).toEqual({
      kind: 'pending',
      ...stripPhase(broadcast),
      error: statusError,
    });
  });

  it('reports an unconfirmed batch as unconfirmed, whatever else holds', () => {
    const error = new Error('batch not confirmed');
    expect(
      resolveSwapLifecycle(
        inputs({ attempt: { phase: 'unconfirmed', batchId: 'batch-1', error }, isWrongChain: true }),
      ),
    ).toEqual({ kind: 'unconfirmed', batchId: 'batch-1', error });
  });

  it('reports a failure before broadcast', () => {
    const error = new Error('User rejected the request');
    expect(resolveSwapLifecycle(inputs({ attempt: { phase: 'failed', error } }))).toEqual({ kind: 'failed', error });
  });

  it.each([
    [{ needsActivation: true, blocksAction: true }, 'stellarActivation'],
    [{ needsFunding: true, blocksAction: true }, 'stellarFunding'],
    [{ needsTrustline: true, blocksAction: true }, 'stellarTrustline'],
    [{ checkFailed: true, blocksAction: true }, 'stellarCheckFailed'],
  ] as const)('blocks on the Stellar gate (%o → %s)', (gate, reason) => {
    expect(resolveSwapLifecycle(inputs({ stellar: { ...OPEN_STELLAR, isStellar: true, ...gate } }))).toEqual({
      kind: 'needsSetup',
      reason,
    });
  });

  it('blocks on NEAR storage, then on the app-owned prerequisite', () => {
    expect(
      resolveSwapLifecycle(inputs({ nearStorage: { isNear: true, needsRegistration: true, blocksAction: true } })),
    ).toEqual({ kind: 'needsSetup', reason: 'nearStorage' });
    // An errored check leaves `blocksAction` false; the lifecycle must not read that as "registered".
    expect(
      resolveSwapLifecycle(
        inputs({ nearStorage: { isNear: true, needsRegistration: false, blocksAction: false, checkFailed: true } }),
      ),
    ).toEqual({ kind: 'needsSetup', reason: 'nearStorageCheckFailed' });
    expect(resolveSwapLifecycle(inputs({ externalBlocked: true }))).toEqual({ kind: 'needsSetup', reason: 'external' });
  });

  it('is checking, not needsSetup, while a setup tx or its refreshed check is still running', () => {
    const trustline = { stellar: { ...OPEN_STELLAR, isStellar: true, needsTrustline: true, blocksAction: true } };
    expect(resolveSwapLifecycle(inputs({ ...trustline, setupBusy: true }))).toEqual({ kind: 'checking' });
    expect(resolveSwapLifecycle(inputs({ externalBlocked: true, setupBusy: true }))).toEqual({ kind: 'checking' });
    // Nothing to set up: a busy flag alone does not hold a ready swap.
    expect(resolveSwapLifecycle(inputs({ setupBusy: true }))).toEqual({
      kind: 'ready',
      approvalStrategy: 'atomic-batch',
    });
  });

  it('is checking while a gate is still resolving', () => {
    expect(resolveSwapLifecycle(inputs({ stellar: { ...OPEN_STELLAR, isStellar: true, blocksAction: true } }))).toEqual(
      {
        kind: 'checking',
      },
    );
    expect(
      resolveSwapLifecycle(inputs({ nearStorage: { isNear: true, needsRegistration: false, blocksAction: true } })),
    ).toEqual({
      kind: 'checking',
    });
  });

  it('asks for a chain switch only once the destination is clear', () => {
    expect(resolveSwapLifecycle(inputs({ isWrongChain: true }))).toEqual({ kind: 'needsChainSwitch' });
    expect(resolveSwapLifecycle(inputs({ isWrongChain: true, externalBlocked: true }))).toEqual({
      kind: 'needsSetup',
      reason: 'external',
    });
  });

  it('waits for the approval strategy, and fails when it cannot be read', () => {
    expect(resolveSwapLifecycle(inputs({ strategy: { data: undefined, error: null } }))).toEqual({ kind: 'checking' });
    const error = new Error('allowance read failed');
    expect(resolveSwapLifecycle(inputs({ strategy: { data: undefined, error } }))).toEqual({ kind: 'failed', error });
    // A failed background refetch keeps the cached strategy, so a ready form stays ready.
    expect(resolveSwapLifecycle(inputs({ strategy: { data: 'sequential', error } }))).toEqual({
      kind: 'ready',
      approvalStrategy: 'sequential',
    });
  });
});

function stripPhase({ srcChainKey, srcTxHash }: { srcChainKey: string; srcTxHash: string }) {
  return { srcChainKey, srcTxHash };
}
