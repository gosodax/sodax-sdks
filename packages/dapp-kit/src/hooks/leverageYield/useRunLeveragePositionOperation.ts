import { useQueryClient } from '@tanstack/react-query';
import type {
  PositionDirectCall,
  PositionOperationParams,
  SpokeChainKey,
  SpokeExecActionParams,
  TxHashPair,
} from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseRunLeveragePositionOperationVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  SpokeExecActionParams<K, false, PositionOperationParams<K, PositionDirectCall>>,
  'raw'
>;

/**
 * Synchronous position calls (`withdraw`, `settle`, `cancel`) as the hub wallet; does not notify the solver, so
 * use {@link useSubmitLeveragePositionIntent} for leverage changes or the intent expires unfilled.
 * @experimental Off-hub (spoke) origins are unverified on-chain; Bitcoin is refused.
 */
export function useRunLeveragePositionOperation<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseRunLeveragePositionOperationVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseRunLeveragePositionOperationVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseRunLeveragePositionOperationVars<K>>({
    mutationKey: ['leverageYield', 'runPositionOperation'],
    ...mutationOptions,
    mutationFn: async vars =>
      unwrapResult(await sodax.leverageYield.runLeveragePositionOperation({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey);
      // A position write affects every position read (account, pending slot, list).
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
