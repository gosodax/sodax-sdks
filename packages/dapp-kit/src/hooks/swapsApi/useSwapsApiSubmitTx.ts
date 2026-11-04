import type { RequestOverrideConfig, SubmitTxRequestV2, SubmitTxResponseV2 } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

/**
 * Mutation variables for {@link useSwapsApiSubmitTx}. The per-request `apiConfig` override
 * (e.g. base URL) belongs here rather than at the hook level — different submissions in the same
 * component can target different endpoints without re-rendering.
 */
export type UseSwapsApiSubmitTxVars = {
  request: SubmitTxRequestV2;
  apiConfig?: RequestOverrideConfig;
};

/**
 * React hook for submitting a swap transaction to be processed (relay, post execution to the
 * solver, etc.) via the swaps API — `sodax.api.swaps.submitTx`.
 *
 * Pure mutation: pass `{ request, apiConfig? }` to `mutate({...})`. Retries up to 3 times at the hook
 * level, except on a terminal API-key rejection (401/403) — see `retryUnlessAuthFailure`. Consumers
 * can override via `mutationOptions.retry`.
 *
 * @example
 * const { mutateAsync: submitSwapTx, isPending, error } = useSwapsApiSubmitTx();
 *
 * const result = await submitSwapTx({
 *   request: { txHash: '0x123...', srcChainKey: 'sonic', walletAddress: '0xabc...', intent: { ... }, relayData: '0x...' },
 *   apiConfig: { baseURL: 'https://...' },
 * });
 */
export const useSwapsApiSubmitTx = ({
  mutationOptions,
}: MutationHookParams<SubmitTxResponseV2, UseSwapsApiSubmitTxVars> = {}): SafeUseMutationResult<
  SubmitTxResponseV2,
  Error,
  UseSwapsApiSubmitTxVars
> => {
  const { sodax } = useSodaxContext();

  return useSafeMutation<SubmitTxResponseV2, Error, UseSwapsApiSubmitTxVars>({
    mutationKey: ['swapsApi', 'submitTx'],
    retry: retryUnlessAuthFailure,
    ...mutationOptions,
    mutationFn: async ({ request, apiConfig }): Promise<SubmitTxResponseV2> =>
      unwrapResult(await sodax.api.swaps.submitTx(request, apiConfig)),
  });
};
