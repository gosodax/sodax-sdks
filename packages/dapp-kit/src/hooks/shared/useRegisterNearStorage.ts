import { ChainKeys, type INearWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from './useSodaxContext.js';
import type { MutationHookParams } from './types.js';
import { useSafeMutation, type SafeUseMutationResult } from './useSafeMutation.js';

export type UseRegisterNearStorageVars = {
  token: string;
  accountId: string;
  walletProvider: INearWalletProvider;
  /** Storage bond override; defaults to the SDK's `NEAR_STORAGE_DEPOSIT` (0.00125 NEAR). */
  deposit?: bigint;
};

/** NEP-141 `storage_deposit` so `accountId` can receive `token` on NEAR; the recipient's wallet signs. */
export function useRegisterNearStorage({
  mutationOptions,
}: MutationHookParams<string, UseRegisterNearStorageVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseRegisterNearStorageVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  return useSafeMutation<string, Error, UseRegisterNearStorageVars>({
    mutationKey: ['shared', 'registerNearStorage'],
    ...mutationOptions,
    // `registerStorage` throws natively (no Result), hence `nativeThrow` in the mutation contract.
    mutationFn: async ({ token, accountId, walletProvider, deposit }) =>
      sodax.spoke.near.registerStorage({ token, accountId, walletProvider, deposit, raw: false }),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['shared', 'nearStorageCheck', ChainKeys.NEAR_MAINNET, vars.token, vars.accountId],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
