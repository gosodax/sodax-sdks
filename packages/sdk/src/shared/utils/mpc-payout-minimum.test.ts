import { ChainKeys } from '@sodax/types';
import { describe, expect, it } from 'vitest';
import { isSodaxError } from '../../index.js';
import { assertMpcPayoutAboveMinimum } from './shared-utils.js';

const run = (
  token: { chainKey: (typeof ChainKeys)[keyof typeof ChainKeys]; symbol: string; decimals: number },
  amount: bigint,
) => assertMpcPayoutAboveMinimum({ feature: 'bridge', token, amount, context: { action: 'bridge' } });

const catchError = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('assertMpcPayoutAboveMinimum', () => {
  const ada = { chainKey: ChainKeys.CARDANO_MAINNET, symbol: 'ADA', decimals: 6 };
  const usdt = { chainKey: ChainKeys.TRON_MAINNET, symbol: 'USDT', decimals: 6 };

  it('refuses a Cardano payout below 1 ADA, saying it must be at least 1 ADA and why', () => {
    const error = catchError(() => run(ada, 999_999n));

    expect(isSodaxError(error)).toBe(true);
    if (!isSodaxError(error)) return;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe(
      'A ADA payout to cardano must be at least 1 ADA: the relay refuses a smaller release after the hub has burned it',
    );
    expect(error.context).toMatchObject({ phase: 'validate', reason: 'mpc-payout-below-minimum', action: 'bridge' });
  });

  it('accepts a Cardano payout of exactly 1 ADA, which the relay releases', () => {
    expect(() => run(ada, 1_000_000n)).not.toThrow();
    expect(() => run(ada, 25_000_000n)).not.toThrow();
  });

  it('keeps the release-fee wording for a minimum the amount must exceed (Tron)', () => {
    const error = catchError(() => run(usdt, 3_000_000n));

    expect(isSodaxError(error) && error.message).toBe(
      "A USDT payout to tron must be greater than 3 USDT: the relay's release fee comes out of it",
    );
    expect(() => run(usdt, 3_000_001n)).not.toThrow();
  });

  it('does not touch a chain with no minimum', () => {
    expect(() => run({ chainKey: ChainKeys.ARBITRUM_MAINNET, symbol: 'USDT', decimals: 6 }, 1n)).not.toThrow();
  });
});
