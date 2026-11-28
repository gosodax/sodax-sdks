import {
  ATOMIC_BATCH_UNCONFIRMED,
  isSodaxError,
  type CreateIntentParams,
  type Hex,
  type SpokeChainKey,
  type SwapApprovalStrategy,
  type SwapStatusSummary,
  type SwapWithApprovalResponse,
} from '@sodax/sdk';
import type { NearStorageGateState } from './nearStorageGate.js';
import type { StellarGateState } from './stellarGate.js';
import type { HederaGateState } from './hederaGate.js';
import type { XrpGateState } from './xrpGate.js';

/** A prerequisite the user must resolve before the swap can go out. */
export type SwapSetupReason =
  | 'stellarActivation'
  | 'stellarFunding'
  | 'stellarTrustline'
  | 'stellarCheckFailed'
  | 'nearStorage'
  | 'nearStorageCheckFailed'
  | 'xrpTrustline'
  | 'xrpFunding'
  | 'xrpBlocked'
  | 'xrpCheckFailed'
  | 'hederaAssociation'
  | 'hederaBlocked'
  | 'hederaCheckFailed'
  | 'external';

/** Where a swap form stands, discriminated on `kind`; `useSwapLifecycle`'s `next()` acts on it. */
export type SwapLifecycleState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'needsChainSwitch' }
  | { kind: 'needsSetup'; reason: SwapSetupReason }
  | { kind: 'ready'; approvalStrategy: SwapApprovalStrategy }
  | { kind: 'submitting' }
  // `error`: failed after broadcast or unrecoverable status read; may still complete, and polling can stop silently, so keep `reset()` reachable.
  | { kind: 'pending'; srcChainKey: SpokeChainKey; srcTxHash: string; error?: Error }
  | { kind: 'pending'; srcChainKey: SpokeChainKey; srcTxHash?: never; recovery: unknown; error: Error }
  // A wallet-accepted approve + swap batch not confirmed in time: may still land, so `next()` waits for it instead of resending.
  | { kind: 'unconfirmed'; batchId: string; callCount?: number; error: Error }
  | { kind: 'settled'; srcChainKey: SpokeChainKey; srcTxHash: string; fillTxHash?: Hex }
  | { kind: 'failed'; error: Error; srcChainKey?: SpokeChainKey; srcTxHash?: string };

/** The swap-mutation fields the lifecycle reads. A `useSwapWithApproval` result satisfies it. */
export type SwapAttemptSource = {
  status: 'idle' | 'pending' | 'success' | 'error';
  data: SwapWithApprovalResponse | undefined;
  error: Error | null;
  variables: { params: CreateIntentParams } | undefined;
};

/** The swap attempt for the current params, reduced to what the state needs. */
export type SwapAttempt =
  | { phase: 'none' }
  | { phase: 'submitting' }
  | { phase: 'broadcast'; srcChainKey: SpokeChainKey; srcTxHash: string; error?: Error }
  | { phase: 'recovering'; srcChainKey: SpokeChainKey; recovery: unknown; error: Error }
  | { phase: 'unconfirmed'; batchId: string; callCount?: number; error: Error }
  | { phase: 'failed'; error: Error };

export type SwapLifecycleInputs = {
  attempt: SwapAttempt;
  /** `summarizeSwapStatus` of the attempt's detailed status, once one is read. */
  status: SwapStatusSummary | undefined;
  /** A status-read error that will not clear by polling again (a rejected API key). */
  statusError: Error | undefined;
  /** Intent params and a source wallet provider are both present. */
  hasInputs: boolean;
  stellar: StellarGateState;
  /** `checkFailed`: the registration check errored, so the swap waits for a retry rather than going out blind. */
  nearStorage: NearStorageGateState & { checkFailed?: boolean };
  xrp: XrpGateState;
  hedera: HederaGateState;
  externalBlocked: boolean;
  /** A setup tx is in flight, or the check it invalidated is still refreshing: acting now would resend it. */
  setupBusy: boolean;
  isWrongChain: boolean;
  /** The association must be sent from Hedera and the wallet is on another chain. */
  hederaWrongChain: boolean;
  strategy: { data: SwapApprovalStrategy | undefined; error: Error | null };
};

/** Same swap: every field but the deadline, so rebuilding the params with a fresh deadline is not a new swap. */
export function isSameIntent(a: CreateIntentParams, b: CreateIntentParams): boolean {
  return (
    a.srcChainKey === b.srcChainKey &&
    a.dstChainKey === b.dstChainKey &&
    a.srcAddress === b.srcAddress &&
    a.dstAddress === b.dstAddress &&
    a.inputToken === b.inputToken &&
    a.outputToken === b.outputToken &&
    a.inputAmount === b.inputAmount &&
    a.minOutputAmount === b.minOutputAmount &&
    a.allowPartialFill === b.allowPartialFill &&
    a.solver === b.solver &&
    a.data === b.data &&
    a.hook?.kind === b.hook?.kind &&
    a.deliveryData === b.deliveryData
  );
}

/** A swap in flight or one that may still land counts until `reset()` whatever the params, so a param edit cannot
 * re-enable the button and swap twice; a completed or never-sent swap counts only for the current params. */
export function toSwapAttempt(mutation: SwapAttemptSource, intentParams: CreateIntentParams | undefined): SwapAttempt {
  if (mutation.status === 'pending') return { phase: 'submitting' };
  const attempted = mutation.variables?.params;
  if (mutation.status === 'idle' || !attempted) return { phase: 'none' };
  const attempt = toFinishedAttempt(mutation, attempted);
  const mayStillLand =
    attempt.phase === 'unconfirmed' ||
    attempt.phase === 'recovering' ||
    (attempt.phase === 'broadcast' && attempt.error !== undefined);
  if (mayStillLand || (intentParams && isSameIntent(attempted, intentParams))) return attempt;
  return { phase: 'none' };
}

function toFinishedAttempt(mutation: SwapAttemptSource, attempted: CreateIntentParams): SwapAttempt {
  if (mutation.status === 'success' && mutation.data) {
    const { srcChainKey, srcTxHash } = mutation.data.intentDeliveryInfo;
    return { phase: 'broadcast', srcChainKey, srcTxHash };
  }
  const error = mutation.error ?? new Error('Swap failed');
  const context = isSodaxError(error) ? error.context : undefined;
  if (typeof context?.srcTxHash === 'string') {
    return { phase: 'broadcast', srcChainKey: attempted.srcChainKey, srcTxHash: context.srcTxHash, error };
  }
  if (context?.recovery !== undefined) {
    return { phase: 'recovering', srcChainKey: attempted.srcChainKey, recovery: context.recovery, error };
  }
  if (context?.reason === ATOMIC_BATCH_UNCONFIRMED && typeof context.batchId === 'string') {
    return typeof context.callCount === 'number'
      ? { phase: 'unconfirmed', batchId: context.batchId, callCount: context.callCount, error }
      : { phase: 'unconfirmed', batchId: context.batchId, error };
  }
  return { phase: 'failed', error };
}

/** Order: an attempt in flight or broadcast wins; then missing inputs; then destination prerequisites (Stellar, NEAR,
 * XRPL, app-owned); then the source chain; then the approval strategy. */
export function resolveSwapLifecycle(inputs: SwapLifecycleInputs): SwapLifecycleState {
  const { attempt, status } = inputs;
  if (attempt.phase === 'submitting') return { kind: 'submitting' };
  if (attempt.phase === 'broadcast') {
    const { srcChainKey, srcTxHash } = attempt;
    if (status?.state === 'solved') return { kind: 'settled', srcChainKey, srcTxHash, fillTxHash: status.fillTxHash };
    if (status?.state === 'failed') {
      return { kind: 'failed', error: attempt.error ?? new Error('Swap failed to settle'), srcChainKey, srcTxHash };
    }
    const error = attempt.error ?? inputs.statusError;
    return error ? { kind: 'pending', srcChainKey, srcTxHash, error } : { kind: 'pending', srcChainKey, srcTxHash };
  }
  if (attempt.phase === 'recovering') {
    const { srcChainKey, recovery, error } = attempt;
    return { kind: 'pending', srcChainKey, recovery, error };
  }
  if (attempt.phase === 'unconfirmed') {
    const { batchId, callCount, error } = attempt;
    return callCount === undefined
      ? { kind: 'unconfirmed', batchId, error }
      : { kind: 'unconfirmed', batchId, callCount, error };
  }
  if (attempt.phase === 'failed') return { kind: 'failed', error: attempt.error };
  if (!inputs.hasInputs) return { kind: 'idle' };

  const reason = setupReason(inputs);
  if (reason) {
    if (inputs.setupBusy) return { kind: 'checking' };
    if (reason === 'hederaAssociation' && inputs.hederaWrongChain) return { kind: 'needsChainSwitch' };
    return { kind: 'needsSetup', reason };
  }
  if (
    inputs.stellar.blocksAction ||
    inputs.nearStorage.blocksAction ||
    inputs.xrp.blocksAction ||
    inputs.hedera.blocksAction
  ) {
    return { kind: 'checking' };
  }
  if (inputs.isWrongChain) return { kind: 'needsChainSwitch' };
  // A failed refetch keeps the last strategy; `swapWithApproval` resolves its own before sending anyway.
  if (inputs.strategy.error && !inputs.strategy.data) return { kind: 'failed', error: inputs.strategy.error };
  if (!inputs.strategy.data) return { kind: 'checking' };
  return { kind: 'ready', approvalStrategy: inputs.strategy.data };
}

function setupReason({
  stellar,
  nearStorage,
  xrp,
  hedera,
  externalBlocked,
}: SwapLifecycleInputs): SwapSetupReason | undefined {
  if (stellar.needsActivation) return 'stellarActivation';
  if (stellar.needsFunding) return 'stellarFunding';
  if (stellar.needsTrustline) return 'stellarTrustline';
  if (stellar.checkFailed) return 'stellarCheckFailed';
  if (nearStorage.needsRegistration) return 'nearStorage';
  if (nearStorage.checkFailed) return 'nearStorageCheckFailed';
  if (xrp.blockedReason) return 'xrpBlocked';
  if (xrp.needsFunding) return 'xrpFunding';
  if (xrp.needsTrustline) return 'xrpTrustline';
  if (xrp.checkFailed) return 'xrpCheckFailed';
  if (hedera.blockedReason) return 'hederaBlocked';
  if (hedera.needsAssociation) return 'hederaAssociation';
  if (hedera.checkFailed) return 'hederaCheckFailed';
  if (externalBlocked) return 'external';
  return undefined;
}
