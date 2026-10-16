import { useQueryClient } from '@tanstack/react-query';
import type {
  PositionDirectCall,
  PositionOperationParams,
  SpokeChainKey,
  SpokeExecActionParams,
  TxHashPair,
} from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useRunLeveragePositionOperation} — the calls to run as the owner. */
export type UseRunLeveragePositionOperationVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  SpokeExecActionParams<K, false, PositionOperationParams<K, PositionDirectCall>>,
  'raw'
>;

/**
 * Runs position calls that DO NOT post an intent — `withdraw`, `settle` and `cancel` — as the owning
 * hub wallet. They are synchronous on the hub, so resolving means the work is done.
 *
 * Still routed, never sent directly: the position's `onlyOwner` is the hub wallet, so a call sent
 * from the signer reverts `NotOwner`. Locally through the wallet router on the hub, relayed from
 * anywhere else.
 *
 * USE {@link useSubmitLeveragePositionIntent} FOR `increaseLeverage` AND `decreaseLeverage`. Those
 * only post a request a solver fills later, and this hook does not notify the solver, so sending one
 * through here creates an intent nothing will fill. It expires silently and the operation is lost.
 * The other direction is harmless by comparison: notifying about a withdraw is noise, not damage.
 *
 * Balances are invalidated for `srcChainKey` because a withdraw pays out.
 *
 * @experimental OFF-HUB (SPOKE) ORIGINS ARE UNVERIFIED ON-CHAIN, and this is the hook that carries the
 *              worst of it: an exit or cancellation delivering the underlying back to the spoke it
 *              came from has never run on mainnet. Bitcoin is refused outright.
 */
export function useRunLeveragePositionOperation<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<TxHashPair, UseRunLeveragePositionOperationVars<K>> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  UseRunLeveragePositionOperationVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxHashPair, Error, UseRunLeveragePositionOperationVars<K>>({
    mutationKey: ['leverageYield', 'runPositionOperation'],
    ...mutationOptions,
    mutationFn: async vars =>
      unwrapResult(await sodax.leverageYield.runLeveragePositionOperation({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey);
      // A position write changes every position read — account, pending slot, the list itself — and a
      // partner that has to remember this leaves the UI stale after the one action it just took.
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
