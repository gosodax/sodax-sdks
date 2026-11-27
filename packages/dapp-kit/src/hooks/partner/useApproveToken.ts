import type { FeeTokenApproveAction, HubChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseApproveTokenVars = Omit<FeeTokenApproveAction<HubChainKey, false>, 'raw'>;

type ApproveTokenData = TxReturnType<HubChainKey, false>;

/** Approves max allowance to the protocol-intents contract on Sonic. */
export function useApproveToken({
  mutationOptions,
}: MutationHookParams<ApproveTokenData, UseApproveTokenVars> = {}): SafeUseMutationResult<
  ApproveTokenData,
  Error,
  UseApproveTokenVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<ApproveTokenData, Error, UseApproveTokenVars>({
    mutationKey: ['partner', 'approveToken'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.partners.feeClaim.approveToken<false>({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'isTokenApproved', params.srcChainKey, params.srcAddress, params.token],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
