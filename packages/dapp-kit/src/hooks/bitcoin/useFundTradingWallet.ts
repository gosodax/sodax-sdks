// packages/dapp-kit/src/hooks/bitcoin/useFundTradingWallet.ts
import { useQueryClient } from '@tanstack/react-query';
import { ChainKeys, type IBitcoinWalletProvider } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type UseFundTradingWalletVars = {
  amount: bigint;
  walletProvider: IBitcoinWalletProvider;
};

/**
 * React hook for funding the user's Bound Exchange trading wallet from their personal Bitcoin wallet.
 * Pure mutation: pass `{ amount, walletProvider }` to `mutate({...})`. Returns the broadcast tx
 * id on success.
 */
export function useFundTradingWallet({
  mutationOptions,
}: MutationHookParams<string, UseFundTradingWalletVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseFundTradingWalletVars
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<string, Error, UseFundTradingWalletVars>({
    mutationKey: ['bitcoin', 'fundTradingWallet'],
    ...mutationOptions,
    mutationFn: async ({ amount, walletProvider }) => {
      const walletAddress = await walletProvider.getWalletAddress();
      return sodax.spoke.bitcoin.fundTradingWallet(amount, walletAddress, walletProvider);
    },
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ['bitcoin', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['bitcoin', 'tradingWalletBalance'] });
      invalidateBalances(queryClient, ChainKeys.BITCOIN_MAINNET);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
