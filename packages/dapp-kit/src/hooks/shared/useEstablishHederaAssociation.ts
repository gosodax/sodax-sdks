import { ChainKeys, type Hash, type IEvmWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateBalances } from './invalidateBalances.js';
import { retryBeforeSubmission } from './retryBeforeSubmission.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';
import { useSodaxContext } from './useSodaxContext.js';
import { unwrapResult } from './unwrapResult.js';

export type UseEstablishHederaAssociationVars = {
  /** The HTS token to associate. Only this token is associated. */
  token: string;
  /** The account that needs the association. When set, the mutation refuses a wallet connected to another account. */
  address?: string;
  walletProvider: IEvmWalletProvider;
};

/**
 * Associate exactly `token` with the connected Hedera account, by calling HIP-719 `associate()` on the
 * token. Resolves to the transaction hash once it is mined and the mirror node shows it. The account pays
 * the network fee in HBAR. Check with {@link useHederaDestinationCheck}, or use {@link useHederaGate}.
 */
export function useEstablishHederaAssociation({
  mutationOptions,
}: MutationHookParams<Hash, UseEstablishHederaAssociationVars> = {}): SafeUseMutationResult<
  Hash,
  Error,
  UseEstablishHederaAssociationVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<Hash, Error, UseEstablishHederaAssociationVars>({
    mutationKey: ['shared', 'establishHederaAssociation'],
    ...mutationOptions,
    // Each association costs a fee, so one that may have been sent is never signed again automatically.
    retry: retryBeforeSubmission(
      mutationOptions?.retry ??
        queryClient.getMutationDefaults?.(mutationOptions?.mutationKey ?? ['shared', 'establishHederaAssociation'])
          ?.retry ??
        queryClient.getDefaultOptions?.().mutations?.retry,
    ),
    mutationFn: async ({ token, address, walletProvider }): Promise<Hash> => {
      const srcAddress = await walletProvider.getWalletAddress();
      if (address !== undefined && address.toLowerCase() !== srcAddress.toLowerCase()) {
        throw new Error(
          `The connected Hedera account ${srcAddress} is not ${address}, which needs the association — connect ${address} to add it`,
        );
      }
      return unwrapResult(await sodax.spoke.hedera.requestAssociation<false>({ srcAddress, token, walletProvider }));
    },
    onSuccess: async (data, vars, ctx) => {
      // The checked account, not whichever account the wallet is on by now.
      const address = vars.address ?? (await vars.walletProvider.getWalletAddress().catch(() => undefined));
      queryClient.invalidateQueries({
        queryKey: address
          ? ['shared', 'hederaDestinationCheck', ChainKeys.HEDERA_MAINNET, vars.token, address]
          : ['shared', 'hederaDestinationCheck'],
      });
      invalidateBalances(queryClient, ChainKeys.HEDERA_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
