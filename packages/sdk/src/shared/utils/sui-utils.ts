import { Transaction } from '@mysten/sui/transactions';
import type { SuiTransaction } from '@sodax/types';

/**
 * Bridge the deliberately-narrow `SuiTransaction` interface (which only guarantees `toJSON()`) to a
 * concrete `Transaction`. Returns the input directly when it already is one; otherwise rebuilds it.
 */
export async function toMystenTransaction(txn: SuiTransaction): Promise<Transaction> {
  if (txn instanceof Transaction) return txn;
  return Transaction.from(await txn.toJSON());
}

/**
 * `waitForTransaction` rejects with `AbortSignal.timeout`'s `DOMException`, whose message differs
 * per runtime ("aborted due to timeout" on Node, "signal timed out" in browsers) — match the name.
 */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown };
    if (name === 'TimeoutError' || name === 'AbortError') {
      return true;
    }
  }
  return error instanceof Error && /timed?\s?out|timeout/i.test(error.message);
}
