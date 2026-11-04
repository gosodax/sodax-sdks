// packages/dapp-kit/src/hooks/migrate/useMigratebnUSD.ts
import type { SpokeChainKey, TxHashPair, UnifiedBnUSDMigrateAction } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useMigratebnUSD}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Bidirectional — handles both legacy → new and new → legacy bnUSD migration
 * via the same SDK call; the SDK detects direction from the token addresses.
 */
export type UseMigratebnUSDVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  UnifiedBnUSDMigrateAction<K, false>,
  'raw'
>;

/**
 * React hook for migrating bnUSD between legacy and new formats across spoke chains via Sonic.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useMigratebnUSD<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseMigratebnUSDVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseMigratebnUSDVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseMigratebnUSDVars<K>>({
    mutationKey: ['migrate', 'bnUSD'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.migration.migratebnUSD({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['migrate', 'allowance'] });
      invalidateBalances(queryClient, params.srcChainKey, params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
