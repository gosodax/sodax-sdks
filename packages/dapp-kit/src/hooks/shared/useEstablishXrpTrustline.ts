import { ChainKeys, type IXrpWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateBalances } from './invalidateBalances.js';
import { retryBeforeSubmission } from './retryBeforeSubmission.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';
import { useSodaxContext } from './useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';

export type UseEstablishXrpTrustlineVars = {
  token: string;
  /** When set, the mutation refuses a wallet connected to another account. */
  address?: string;
  walletProvider: IXrpWalletProvider;
};

/**
 * Creates or raises the XRPL trustline; resolves to the validated TrustSet hash. The account pays the fee
 * and possibly an owner reserve: check with {@link useXrpGate} before asking the user to sign.
 */
export function useEstablishXrpTrustline({
  mutationOptions,
}: MutationHookParams<string, UseEstablishXrpTrustlineVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseEstablishXrpTrustlineVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<string, Error, UseEstablishXrpTrustlineVars>({
    mutationKey: ['shared', 'establishXrpTrustline'],
    ...mutationOptions,
    // Each TrustSet costs a fee, so one that may have been sent is never signed again automatically.
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['shared', 'establishXrpTrustline'])?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async ({ token, address, walletProvider }): Promise<string> => {
      const srcAddress = await walletProvider.getWalletAddress();
      if (address !== undefined && address !== srcAddress) {
        throw new Error(
          `The connected XRPL account ${srcAddress} is not ${address}, which needs the trustline — connect ${address} to add it`,
        );
      }
      return unwrapResult(await sodax.spoke.xrp.requestTrustline<false>({ srcAddress, token, walletProvider }));
    },
    onSuccess: async (data, vars, ctx) => {
      // The checked account, not whichever account the wallet is on by now.
      const address = vars.address ?? (await vars.walletProvider.getWalletAddress().catch(() => undefined));
      queryClient.invalidateQueries({
        queryKey: address
          ? ['shared', 'xrpDestinationCheck', ChainKeys.XRP_MAINNET, vars.token, address]
          : ['shared', 'xrpDestinationCheck'],
      });
      // A new line locks an owner reserve, which changes what the next trustline can afford.
      queryClient.invalidateQueries({ queryKey: ['shared', 'xrpTrustlineReserveCheck'] });
      invalidateBalances(queryClient, ChainKeys.XRP_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
