import { Transaction } from '@mysten/sui/transactions';
import type { SuiTransaction } from '@sodax/types';

/** `SuiTransaction` only guarantees `toJSON()`; rebuild a concrete `Transaction` unless it already is one. */
export async function toMystenTransaction(txn: SuiTransaction): Promise<Transaction> {
  if (txn instanceof Transaction) return txn;
  return Transaction.from(await txn.toJSON());
}

/** `AbortSignal.timeout`'s DOMException message differs per runtime, so match the name. */
export function isTimeoutError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown };
    if (name === 'TimeoutError' || name === 'AbortError') {
      return true;
    }
  }
  return error instanceof Error && /timed?\s?out|timeout/i.test(error.message);
}
