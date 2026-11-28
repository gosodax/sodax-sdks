import { useQueryClient } from '@tanstack/react-query';
import type { GetWalletProviderType, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

export type UseApproveLeveragePositionFundingVars<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  /** Funding token, from `resolvePositionFunding` — not the reserve and not the vault. */
  token: string;
  amount: bigint;
  walletProvider?: GetWalletProviderType<K>;
};

/**
 * Approves the funding token for an open; the spender is chain-dependent (hub wallet on hub, spoke asset manager elsewhere).
 * Await before opening; invalidates {@link useLeveragePositionFundingAllowance} on success.
 */
export function useApproveLeveragePositionFunding<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseApproveLeveragePositionFundingVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseApproveLeveragePositionFundingVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseApproveLeveragePositionFundingVars<K>>({
    mutationKey: ['leverageYield', 'approvePositionFunding'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.approvePositionFunding(vars)),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['leverageYield', 'positionFundingAllowance', vars.srcChainKey, vars.srcAddress, vars.token],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
