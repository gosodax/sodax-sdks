// packages/dapp-kit/src/hooks/migrate/useMigrateIcxToSoda.ts
import type { IcxMigrateAction, TxHashPair } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useMigrateIcxToSoda}. Wraps `IcxMigrateAction<false>` with `raw`
 * stripped — the hook always submits non-raw and unwraps the SDK Result.
 */
export type UseMigrateIcxToSodaVars = Omit<IcxMigrateAction<false>, 'raw'>;

/**
 * React hook for migrating ICX/wICX → SODA on the Sonic hub. Forward-only direction; for the
 * reverse (SODA → ICX) use {@link useRevertMigrateSodaToIcx}.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 */
export function useMigrateIcxToSoda({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseMigrateIcxToSodaVars> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseMigrateIcxToSodaVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseMigrateIcxToSodaVars>({
    mutationKey: ['migrate', 'icxToSoda'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.migration.migrateIcxToSoda({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['migrate', 'allowance'] });
      invalidateBalances(queryClient, vars.params.srcChainKey, ChainKeys.SONIC_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
