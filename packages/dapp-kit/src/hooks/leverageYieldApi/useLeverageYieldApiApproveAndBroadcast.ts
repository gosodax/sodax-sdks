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
 * React hook that runs the whole leverage-yield-API deposit approval: asks the API for the
 * transactions, then signs, broadcasts, and waits for each one. (Only a deposit needs a spoke
 * allowance — a withdraw spends `lsoda*` from the hub wallet.)
 *
 * Prefer this over {@link useLeverageYieldApiApprove}, which hands back the unsigned
 * `{ tx, resetTx? }` and leaves the ordering — reset mined first, then approve — to the caller. A
 * deposit token of the 2017 TetherToken lineage rejects an allowance change from one non-zero value
 * to another, so broadcasting the approve without the reset spends the user's gas on a transaction
 * that is certain to revert. Confirmation happens inside the hook, so it invalidates
 * `['leverageYieldApi','allowance']` itself.
 *
 * Supports the chains the leverage-yield API can approve on — the hub (Sonic), EVM spokes, and
 * Stellar. Every other chain reports its allowance as always sufficient, so approval never runs.
 *
 * `onProgress` reports each transaction as `{ step, phase, index, total }`, so the UI can name the
 * wallet prompt the user is looking at instead of one flat "Approving…" across two signatures.
 *
 * @example
 * const { mutateAsyncSafe: approve } = useLeverageYieldApiApproveAndBroadcast();
 * const result = await approve({ body: depositIntentParams, walletProvider, onProgress: setStep });
 * if (!result.ok) return;
 * const { resetTxHash, approveTxHash } = result.value;   // resetTxHash only on a guarded token
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

      return runApprovalPlan({
        plan,
        srcChainKey: body.srcChainKey as SpokeChainKey,
        walletProvider,
        hookName: 'useLeverageYieldApiApproveAndBroadcast',
        onProgress,
      });
    },
    onSuccess: async (data, vars, ctx) => {
      // Awaited: the mutation must not resolve — re-enabling Approve — before the allowance query
      // has actually refetched, or a stale cached `valid: false` re-enables a duplicate approval.
      await queryClient.invalidateQueries({ queryKey: ['leverageYieldApi', 'allowance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
};
