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

export type UseSubmitLeveragePositionIntentVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  SpokeExecActionParams<K, false, PositionOperationParams<K, PositionBatchCall>>,
  'raw'
>;

/**
 * Intent-posting position calls (`increaseLeverage`, `decreaseLeverage`); one intent at a time, so gate on `useLeveragePositionPending`.
 * @experimental Off-hub (spoke) origins are unverified on-chain.
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
      // The pending slot is occupied as soon as this resolves, before any fill.
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
