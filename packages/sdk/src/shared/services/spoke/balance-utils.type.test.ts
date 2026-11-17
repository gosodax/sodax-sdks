/**
 * Compile-time contract for the balance-collection helpers: the collector shape and its settle step.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { BalanceCollector, WalletBalanceMap } from '../../../index.js';
import type { createBalanceCollector, settleWalletBalances } from './balance-utils.js';

describe('balance-utils', () => {
  it('createBalanceCollector returns a collector that finishes into a WalletBalanceMap', () => {
    expectTypeOf<ReturnType<typeof createBalanceCollector>>().toEqualTypeOf<BalanceCollector>();
    expectTypeOf<ReturnType<BalanceCollector['finish']>>().toEqualTypeOf<WalletBalanceMap>();
    expectTypeOf<WalletBalanceMap>().toEqualTypeOf<Record<string, bigint>>();
  });

  it('settleWalletBalances resolves to void; results land on the collector', () => {
    expectTypeOf<ReturnType<typeof settleWalletBalances>>().toEqualTypeOf<Promise<void>>();
  });
});
