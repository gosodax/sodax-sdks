import type { QueryClient } from '@tanstack/react-query';
import type { SpokeChainKey } from '@sodax/sdk';

/**
 * Invalidate every wallet-balance query for the given chains.
 *
 * Two balance hooks ship side by side — {@link useBalances} (SDK-backed, keyed under
 * `['shared','balances', …]`) and {@link useXBalances} (wallet-layer, `['shared','xBalances', …]`) —
 * and an app may mount either. React Query matches query keys element-wise, so one key never
 * matches the other; a mutation hook that invalidates only one silently leaves the other stale.
 * Route every post-transaction balance refresh through here so the two cannot drift apart again.
 *
 * `undefined` chain keys are skipped and duplicates collapse, so callers can pass
 * `(src, dst)` without guarding either.
 */
export function invalidateBalances(
  queryClient: QueryClient,
  ...chainKeys: readonly (SpokeChainKey | undefined)[]
): void {
  for (const chainKey of new Set(chainKeys)) {
    if (!chainKey) continue;
    queryClient.invalidateQueries({ queryKey: ['shared', 'balances', chainKey] });
    queryClient.invalidateQueries({ queryKey: ['shared', 'xBalances', chainKey] });
  }
}
