import type { IStellarWalletProvider, StellarChainKey } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateBalances } from './invalidateBalances.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';
import { useSodaxContext } from './useSodaxContext.js';

export type UseEstablishTrustlineVars = {
  token: string;
  amount: bigint;
  srcChainKey: StellarChainKey;
  walletProvider: IStellarWalletProvider;
};

/**
 * Establish a Stellar trustline. The account pays its fee and reserve; use
 * {@link useStellarGate} to verify it can afford them.
 *
 * Supersedes the deprecated `useRequestTrustline`, which keeps the hand-rolled
 * shape released in 2.0.0.
 */
export function useEstablishTrustline({
  mutationOptions,
}: MutationHookParams<string, UseEstablishTrustlineVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseEstablishTrustlineVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<string, Error, UseEstablishTrustlineVars>({
    mutationKey: ['shared', 'establishTrustline'],
    ...mutationOptions,
    mutationFn: async ({ token, amount, srcChainKey, walletProvider }): Promise<string> => {
      // Rejecting `0n` preserves the behaviour of the hook this replaced: an amount
      // sizes the trustline check, so zero is a caller bug rather than a request.
      if (!token || !amount) {
        throw new Error('Token and amount are required');
      }
      const srcAddress = await walletProvider.getWalletAddress();
      return sodax.spoke.stellar.requestTrustline<false>({
        raw: false,
        srcChainKey,
        srcAddress,
        token,
        amount,
        walletProvider,
      });
    },
    onSuccess: async (data, vars, ctx) => {
      // The trustline is already broadcast here, so a wallet that locks or switches
      // accounts mid-flow must not turn success into an error — nor skip the
      // invalidations below, which is what an unguarded throw would do.
      const srcAddress = await vars.walletProvider.getWalletAddress().catch(() => undefined);
      // Without the address, invalidate the whole prefix rather than nothing.
      queryClient.invalidateQueries({
        queryKey: srcAddress
          ? ['shared', 'stellarTrustlineCheck', vars.srcChainKey, vars.token, srcAddress]
          : ['shared', 'stellarTrustlineCheck'],
      });
      // A new trustline changes spendable XLM for subsequent trustlines.
      queryClient.invalidateQueries({
        queryKey: srcAddress
          ? ['sponsoring', 'stellarAccountStatus', srcAddress]
          : ['sponsoring', 'stellarAccountStatus'],
      });
      invalidateBalances(queryClient, ChainKeys.STELLAR_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
