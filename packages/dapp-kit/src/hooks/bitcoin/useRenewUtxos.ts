import { normalizePsbtToBase64, type IBitcoinWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { loadRadfiSession } from './useRadfiAuth.js';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseRenewUtxosVars = {
  txIdVouts: string[];
  walletProvider: IBitcoinWalletProvider;
};

export function useRenewUtxos({
  mutationOptions,
}: MutationHookParams<string, UseRenewUtxosVars> = {}): SafeUseMutationResult<string, Error, UseRenewUtxosVars> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<string, Error, UseRenewUtxosVars>({
    mutationKey: ['bitcoin', 'renewUtxos'],
    ...mutationOptions,
    mutationFn: async ({ txIdVouts, walletProvider }) => {
      const radfi = sodax.spoke.bitcoin.radfi;

      const userAddress = await walletProvider.getWalletAddress();
      const session = loadRadfiSession(userAddress);
      const accessToken = session?.accessToken || radfi.accessToken;

      if (!accessToken) {
        throw new Error('Bound Exchange authentication required. Please login first.');
      }

      const buildResult = await radfi.buildRenewUtxoTransaction({ userAddress, txIdVouts }, accessToken);

      const signedTx = await walletProvider.signTransaction(buildResult.base64Psbt, false);

      const signedBase64Tx = normalizePsbtToBase64(signedTx);

      return radfi.signAndBroadcastRenewUtxo({ userAddress, signedBase64Tx }, accessToken);
    },
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['bitcoin', 'expiredUtxos'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin', 'tradingWalletBalance'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
