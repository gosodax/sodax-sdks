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
 * React hook that runs the whole swaps-API approval: asks the API for the transactions, then signs,
 * broadcasts, and waits for each one.
 *
 * Prefer this over {@link useSwapsApiApprove}, which returns the unsigned `{ tx, resetTx? }` and
 * leaves the rest to you. A source token of the 2017 TetherToken lineage rejects an allowance change
 * from one non-zero value to another, so the API can hand back a **reset** transaction that must be
 * mined **before** the approve is even a valid state transition. Broadcasting them out of order, or
 * without waiting, spends the user's gas on a transaction that is certain to revert — and that is
 * ordering the package should own rather than every integration re-deriving it.
 *
 * Because confirmation now happens inside the hook, it can invalidate `['swapsApi','allowance']`
 * itself; callers of `useSwapsApiApprove` have to refetch by hand.
 *
 * Supports the chains the swaps API can approve on — the hub (Sonic), EVM spokes, and Stellar.
 * Every other chain reports its allowance as always sufficient, so approval never runs for it.
 *
 * @example
 * const { mutateAsyncSafe: approve } = useSwapsApiApproveAndBroadcast();
 * const result = await approve({ body: createIntentParams, walletProvider });
 * if (!result.ok) return;
 * const { resetTxHash, approveTxHash } = result.value;   // resetTxHash only on a guarded token
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

      return runApprovalPlan({
        plan,
        srcChainKey: body.srcChainKey as SpokeChainKey,
        walletProvider,
        hookName: 'useSwapsApiApproveAndBroadcast',
        onProgress,
      });
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited: the mutation must not resolve — re-enabling Approve — before the allowance query
      // has actually refetched, or a stale cached `valid: false` re-enables a duplicate approval.
      await queryClient.invalidateQueries({ queryKey: ['swapsApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
