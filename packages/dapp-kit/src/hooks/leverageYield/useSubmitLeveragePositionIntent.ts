import type {
  PositionBatchCall,
  LeveragePositionIntentResult,
  PositionOperationParams,
  SpokeChainKey,
  SpokeExecActionParams,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useSubmitLeveragePositionIntent} — the calls to run as the owner. */
export type UseSubmitLeveragePositionIntentVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  SpokeExecActionParams<K, false, PositionOperationParams<K, PositionBatchCall>>,
  'raw'
>;

/**
 * Runs position calls that POST A SOLVER INTENT — `increaseLeverage` and `decreaseLeverage` — as the
 * owning hub wallet, then reports it.
 *
 * USE {@link useRunLeveragePositionOperation} for `withdraw`, `settle` and `cancel`. The split is the
 * SDK's: those three are synchronous on the hub and need no notification, while these two only post
 * a request a solver fills later. Sending a leverage change through the other hook leaves an intent
 * nothing will fill, and it expires without a word.
 *
 * A position permits one intent at a time, so poll `useLeveragePositionPending` rather than assuming
 * the next call may go out.
 *
 * @experimental Off-hub (spoke) origins are unverified on-chain; see the SDK method.
 */
export function useSubmitLeveragePositionIntent<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<
  LeveragePositionIntentResult,
  UseSubmitLeveragePositionIntentVars<K>
> = {}): SafeUseMutationResult<LeveragePositionIntentResult, Error, UseSubmitLeveragePositionIntentVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<LeveragePositionIntentResult, Error, UseSubmitLeveragePositionIntentVars<K>>({
    mutationKey: ['leverageYield', 'submitPositionIntent'],
    ...mutationOptions,
    mutationFn: async vars =>
      unwrapResult(await sodax.leverageYield.submitLeveragePositionIntent({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      // The slot is occupied the moment this resolves, and the row's controls gate on it — so the
      // pending read has to be refetched even though nothing has filled yet.
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
