import type {
  EvmRawTransaction,
  EvmSpokeOnlyChainKey,
  Hash,
  IEvmWalletProvider,
  IWalletProvider,
  Result,
  SpokeChainKey,
} from '@sodax/types';
import { DEFAULT_RELAY_TX_TIMEOUT } from '@sodax/types';
import type { SodaxErrorCode, SodaxErrorContext, SodaxFeature } from '../../errors/codes.js';
import { isSodaxError, SodaxError } from '../../errors/SodaxError.js';
import { intentCreationFailed } from '../../errors/wrappers.js';
import { isEvmSpokeOnlyChainKeyType, isEvmWalletProviderType } from '../guards.js';
import { getEvmViemChain } from './constant-utils.js';
import { resolveTimeoutMs } from './resolveTimeoutMs.js';
import {
  canSendAtomicBatch,
  isAccountUpgradeDeclined,
  isAtomicBatchRefused,
  readAtomicBatchSupport,
} from './evmAtomicBatch.js';

/**
 * `'not-required'`: one tx; `'atomic-batch'`: approve + deposit as one EIP-5792 batch (one signature);
 * `'sequential'`: approve, wait for confirmation, then deposit (two or three signatures with an allowance reset).
 */
export type ApprovalStrategy = 'not-required' | 'atomic-batch' | 'sequential';

/** Swap/leverage-yield strategy-read error; bridge returns `isAllowanceValid`'s own error instead. */
export type ApprovalStrategyErrorCode = Extract<SodaxErrorCode, 'ALLOWANCE_CHECK_FAILED'>;
export type ApprovalStrategyError = SodaxError<ApprovalStrategyErrorCode>;

/** Caller's `timeout`, never below `DEFAULT_RELAY_TX_TIMEOUT`: a batch given up on early may still land. */
export function approvalBatchWaitMs(timeout: number | undefined): number {
  return Math.max(resolveTimeoutMs(timeout, DEFAULT_RELAY_TX_TIMEOUT), DEFAULT_RELAY_TX_TIMEOUT);
}

/** `context.reason` when the wallet refused the batch before signing; nothing was sent, so approving separately is safe. */
export const ATOMIC_BATCH_REFUSED = 'atomic-batch-refused';

/** `context.reason` of an accepted batch that did not confirm as a deposit; it may have landed, so do not retry. */
export const ATOMIC_BATCH_UNCONFIRMED = 'atomic-batch-unconfirmed';

/** `context.reason` of a declined account upgrade (EIP-5792 5750); retry with `allowAccountUpgrade: false`. */
export const ACCOUNT_UPGRADE_DECLINED = 'account-upgrade-declined';

// EIP-5792 status codes that say nothing landed: 400 never included, 500 fully reverted. 600 may have partly landed.
const BATCH_NOTHING_LANDED_CODES: ReadonlySet<number> = new Set([400, 500]);

export type ApprovalOptions = {
  /** May a wallet that must first upgrade the account to batch (EIP-5792 `'ready'`) be asked to? Defaults to `true`. */
  allowAccountUpgrade?: boolean;
};

export type ResolveApprovalStrategyParams = ApprovalOptions & {
  srcChainKey: SpokeChainKey;
  walletProvider: IWalletProvider;
};

/** `'atomic-batch'` for an EVM spoke source whose wallet reports EIP-5792 atomic support, else `'sequential'`. */
export async function resolveApprovalStrategy({
  srcChainKey,
  walletProvider,
  allowAccountUpgrade = true,
}: ResolveApprovalStrategyParams): Promise<Exclude<ApprovalStrategy, 'not-required'>> {
  if (
    isEvmSpokeOnlyChainKeyType(srcChainKey) &&
    isEvmWalletProviderType(walletProvider) &&
    canSendAtomicBatch(walletProvider)
  ) {
    const support = await readAtomicBatchSupport(walletProvider, getEvmViemChain(srcChainKey).id);
    if (support === 'supported' || (support === 'ready' && allowAccountUpgrade)) return 'atomic-batch';
  }
  return 'sequential';
}

export type ApprovalBatchErrorCode = 'USER_REJECTED' | 'INTENT_CREATION_FAILED' | 'TX_VERIFICATION_FAILED';

export type SendApprovalBatchParams = {
  walletProvider: IEvmWalletProvider;
  srcChainKey: EvmSpokeOnlyChainKey;
  /** The deposit must be the last call. */
  txs: readonly EvmRawTransaction[];
  /** In ms. */
  timeoutMs: number;
  feature: SodaxFeature;
  context?: SodaxErrorContext;
  /** Persist this batch id: if the wait ends without a receipt, {@link confirmApprovalBatch} is the only way back. */
  onBatchSent?: (batchId: string) => void;
};

export type ApprovalBatchResult = {
  /** The tx carrying the deposit: what the relay and `submit-tx` take as the source tx. */
  txHash: Hash;
  batchId: string;
};

/**
 * Sends approve + deposit as one EIP-5792 batch. Only an `ATOMIC_BATCH_REFUSED` failure may fall back to approving
 * separately; an `ATOMIC_BATCH_UNCONFIRMED` batch may have landed and must never be retried.
 */
export async function sendApprovalBatch({
  walletProvider,
  srcChainKey,
  txs,
  timeoutMs,
  feature,
  context,
  onBatchSent,
}: SendApprovalBatchParams): Promise<Result<ApprovalBatchResult, SodaxError<ApprovalBatchErrorCode>>> {
  if (!canSendAtomicBatch(walletProvider)) {
    return {
      ok: false,
      error: new SodaxError('INTENT_CREATION_FAILED', 'Wallet provider does not implement EIP-5792 batches', {
        feature,
        context: { ...context, phase: 'intentCreation', reason: ATOMIC_BATCH_REFUSED },
      }),
    };
  }

  let batchId: string;
  try {
    batchId = await walletProvider.sendAtomicBatch(txs, { expectedChainId: getEvmViemChain(srcChainKey).id });
  } catch (error) {
    const reason = isAtomicBatchRefused(error)
      ? ATOMIC_BATCH_REFUSED
      : isAccountUpgradeDeclined(error)
        ? ACCOUNT_UPGRADE_DECLINED
        : undefined;
    return { ok: false, error: intentCreationFailed(feature, error, { ...context, ...(reason && { reason }) }) };
  }

  try {
    onBatchSent?.(batchId);
  } catch {
    // Advisory: a listener that throws must not cost the user a batch they already signed.
  }
  return confirmApprovalBatch({ walletProvider, batchId, callCount: txs.length, timeoutMs, feature, context });
}

export type ConfirmApprovalBatchParams = {
  walletProvider: IEvmWalletProvider;
  /** What {@link SendApprovalBatchParams.onBatchSent} reported. */
  batchId: string;
  /** Calls the batch carried, deposit last; without it only a single-tx batch identifies the deposit. */
  callCount?: number;
  /** In ms. */
  timeoutMs: number;
  feature: SodaxFeature;
  context?: SodaxErrorContext;
};

/**
 * Second half of {@link sendApprovalBatch}: how an app resumes an unconfirmed batch (e.g. after reload)
 * instead of sending the deposit again.
 */
export async function confirmApprovalBatch({
  walletProvider,
  batchId,
  callCount,
  timeoutMs,
  feature,
  context,
}: ConfirmApprovalBatchParams): Promise<Result<ApprovalBatchResult, SodaxError<ApprovalBatchErrorCode>>> {
  const unconfirmed = (cause?: unknown): Result<never, SodaxError<ApprovalBatchErrorCode>> => ({
    ok: false,
    error: new SodaxError('TX_VERIFICATION_FAILED', 'Atomic approval batch was sent but not confirmed', {
      feature,
      cause,
      context: {
        ...context,
        phase: 'verify',
        reason: ATOMIC_BATCH_UNCONFIRMED,
        batchId,
        ...(callCount !== undefined && { callCount }),
      },
    }),
  });
  if (!canSendAtomicBatch(walletProvider)) return unconfirmed();
  try {
    // viem reads a zero timeout as "no timeout"; give up at once instead.
    const batch = await walletProvider.waitForBatch(batchId, { timeout: Math.max(1, timeoutMs) });
    if (batch.status !== 'success' && !BATCH_NOTHING_LANDED_CODES.has(batch.statusCode)) return unconfirmed();
    if (batch.status !== 'success') {
      return {
        ok: false,
        error: new SodaxError('INTENT_CREATION_FAILED', 'Atomic approval batch did not succeed', {
          feature,
          context: {
            ...context,
            phase: 'intentCreation',
            reason: 'atomic-batch-failed',
            batchId,
            statusCode: batch.statusCode,
          },
        }),
      };
    }
    // The deposit is the last call: every receipt is one tx (a wallet may add a fee call) or one per call.
    const { receipts } = batch;
    const oneTx = new Set(receipts.map(receipt => receipt.transactionHash)).size === 1;
    const depositReceipt = oneTx || receipts.length === callCount ? receipts.at(-1) : undefined;
    if (depositReceipt?.status !== 'success') return unconfirmed();
    return { ok: true, value: { txHash: depositReceipt.transactionHash, batchId } };
  } catch (error) {
    return unconfirmed(error);
  }
}

// Typed structurally so this module never imports `SpokeService`.
type WaitForTxReceipt = (params: { txHash: string; chainKey: SpokeChainKey }) => Promise<Result<{ status: string }>>;

/** The deposit is only valid once the allowance is on-chain, and `approve` returns at broadcast. */
export async function confirmApproval({
  waitForTxReceipt,
  txHash,
  chainKey,
  feature,
  context,
}: {
  waitForTxReceipt: WaitForTxReceipt;
  txHash: string;
  chainKey: SpokeChainKey;
  feature: SodaxFeature;
  context?: SodaxErrorContext;
}): Promise<Result<void, SodaxError<'APPROVE_FAILED'>>> {
  const receipt = await waitForTxReceipt({ txHash, chainKey });
  if (receipt.ok && receipt.value.status === 'success') return { ok: true, value: undefined };
  return {
    ok: false,
    error: new SodaxError('APPROVE_FAILED', `Approval transaction ${txHash} did not confirm`, {
      feature,
      cause: receipt.ok ? receipt.value : receipt.error,
      context: { ...context, phase: 'approve', reason: 'approve-not-confirmed', approveTxHash: txHash },
    }),
  };
}

/** The one batch failure after which approving separately cannot duplicate anything. */
export function isAtomicBatchRefusal(error: unknown): boolean {
  return (
    isSodaxError(error) && error.code === 'INTENT_CREATION_FAILED' && error.context?.reason === ATOMIC_BATCH_REFUSED
  );
}

/** Only `ATOMIC_BATCH_REFUSED` falls back to sequential; other batch failures may still land, so they are returned. */
export async function runWithApproval<T, E extends SodaxError>({
  strategy,
  notRequired,
  atomicBatch,
  sequential,
  onBatchRefused,
}: {
  strategy: ApprovalStrategy;
  notRequired: () => Promise<Result<T, E>>;
  atomicBatch: () => Promise<Result<T, E>>;
  /** `afterRefusedBatch`: the batch path already built the deposit, so it needs no second validation. */
  sequential: (afterRefusedBatch: boolean) => Promise<Result<T, E>>;
  onBatchRefused?: (error: E) => void;
}): Promise<{ result: Result<T, E>; approvalStrategy: ApprovalStrategy }> {
  if (strategy === 'not-required') return { result: await notRequired(), approvalStrategy: strategy };
  if (strategy === 'sequential') return { result: await sequential(false), approvalStrategy: strategy };

  const batched = await atomicBatch();
  if (batched.ok || !isAtomicBatchRefusal(batched.error)) return { result: batched, approvalStrategy: 'atomic-batch' };

  onBatchRefused?.(batched.error);
  return { result: await sequential(true), approvalStrategy: 'sequential' };
}
