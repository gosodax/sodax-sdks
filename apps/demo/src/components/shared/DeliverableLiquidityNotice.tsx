import React from 'react';
import type { XToken } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { getChainName } from '@/constants';
import { WarningNotice } from './WarningNotice';

/** Shown while the amount exceeds what the token's hub vault can pay out; the action stays disabled meanwhile. */
export function DeliverableLiquidityNotice({ available, token }: { available: bigint; token: XToken }) {
  return (
    <WarningNotice>
      Only{' '}
      <strong>
        {formatUnits(available, token.decimals)} {token.symbol}
      </strong>{' '}
      can be delivered to <strong>{getChainName(token.chainKey) || token.chainKey}</strong> right now: that is all its
      vault holds. Enter a smaller amount or pick another destination.
    </WarningNotice>
  );
}
