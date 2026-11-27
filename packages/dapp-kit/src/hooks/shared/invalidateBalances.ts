import type { QueryClient } from '@tanstack/react-query';
import type { SpokeChainKey } from '@sodax/sdk';

/**
 * Invalidates both `useBalances` and `useXBalances` keys; invalidating only one leaves the other stale.
 * `undefined` keys are skipped and duplicates collapse.
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
