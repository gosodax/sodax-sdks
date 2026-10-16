// packages/dapp-kit/src/hooks/migrate/useRevertMigrateSodaToIcx.ts
import type { IcxRevertMigrationAction, TxHashPair } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseRevertMigrateSodaToIcxVars = Omit<IcxRevertMigrationAction<false>, 'raw'>;

/**
 * React hook for reverting SODA → ICX (the inverse of {@link useMigrateIcxToSoda}).
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useRevertMigrateSodaToIcx({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseRevertMigrateSodaToIcxVars> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseRevertMigrateSodaToIcxVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseRevertMigrateSodaToIcxVars>({
    mutationKey: ['migrate', 'revertSodaToIcx'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.migration.revertMigrateSodaToIcx({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['migrate', 'allowance'] });
      invalidateBalances(queryClient, vars.params.srcChainKey, ChainKeys.ICON_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
