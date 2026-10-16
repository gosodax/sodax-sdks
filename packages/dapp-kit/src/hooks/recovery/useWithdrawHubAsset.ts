// packages/dapp-kit/src/hooks/recovery/useWithdrawHubAsset.ts
import type { SpokeChainKey, TxReturnType, WithdrawHubAssetAction } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useWithdrawHubAsset}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). Sophisticated callers can lock K at the hook call site to narrow
 * the `walletProvider` and `params.srcChainKey` types.
 */
export type UseWithdrawHubAssetVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  WithdrawHubAssetAction<K, false>,
  'raw'
>;

/**
 * React hook for withdrawing a hub-side asset back to the user's spoke chain wallet.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useWithdrawHubAsset<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseWithdrawHubAssetVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseWithdrawHubAssetVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseWithdrawHubAssetVars<K>>({
    mutationKey: ['recovery', 'withdrawHubAsset'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.recovery.withdrawHubAsset<K, false>({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({
        queryKey: ['recovery', 'hubAssetBalances', params.srcChainKey, params.srcAddress],
      });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
