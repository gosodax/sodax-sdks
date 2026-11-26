import { ChainKeys, type IXrpWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateBalances } from './invalidateBalances.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';
import { useSodaxContext } from './useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';

export type UseEstablishXrpTrustlineVars = {
  /** The XRPL issued token to hold. */
  token: string;
  /** The account that needs the trustline. When set, the mutation refuses a wallet connected to another account. */
  address?: string;
  walletProvider: IXrpWalletProvider;
};

/**
 * Create the XRPL trustline the connected account needs to hold `token`, or raise its limit. Resolves to the
 * TrustSet hash once it validates. The account pays its fee and owner reserve: check with
 * {@link useXrpTrustlineReserveCheck}, or use {@link useXrpGate}, before asking the user to sign.
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
      // The TrustSet is already validated, so an account switch mid-flow must not skip the invalidations.
      const address = await vars.walletProvider.getWalletAddress().catch(() => undefined);
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
