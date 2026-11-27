import type { EstimateGasParams, GetEstimateGasReturnType, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from './useSodaxContext.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';
import { unwrapResult } from './unwrapResult.js';

export function useEstimateGas<C extends SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<GetEstimateGasReturnType<C>, EstimateGasParams<C>> = {}): SafeUseMutationResult<
  GetEstimateGasReturnType<C>,
  Error,
  EstimateGasParams<C>
> {
  const { sodax } = useSodaxContext();
  return useSafeMutation<GetEstimateGasReturnType<C>, Error, EstimateGasParams<C>>({
    mutationKey: ['shared', 'estimateGas'],
    ...mutationOptions,
    mutationFn: async params => unwrapResult(await sodax.spoke.estimateGas<C>(params)),
  });
}
