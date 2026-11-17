/**
 * Compile-time contract: `useTradingWallet` returns the persisted trading address or undefined.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { useTradingWallet } from './useTradingWallet.js';

describe('useTradingWallet', () => {
  it('takes a wallet address or undefined and returns the trading address', () => {
    expectTypeOf<Parameters<typeof useTradingWallet>>().toEqualTypeOf<[walletAddress: string | undefined]>();
    expectTypeOf<ReturnType<typeof useTradingWallet>>().toEqualTypeOf<{ tradingAddress: string | undefined }>();
  });
});
