// packages/dapp-kit/src/hooks/migrate/useMigrateBaln.ts
import type { BalnMigrateAction, TxHashPair } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseMigrateBalnVars = Omit<BalnMigrateAction<false>, 'raw'>;

/**
 * React hook for migrating BALN → SODA on the Sonic hub. Source chain is always Icon. Supports
 * lockup periods (0–24 months) which multiply the SODA reward (0.5x–1.5x).
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useMigrateBaln({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseMigrateBalnVars> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseMigrateBalnVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseMigrateBalnVars>({
    mutationKey: ['migrate', 'baln'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.migration.migrateBaln({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['migrate', 'allowance'] });
      invalidateBalances(queryClient, ChainKeys.ICON_MAINNET, ChainKeys.SONIC_MAINNET);
      // BALN with stake=true affects staking info too; cheap broad invalidation.
      queryClient.invalidateQueries({ queryKey: ['staking', 'info'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
