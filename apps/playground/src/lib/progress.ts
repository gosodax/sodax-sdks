import type { SubmitSwapTxStatusV2 } from '@sodax/dapp-kit';
import type { ExecutionPhase } from './execution';

/** What the widget is doing while the swap is still in the visitor's hands. */
export const PHASE_LABELS: Record<ExecutionPhase, string> = {
  checking: 'Checking the latest quote',
  approving: 'Approve in your wallet',
  building: 'Preparing your swap',
  signing: 'Confirm in your wallet',
  submitting: 'Submitting your swap',
};

/** The relay's own lifecycle, worded as the exchange words it on sodax.com/exchange/swap. */
export const STATUS_LABELS: Record<SubmitSwapTxStatusV2, string> = {
  pending: 'Swap created',
  relaying: 'Relaying',
  relayed: 'Relayed',
  posting_execution: 'Executing swap',
  posted_execution: 'Executing swap',
  solved: 'Swap complete',
  failed: 'Swap failed',
};

/** The fields of a failed status that decide where the visitor's funds are. */
export type FailureState = { intentCancelled?: boolean; relayedForRefundAt?: string } | undefined;

/**
 * What a failed swap means for the visitor's funds. `executeSwap` always takes its deadline from
 * the API, so the widget only ever creates a timed intent: an unfilled one expires and refunds
 * itself. The backend's own `userMessage` says to cancel on-chain to recover — that is the
 * limit-order case (`deadline = 0`), and repeating it here sends a widget user hunting for a cancel
 * button they never need. Which step failed is a support detail, never part of this sentence.
 */
export function failureMessage(status: FailureState): string {
  if (status?.intentCancelled) return 'This swap could not be completed. Your funds are back in your wallet.';
  if (status?.relayedForRefundAt) return 'This swap could not be completed. Your refund is on its way to your wallet.';
  return 'This swap could not be completed. Your funds return to your wallet automatically within about five minutes, and you can try again.';
}

/**
 * Whether the backend has already placed the visitor's funds — cancelled back, or a refund relayed.
 * Until it has, a failed swap is the one case where the widget owes someone to ask; after it, help
 * offered beside "your funds are back" only invents a problem.
 */
export function refundAccounted(status: FailureState): boolean {
  return !!status?.intentCancelled || !!status?.relayedForRefundAt;
}

/**
 * One line for the whole lifecycle. The local phase leads while the widget still owns the step —
 * the relay reports `pending` from the moment it has the transaction, which would otherwise
 * overwrite the wallet prompt the visitor is looking at.
 */
export function progressLabel(
  phase: ExecutionPhase | undefined,
  status: SubmitSwapTxStatusV2 | undefined,
): string | undefined {
  if (phase) return PHASE_LABELS[phase];
  return status && STATUS_LABELS[status];
}
