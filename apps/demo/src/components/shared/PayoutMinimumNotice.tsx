import React from 'react';
import type { MpcPayoutMinimum, XToken } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { getChainName } from '@/constants';

/** Shown while the SDK would refuse the payout as too small; the action stays disabled meanwhile. */
export function PayoutMinimumNotice({ unmet, chainKey }: { unmet: MpcPayoutMinimum; chainKey: XToken['chainKey'] }) {
  return (
    <p
      role="alert"
      className="min-w-0 w-full text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-900"
    >
      A payout to <strong>{getChainName(chainKey) || chainKey}</strong> must be greater than{' '}
      <strong>
        {formatUnits(unmet.minimum, unmet.decimals)} {unmet.symbol}
      </strong>
      . A variable relay fee comes out of it, and nothing is delivered once the fee reaches the amount.
    </p>
  );
}
