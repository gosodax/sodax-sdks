import type { AssetWithdrawAction, SpokeChainKey, OutboundSettlement } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { retryBeforeSubmission } from '../shared/retryBeforeSubmission.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseDexWithdrawVars<K extends SpokeChainKey = SpokeChainKey> = Omit<AssetWithdrawAction<K, false>, 'raw'>;

/** Throws on SDK failure; resolves to an {@link OutboundSettlement} (tx pair, or Tron relay `trackingId` + dst tx). */
export function useDexWithdraw<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<OutboundSettlement<K>, UseDexWithdrawVars<K>> = {}): SafeUseMutationResult<
  OutboundSettlement<K>,
  Error,
  UseDexWithdrawVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<OutboundSettlement<K>, Error, UseDexWithdrawVars<K>>({
    mutationKey: ['dex', 'withdraw'],
    ...mutationOptions,
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['dex', 'withdraw'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async vars => unwrapResult(await sodax.dex.assetService.withdraw({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
