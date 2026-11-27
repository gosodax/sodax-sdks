import type {
  IcxRevertMigrationAction,
  MigrationAction,
  SpokeChainKey,
  TxReturnType,
  UnifiedBnUSDMigrateAction,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseMigrationApproveVars<K extends SpokeChainKey = SpokeChainKey> = (
  | Omit<IcxRevertMigrationAction<false>, 'raw'>
  | Omit<UnifiedBnUSDMigrateAction<K, false>, 'raw'>
) & { action: MigrationAction };

/** Required for SODA → ICX revert and EVM/Stellar bnUSD migrations; not for ICX → SODA or BALN (Icon). */
export function useMigrationApprove<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseMigrationApproveVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseMigrationApproveVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseMigrationApproveVars<K>>({
    mutationKey: ['migrate', 'approve'],
    ...mutationOptions,
    mutationFn: async ({ action, ...actionParams }) =>
      unwrapResult(
        await sodax.migration.approve(
          { ...actionParams, raw: false } as IcxRevertMigrationAction<false> | UnifiedBnUSDMigrateAction<K, false>,
          action,
        ),
      ),
    onSuccess: async (data, vars, ctx) => {
      // Broad: the mutation can't know which (action, params) allowance the consumer reads.
      queryClient.invalidateQueries({ queryKey: ['migrate', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
