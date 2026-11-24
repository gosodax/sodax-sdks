import React from 'react';
import type { MpcPayoutMinimum, XToken } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { getChainName } from '@/constants';
import { WarningNotice } from './WarningNotice';

/** Shown while the SDK would refuse the payout as too small; the action stays disabled meanwhile. */
export function PayoutMinimumNotice({ unmet, chainKey }: { unmet: MpcPayoutMinimum; chainKey: XToken['chainKey'] }) {
  return (
    <WarningNotice>
      A payout to <strong>{getChainName(chainKey) || chainKey}</strong> must be{' '}
      {unmet.inclusive ? 'at least' : 'greater than'}{' '}
      <strong>
        {formatUnits(unmet.minimum, unmet.decimals)} {unmet.symbol}
      </strong>
      .
      {!unmet.inclusive &&
        ' A variable relay fee comes out of it, and nothing is delivered once the fee reaches the amount.'}
    </WarningNotice>
  );
}
