import type {
  EvmRawTransaction,
  EvmSpokeOnlyChainKey,
  Hash,
  IEvmWalletProvider,
  IWalletProvider,
  Result,
  SpokeChainKey,
} from '@sodax/types';
import type { SodaxErrorContext, SodaxFeature } from '../../errors/codes.js';
import { SodaxError } from '../../errors/SodaxError.js';
import { intentCreationFailed } from '../../errors/wrappers.js';
import { isEvmSpokeOnlyChainKeyType, isEvmWalletProviderType } from '../guards.js';
import { getEvmViemChain } from './constant-utils.js';
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
 * `context.reason` of the `INTENT_CREATION_FAILED` returned when the wallet refused the batch before
 * anything was signed (unsupported method, capability, chain or atomicity). Nothing was sent, so
 * approving separately and then sending the deposit cannot duplicate anything.
 */
export const ATOMIC_BATCH_REFUSED = 'atomic-batch-refused';

/**
 * `context.reason` of a batch the wallet accepted but that did not confirm as a deposit — not within
 * the timeout, or with a result that does not say whether it landed (`TX_VERIFICATION_FAILED`, with
 * `context.batchId`). It may have landed: do not retry it.
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
 *   `context.reason:` {@link ATOMIC_BATCH_UNCONFIRMED} and `context.batchId`. It may have landed —
 *   never retry it, as a batch or as separate transactions.
 */
export async function sendApprovalBatch({
  walletProvider,
  srcChainKey,
  txs,
  timeoutMs,
  feature,
  context,
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

  // From here the wallet holds the batch: a failure to confirm it must not read as "nothing sent".
  const unconfirmed = (cause?: unknown): Result<never, SodaxError<ApprovalBatchErrorCode>> => ({
    ok: false,
    error: new SodaxError('TX_VERIFICATION_FAILED', 'Atomic approval batch was sent but not confirmed', {
      feature,
      cause,
      context: { ...context, phase: 'verify', reason: ATOMIC_BATCH_UNCONFIRMED, batchId },
    }),
  });
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
    // One receipt (the whole batch as one tx) or one per call, else the deposit's tx is unknown.
    const { receipts } = batch;
    const depositReceipt = receipts.length === 1 || receipts.length === txs.length ? receipts.at(-1) : undefined;
    if (depositReceipt?.status !== 'success') return unconfirmed();
    return { ok: true, value: { txHash: depositReceipt.transactionHash, batchId } };
  } catch (error) {
    return unconfirmed(error);
  }
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
  sequential: () => Promise<Result<T, E>>;
  onBatchRefused?: (error: E) => void;
}): Promise<{ result: Result<T, E>; approvalStrategy: ApprovalStrategy }> {
  if (strategy === 'not-required') return { result: await notRequired(), approvalStrategy: strategy };
  if (strategy === 'sequential') return { result: await sequential(), approvalStrategy: strategy };

  const batched = await atomicBatch();
  const refused =
    !batched.ok &&
    batched.error.code === 'INTENT_CREATION_FAILED' &&
    batched.error.context?.reason === ATOMIC_BATCH_REFUSED;
  if (batched.ok || !refused) return { result: batched, approvalStrategy: 'atomic-batch' };

  onBatchRefused?.(batched.error);
  return { result: await sequential(), approvalStrategy: 'sequential' };
}
