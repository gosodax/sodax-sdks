import { ATOMIC_BATCH_UNCONFIRMED, isSodaxError } from '@sodax/dapp-kit';

/** A batch the wallet took but never confirmed. It may still land, so it is rechecked, never sent again. */
export type UnconfirmedBatch = { batchId: string; callCount?: number };

/** The batch an `ATOMIC_BATCH_UNCONFIRMED` error is about, or `undefined` for any other error. */
export function unconfirmedBatchOf(error: unknown): UnconfirmedBatch | undefined {
  const context = isSodaxError(error) ? error.context : undefined;
  if (context?.reason !== ATOMIC_BATCH_UNCONFIRMED || typeof context.batchId !== 'string') return undefined;
  return typeof context.callCount === 'number'
    ? { batchId: context.batchId, callCount: context.callCount }
    : { batchId: context.batchId };
}
