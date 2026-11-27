import type { IcxMigrateAction, TxHashPair } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseMigrateIcxToSodaVars = Omit<IcxMigrateAction<false>, 'raw'>;

/** Forward only; use {@link useRevertMigrateSodaToIcx} for SODA → ICX. */
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
