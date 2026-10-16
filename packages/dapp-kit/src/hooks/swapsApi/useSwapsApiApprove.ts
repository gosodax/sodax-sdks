import type { ApproveResponseV2, CreateIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiApprove}. The per-request `apiConfig` override belongs
 * here rather than at the hook level — different calls in the same component can target different
 * endpoints without re-rendering.
 */
export type UseSwapsApiApproveVars = {
  body: CreateIntentParamsV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook to build an unsigned token-approval transaction for the source token via the swaps
 * API — `sodax.api.swaps.approve`. Returns `{ tx }` (chain-specific unsigned tx) to sign and
 * broadcast yourself; it does not change state, so no queries are invalidated.
 *
 * @example
 * const { mutateAsync: approve } = useSwapsApiApprove();
 * const { tx } = await approve({ body: createIntentParams });
 */
export const useSwapsApiApprove = ({
  mutationOptions,
}: MutationHookParams<ApproveResponseV2, UseSwapsApiApproveVars> = {}): SafeUseMutationResult<
  ApproveResponseV2,
  Error,
  UseSwapsApiApproveVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<ApproveResponseV2, Error, UseSwapsApiApproveVars>({
    mutationKey: ['swapsApi', 'approve'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ body, apiConfig }): Promise<ApproveResponseV2> =>
      unwrapResult(await sodax.api.swaps.approve(body, apiConfig)),
  });
};
