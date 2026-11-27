import type {
  ApproveResponseV2,
  CreateDepositIntentParamsV2,
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

export type LeverageYieldApiApprovalHashes = ApprovalHashes;

export type UseLeverageYieldApiApproveAndBroadcastVars<K extends SpokeChainKey = SpokeChainKey> = {
  body: CreateDepositIntentParamsV2;
  walletProvider: GetWalletProviderType<K>;
  apiConfig?: RequestOverrideConfig;
  /** Per-step progress. In the vars, not the hook options, so it is never a stale closure. */
  onProgress?: ApprovalProgressListener;
};

/**
 * Signs and confirms the deposit approval plan, mining the reset before the approve (USDT-lineage tokens revert).
 * Resolves after waiting up to ~15s for the API allowance to turn valid, valid or not: read the allowance.
 */
export const useLeverageYieldApiApproveAndBroadcast = <K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<
  LeverageYieldApiApprovalHashes,
  UseLeverageYieldApiApproveAndBroadcastVars<K>
> = {}): SafeUseMutationResult<
  LeverageYieldApiApprovalHashes,
  Error,
  UseLeverageYieldApiApproveAndBroadcastVars<K>
> => {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<LeverageYieldApiApprovalHashes, Error, UseLeverageYieldApiApproveAndBroadcastVars<K>>({
    mutationKey: ['leverageYieldApi', 'approveAndBroadcast'],
    ...mutationOptions,
    mutationFn: async ({ body, walletProvider, apiConfig, onProgress }): Promise<LeverageYieldApiApprovalHashes> => {
      const plan: ApproveResponseV2 = unwrapResult(await sodax.api.leverageYield.approve(body, apiConfig));

      const hashes = await runApprovalPlan({
        plan,
        srcChainKey: body.srcChainKey as SpokeChainKey,
        walletProvider,
        hookName: 'useLeverageYieldApiApproveAndBroadcast',
        onProgress,
      });
      await waitForApiAllowance(config => sodax.api.leverageYield.checkAllowance(body, config), apiConfig);
      return hashes;
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited so a stale cached `valid: false` cannot re-enable Approve before the refetch lands.
      await queryClient.invalidateQueries({ queryKey: ['leverageYieldApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
