import React from 'react';
import { LeverageYieldView } from '@/components/leverage-yield/LeverageYieldView';

/**
 * Leverage Yield via the REST API: vault reads, quotes and unsigned transactions come from `sodax.api.leverageYield`
 * (dapp-kit `useLeverageYieldApi*` hooks); the wallet only signs and broadcasts, then `/submit-tx` relays. The API
 * base URL follows the Sodax Settings "Leverage Yield API base URL" row (`effectiveLeverageYieldApiBaseUrl`).
 */
export default function LeverageYieldApiPage() {
  return <LeverageYieldView transport="api" />;
}
