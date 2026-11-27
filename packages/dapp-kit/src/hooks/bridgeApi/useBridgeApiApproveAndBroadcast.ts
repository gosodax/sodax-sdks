import type {
  BridgeApproveResponseV2,
  CreateBridgeIntentParamsV2,
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

export type BridgeApiApprovalHashes = ApprovalHashes;

export type UseBridgeApiApproveAndBroadcastVars<K extends SpokeChainKey = SpokeChainKey> = {
  body: CreateBridgeIntentParamsV2;
  walletProvider: GetWalletProviderType<K>;
  apiConfig?: RequestOverrideConfig;
  /** Per-step progress. In the vars, not the hook options, so it is never a stale closure. */
  onProgress?: ApprovalProgressListener;
};

/** Signs, broadcasts and waits for each approval tx (reset mined first), then waits up to ~15s for the API allowance to
 * report valid since its RPC can lag; resolves either way, so read the allowance rather than treating success as `valid`. */
export const useBridgeApiApproveAndBroadcast = <K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<BridgeApiApprovalHashes, UseBridgeApiApproveAndBroadcastVars<K>> = {}): SafeUseMutationResult<
  BridgeApiApprovalHashes,
  Error,
  UseBridgeApiApproveAndBroadcastVars<K>
> => {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<BridgeApiApprovalHashes, Error, UseBridgeApiApproveAndBroadcastVars<K>>({
    mutationKey: ['bridgeApi', 'approveAndBroadcast'],
    ...mutationOptions,
    mutationFn: async ({ body, walletProvider, apiConfig, onProgress }): Promise<BridgeApiApprovalHashes> => {
      const plan: BridgeApproveResponseV2 = unwrapResult(await sodax.api.bridge.approve(body, apiConfig));

      const hashes = await runApprovalPlan({
        plan,
        srcChainKey: body.srcChainKey as SpokeChainKey,
        walletProvider,
        hookName: 'useBridgeApiApproveAndBroadcast',
        onProgress,
      });
      await waitForApiAllowance(config => sodax.api.bridge.checkAllowance(body, config), apiConfig);
      return hashes;
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited: the mutation must not resolve — re-enabling Approve — before the allowance query
      // has actually refetched, or a stale cached `valid: false` re-enables a duplicate approval.
      await queryClient.invalidateQueries({ queryKey: ['bridgeApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
