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
import type { SodaxErrorContext, SodaxFeature } from '../../errors/codes.js';
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
 * How an approve-then-deposit flow gets the source token approved:
 * - `'not-required'` — allowance already sufficient (or none needed, e.g. a native token): one transaction.
 * - `'atomic-batch'` — approve and the deposit go out as one EIP-5792 batch: one signature.
 * - `'sequential'` — approve first, wait for it to confirm, then the deposit: two signatures, or
 *   three when the token must reset a stale allowance first.
 */
export type ApprovalStrategy = 'not-required' | 'atomic-batch' | 'sequential';

/**
 * How long an SDK `*WithApproval` call waits for its batch: the caller's `timeout`, never below
 * `DEFAULT_RELAY_TX_TIMEOUT`. A batch given up on early may still land, and then it can only be waited out.
 */
export function approvalBatchWaitMs(timeout: number | undefined): number {
  return Math.max(resolveTimeoutMs(timeout, DEFAULT_RELAY_TX_TIMEOUT), DEFAULT_RELAY_TX_TIMEOUT);
}

/**
 * `context.reason` of the `INTENT_CREATION_FAILED` returned when the wallet refused the batch before
 * anything was signed (unsupported method, capability, chain or atomicity). Nothing was sent, so
 * approving separately and then sending the deposit cannot duplicate anything.
 */
export const ATOMIC_BATCH_REFUSED = 'atomic-batch-refused';

/**
 * `context.reason` of a batch the wallet accepted but that did not confirm as a deposit — not within
 * the timeout, or with a result that does not say whether it landed (`TX_VERIFICATION_FAILED`, with
 * `context.batchId`, plus `context.callCount` when known). It may have landed: do not retry it.
 */
export const ATOMIC_BATCH_UNCONFIRMED = 'atomic-batch-unconfirmed';

/**
 * `context.reason` of the `USER_REJECTED` returned when the user declined the account upgrade a
 * `'ready'` wallet asked for (EIP-5792 5750), as opposed to rejecting the batch itself. Retry with
 * `allowAccountUpgrade: false` to approve separately without upgrading.
 */
export const ACCOUNT_UPGRADE_DECLINED = 'account-upgrade-declined';

// EIP-5792 status codes that say nothing landed: 400 never included, 500 fully reverted. 600 may have partly landed.
const BATCH_NOTHING_LANDED_CODES: ReadonlySet<number> = new Set([400, 500]);

/** The account-upgrade choice every approve-then-deposit flow and its strategy read take. */
export type ApprovalOptions = {
  /**
   * Whether a wallet that must first upgrade the account to batch (EIP-5792 `'ready'`, e.g. a MetaMask
   * EOA becoming a smart account) may be asked to. `false` approves separately instead. Defaults to `true`.
   */
  allowAccountUpgrade?: boolean;
};

export type ResolveApprovalStrategyParams = ApprovalOptions & {
  srcChainKey: SpokeChainKey;
  walletProvider: IWalletProvider;
};

/**
 * How to approve once the allowance is known to be short: `'atomic-batch'` for an EVM spoke source
 * whose wallet reports EIP-5792 atomic support on that chain, `'sequential'` otherwise. The Sonic hub
 * always gets `'sequential'`. Read-only; sends nothing.
 */
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
  /** The approval leg(s) then the deposit, in broadcast order — the deposit must be the last call. */
  txs: readonly EvmRawTransaction[];
  /** How long to wait for the batch to confirm, in ms. */
  timeoutMs: number;
  /** The feature the returned errors belong to. */
  feature: SodaxFeature;
  /** Merged into every returned error's `context`. */
  context?: SodaxErrorContext;
  /**
   * Called with the batch id as soon as the wallet accepts the batch, before the wait. Persist it: if the
   * wait ends without a receipt, {@link confirmApprovalBatch} with that id is the only way back to the
   * deposit. A listener that throws is ignored.
   */
  onBatchSent?: (batchId: string) => void;
};

export type ApprovalBatchResult = {
  /** The transaction that carries the deposit — what the relay and `submit-tx` take as the source tx. */
  txHash: Hash;
  batchId: string;
};

/**
 * Sends approve + deposit as one EIP-5792 atomic batch and waits for it, so the user signs once.
 *
 * - The wallet refuses the batch before signing (or cannot batch at all) → `INTENT_CREATION_FAILED`
 *   with `context.reason:` {@link ATOMIC_BATCH_REFUSED}. Only this case may fall back to approving
 *   separately.
 * - The user rejects the batch → `USER_REJECTED`; a declined account upgrade (5750) adds
 *   `context.reason:` {@link ACCOUNT_UPGRADE_DECLINED}.
 * - Never included or fully reverted (EIP-5792 400 / 500) → `INTENT_CREATION_FAILED` with
 *   `context.reason: 'atomic-batch-failed'`. Nothing was deposited.
 * - Anything else short of a confirmed deposit receipt → `TX_VERIFICATION_FAILED` with
 *   `context.reason:` {@link ATOMIC_BATCH_UNCONFIRMED}, `context.batchId` and `context.callCount`. It may
 *   have landed — never retry it, as a batch or as separate transactions.
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
  /** The id `sendAtomicBatch` returned — what {@link SendApprovalBatchParams.onBatchSent} reported. */
  batchId: string;
  /**
   * How many calls the batch carried, deposit last. Without it, only a batch whose receipts all share one
   * transaction identifies the deposit.
   */
  callCount?: number;
  /** How long to wait for the batch to confirm, in ms. */
  timeoutMs: number;
  feature: SodaxFeature;
  context?: SodaxErrorContext;
};

/**
 * Waits for a batch the wallet already accepted and reads the deposit's transaction from it. This is
 * the second half of {@link sendApprovalBatch}, and how an app resumes a batch it reported as
 * unconfirmed (after a reload, say) instead of sending the deposit again.
 *
 * - Never included or fully reverted (EIP-5792 400 / 500) → `INTENT_CREATION_FAILED` with
 *   `context.reason: 'atomic-batch-failed'`. Nothing was deposited.
 * - Anything else short of a confirmed deposit receipt → `TX_VERIFICATION_FAILED` with
 *   `context.reason:` {@link ATOMIC_BATCH_UNCONFIRMED}, `context.batchId` and any `callCount` given. It
 *   may still land.
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
    // The deposit is the last call: either every receipt is the same tx (a wallet may add its own fee
    // call to it), or there is one receipt per call.
    const { receipts } = batch;
    const oneTx = new Set(receipts.map(receipt => receipt.transactionHash)).size === 1;
    const depositReceipt = oneTx || receipts.length === callCount ? receipts.at(-1) : undefined;
    if (depositReceipt?.status !== 'success') return unconfirmed();
    return { ok: true, value: { txHash: depositReceipt.transactionHash, batchId } };
  } catch (error) {
    return unconfirmed(error);
  }
}

/**
 * Whether `error` is a batch the wallet refused before anything was signed or sent — the one batch
 * failure after which approving separately cannot duplicate anything.
 */
export function isAtomicBatchRefusal(error: unknown): boolean {
  return (
    isSodaxError(error) && error.code === 'INTENT_CREATION_FAILED' && error.context?.reason === ATOMIC_BATCH_REFUSED
  );
}

/**
 * Sends the deposit down the path `strategy` picked. Only a batch the wallet refused before anything
 * was signed (`ATOMIC_BATCH_REFUSED`) falls back to approving separately; any other batch failure is
 * returned as is, because the user saw that batch and it may still land. Resolves with the path that ran.
 */
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
