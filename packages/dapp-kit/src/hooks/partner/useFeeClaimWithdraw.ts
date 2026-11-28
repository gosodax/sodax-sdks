import {
  ChainKeys,
  type Address,
  type BridgeParams,
  type GetWalletProviderType,
  type HubChainKey,
  type SpokeChainKey,
  type TxHashPair,
} from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** `feeToken` is the hub asset `address` on Sonic; `dstToken` is its `originalAddress` (or `feeToken` for Sonic). */
export type UseFeeClaimWithdrawVars = {
  params: {
    srcAddress: string;
    feeToken: Address;
    amount: bigint;
    dstChainKey: SpokeChainKey;
    dstToken: string;
    recipient: string;
  };
  walletProvider: GetWalletProviderType<HubChainKey>;
};

/**
 * Bridges a fee token out without a swap (the solver rejects same-token swaps). Needs a prior hub-wallet
 * router allowance via `useBridgeAllowance` / `useBridgeApprove`, not the ProtocolIntents approval.
 */
export function useFeeClaimWithdraw({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseFeeClaimWithdrawVars> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseFeeClaimWithdrawVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseFeeClaimWithdrawVars>({
    mutationKey: ['partner', 'feeClaimWithdraw'],
    ...mutationOptions,
    mutationFn: async ({ params, walletProvider }) => {
      const bridgeParams = {
        params: {
          srcChainKey: ChainKeys.SONIC_MAINNET,
          srcAddress: params.srcAddress,
          srcToken: params.feeToken,
          amount: params.amount,
          dstChainKey: params.dstChainKey,
          dstToken: params.dstToken,
          recipient: params.recipient,
        },
        raw: false,
        walletProvider,
      } satisfies BridgeParams<HubChainKey, false>;

      return unwrapResult(await sodax.bridge.bridge(bridgeParams));
    },
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'assetsBalances', vars.params.srcAddress],
      });
      invalidateBalances(queryClient, vars.params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
