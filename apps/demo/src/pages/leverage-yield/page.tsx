import React from 'react';
import { LeverageYieldView } from '@/components/leverage-yield/LeverageYieldView';

/**
 * Leverage Yield via the SDK: vault reads, quotes and the vault swap go through `@sodax/dapp-kit` hooks over
 * `sodax.leverageYield`. Deposits carry a per-intent partner fee (`DEPOSIT_PARTNER_FEE`) in both the quote and the
 * intent. `/leverage-yield-api` is the same UI over the REST API.
 */
export default function LeverageYieldPage() {
  return <LeverageYieldView transport="sdk" />;
}
