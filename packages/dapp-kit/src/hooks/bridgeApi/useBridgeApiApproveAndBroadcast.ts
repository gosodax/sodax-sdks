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

/**
 * React hook that runs the whole bridge-API approval: asks the API for the transactions, then signs,
 * broadcasts, and waits for each one.
 *
 * Prefer this over {@link useBridgeApiApprove}, which hands back the unsigned `{ tx, resetTx? }` and
 * leaves the ordering — reset mined first, then approve — to the caller. Confirmation happens inside
 * the hook, so it invalidates `['bridgeApi','allowance']` itself.
 *
 * Supports the chains the bridge API can approve on — the hub (Sonic), EVM spokes, and Stellar.
 * Every other chain reports its allowance as always sufficient, so approval never runs for it.
 *
 * `onProgress` reports each transaction as `{ step, phase, index, total }`, so the UI can name the
 * wallet prompt the user is looking at instead of one flat "Approving…" across two signatures.
 *
 * @example
 * const { mutateAsyncSafe: approve } = useBridgeApiApproveAndBroadcast();
 * const result = await approve({ body: createBridgeIntentParams, walletProvider, onProgress: setStep });
 * if (!result.ok) return;
 * const { resetTxHash, approveTxHash } = result.value;   // resetTxHash only on a guarded token
 */
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

      return runApprovalPlan({
        plan,
        srcChainKey: body.srcChainKey as SpokeChainKey,
        walletProvider,
        hookName: 'useBridgeApiApproveAndBroadcast',
        onProgress,
      });
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited: the mutation must not resolve — re-enabling Approve — before the allowance query
      // has actually refetched, or a stale cached `valid: false` re-enables a duplicate approval.
      await queryClient.invalidateQueries({ queryKey: ['bridgeApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
