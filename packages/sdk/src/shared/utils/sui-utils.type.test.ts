/** Pins the Sui helpers: `toMystenTransaction` to a Mysten `Transaction`, `isTimeoutError` to boolean. */
import type { Transaction } from '@mysten/sui/transactions';
import { describe, expectTypeOf, it } from 'vitest';
import type { isTimeoutError, toMystenTransaction } from './sui-utils.js';

describe('shared/utils/sui-utils', () => {
  it('pins each result', () => {
    expectTypeOf<ReturnType<typeof toMystenTransaction>>().toEqualTypeOf<Promise<Transaction>>();
    expectTypeOf<ReturnType<typeof isTimeoutError>>().toEqualTypeOf<boolean>();
  });
});
