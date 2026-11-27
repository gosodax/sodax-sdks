import type { HubChainKey, PartnerFeeClaimCancelAction, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UsePartnerCancelIntentVars = Omit<PartnerFeeClaimCancelAction<HubChainKey, false>, 'raw'>;

/**
 * The only authorized cancel for partner auto-swap intents (ProtocolIntents is the creator, so the generic
 * swap cancel reverts); refunds the locked input to the partner.
 */
export function usePartnerCancelIntent({
  mutationOptions,
}: MutationHookParams<TxReturnType<HubChainKey, false>, UsePartnerCancelIntentVars> = {}): SafeUseMutationResult<
  TxReturnType<HubChainKey, false>,
  Error,
  UsePartnerCancelIntentVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<HubChainKey, false>, Error, UsePartnerCancelIntentVars>({
    mutationKey: ['partner', 'cancelIntent'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.partners.feeClaim.cancelIntent<false>({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'assetsBalances', vars.params.srcAddress],
      });
      queryClient.invalidateQueries({
        queryKey: [
          'partner',
          'feeClaim',
          'userIntent',
          vars.params.srcAddress,
          vars.params.fromToken,
          vars.params.toToken,
        ],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
