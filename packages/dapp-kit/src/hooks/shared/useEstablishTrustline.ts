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

/** The account pays the fee and reserve; use {@link useStellarGate} to verify it can afford them. */
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
      // The amount sizes the trustline check, so `0n` is a caller bug.
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
      // Already broadcast: a locked/switched wallet must not turn success into an error or skip invalidation.
      const srcAddress = await vars.walletProvider.getWalletAddress().catch(() => undefined);
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
