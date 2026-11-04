// packages/dapp-kit/src/hooks/bitcoin/useRadfiWithdraw.ts
import { normalizePsbtToBase64, ChainKeys, type IBitcoinWalletProvider } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { loadRadfiSession } from './useRadfiAuth.js';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseRadfiWithdrawVars = {
  amount: string;
  tokenId: string;
  withdrawTo: string;
  walletProvider: IBitcoinWalletProvider;
};

type WithdrawResult = {
  txId: string;
  fee: number;
};

/**
 * React hook for withdrawing BTC from the user's Bound Exchange trading wallet back to their personal
 * Bitcoin wallet. Pure mutation: pass all inputs (including the wallet provider) to
 * `mutate({...})`.
 */
export function useRadfiWithdraw({
  mutationOptions,
}: MutationHookParams<WithdrawResult, UseRadfiWithdrawVars> = {}): SafeUseMutationResult<
  WithdrawResult,
  Error,
  UseRadfiWithdrawVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<WithdrawResult, Error, UseRadfiWithdrawVars>({
    mutationKey: ['bitcoin', 'radfiWithdraw'],
    ...mutationOptions,
    mutationFn: async ({ amount, tokenId, withdrawTo, walletProvider }) => {
      const radfi = sodax.spoke.bitcoin.radfi;

      const userAddress = await walletProvider.getWalletAddress();
      const session = loadRadfiSession(userAddress);
      const accessToken = session?.accessToken || radfi.accessToken;

      if (!accessToken) {
        throw new Error('Bound Exchange authentication required. Please login first.');
      }

      const buildResult = await radfi.withdrawToUser({ userAddress, amount, tokenId, withdrawTo }, accessToken);

      const signedTx = await walletProvider.signTransaction(buildResult.base64Psbt, false);

      const signedBase64Tx = normalizePsbtToBase64(signedTx);

      const txId = await radfi.signAndBroadcastWithdraw({ userAddress, signedBase64Tx }, accessToken);

      return { txId, fee: buildResult.fee.totalFee };
    },
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['bitcoin', 'tradingWalletBalance'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin', 'balance'] });
      invalidateBalances(queryClient, ChainKeys.BITCOIN_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
