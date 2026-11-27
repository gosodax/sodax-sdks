import type {
  ApproveResponseV2,
  CreateIntentParamsV2,
  GetWalletProviderType,
  RequestOverrideConfig,
  SpokeChainKey,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { unwrapResult } from '../shared/unwrapResult.js';
import { waitForApiAllowance } from '../shared/waitForApiAllowance.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { runApprovalPlan, type ApprovalHashes, type ApprovalProgressListener } from '../../utils/approvalPlan.js';

/** Hashes of the transactions this hook broadcast, in the order they were sent. */
export type SwapsApiApprovalHashes = ApprovalHashes;

export type UseSwapsApiApproveAndBroadcastVars<K extends SpokeChainKey = SpokeChainKey> = {
  body: CreateIntentParamsV2;
  walletProvider: GetWalletProviderType<K>;
  apiConfig?: RequestOverrideConfig;
  /** Per-step progress. In the vars, not the hook options, so it is never a stale closure. */
  onProgress?: ApprovalProgressListener;
};

/**
 * Signs and mines each approval tx in order: a USDT-style `resetTx` must mine before the approve.
 * Then waits up to ~15s for the API to report the allowance valid, but resolves either way.
 */
export const useSwapsApiApproveAndBroadcast = <K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SwapsApiApprovalHashes, UseSwapsApiApproveAndBroadcastVars<K>> = {}): SafeUseMutationResult<
  SwapsApiApprovalHashes,
  Error,
  UseSwapsApiApproveAndBroadcastVars<K>
> => {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapsApiApprovalHashes, Error, UseSwapsApiApproveAndBroadcastVars<K>>({
    mutationKey: ['swapsApi', 'approveAndBroadcast'],
    ...mutationOptions,
    mutationFn: async ({ body, walletProvider, apiConfig, onProgress }): Promise<SwapsApiApprovalHashes> => {
      const plan: ApproveResponseV2 = unwrapResult(await sodax.api.swaps.approve(body, apiConfig));

      const hashes = await runApprovalPlan({
        plan,
        srcChainKey: body.srcChainKey as SpokeChainKey,
        walletProvider,
        hookName: 'useSwapsApiApproveAndBroadcast',
        onProgress,
      });
      await waitForApiAllowance(config => sodax.api.swaps.checkAllowance(body, config), apiConfig);
      return hashes;
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited: the mutation must not resolve — re-enabling Approve — before the allowance query
      // has actually refetched, or a stale cached `valid: false` re-enables a duplicate approval.
      await queryClient.invalidateQueries({ queryKey: ['swapsApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
