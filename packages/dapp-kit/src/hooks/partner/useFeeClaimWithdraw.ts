// packages/dapp-kit/src/hooks/partner/useFeeClaimWithdraw.ts
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

/**
 * Mutation variables for {@link useFeeClaimWithdraw}. Maps a partner fee balance to a
 * Sonic-sourced bridge: `feeToken` is the wrapped hub-asset address on Sonic
 * (`PartnerFeeClaimAssetBalance.address`); `dstToken` is the original token address on
 * `dstChainKey` (`PartnerFeeClaimAssetBalance.originalAddress`, or `feeToken` for same-chain
 * delivery to a Sonic address).
 */
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
 * React hook to withdraw a partner fee token directly to the partner's wallet **without a swap**.
 *
 * For fees the partner wants to keep as-is (the desired output equals the fee token, e.g. BTC→BTC),
 * an auto-swap is impossible — the solver rejects a same-token swap. This bridges the wrapped fee
 * token from Sonic to its native chain (or transfers it on Sonic when `dstChainKey` is Sonic),
 * bypassing the solver entirely.
 *
 * Bridging from Sonic pulls the token via the partner's hub-wallet router, which requires a prior
 * allowance to that spender — a different approval than the ProtocolIntents one used by the swap
 * claim. Use `useBridgeAllowance` / `useBridgeApprove` (with the same mapped bridge params) first.
 *
 * Throws on SDK failure so React Query's native error model engages. Returns the `TxHashPair`.
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
