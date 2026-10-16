import { useQueryClient } from '@tanstack/react-query';
import type { GetWalletProviderType, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useApproveLeveragePositionFunding}. */
export type UseApproveLeveragePositionFundingVars<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  /** Funding token, from `resolvePositionFunding` — not the reserve and not the vault. */
  token: string;
  amount: bigint;
  walletProvider?: GetWalletProviderType<K>;
};

/**
 * Approves the funding token for an open, against the spender the SDK resolves.
 *
 * THE SPENDER IS CHAIN-DEPENDENT — the hub wallet on the hub, the spoke asset manager elsewhere.
 * Nothing is ever approved to the position factory: it pulls from nobody.
 *
 * Wait for this before opening, and gate it on {@link useLeveragePositionFundingAllowance}, whose
 * query is invalidated here on success.
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
