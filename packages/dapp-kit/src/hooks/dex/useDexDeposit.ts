// packages/dapp-kit/src/hooks/dex/useDexDeposit.ts
import type { AssetDepositAction, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useDexDeposit}. Generic over `K extends SpokeChainKey` (defaults
 * to the full union). Sophisticated callers can lock K at the hook call site to narrow the
 * `walletProvider` and `params.srcChainKey` types.
 */
export type UseDexDepositVars<K extends SpokeChainKey = SpokeChainKey> = Omit<AssetDepositAction<K, false>, 'raw'>;

/**
 * React hook for depositing an asset into a DEX pool.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `TxHashPair` on success.
 *
 * @example
 * ```tsx
 * const walletProvider = useWalletProvider({ xChainId: chainKey });
 * const { mutateAsync: deposit } = useDexDeposit();
 * try {
 *   const { spokeTxHash, hubTxHash } = await deposit({ params, walletProvider });
 * } catch (e) {
 *   // surfaced via mutation.error / onError
 * }
 * ```
 */
export function useDexDeposit<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseDexDepositVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseDexDepositVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseDexDepositVars<K>>({
    mutationKey: ['dex', 'deposit'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.dex.assetService.deposit({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      const { params } = vars;
      queryClient.invalidateQueries({ queryKey: ['dex', 'poolBalances', params.srcChainKey, params.srcAddress] });
      queryClient.invalidateQueries({
        queryKey: ['dex', 'allowance', params.srcChainKey, params.asset, params.amount.toString()],
      });
      invalidateBalances(queryClient, params.srcChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
