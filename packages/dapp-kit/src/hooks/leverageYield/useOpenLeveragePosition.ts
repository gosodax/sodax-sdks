import { useQueryClient } from '@tanstack/react-query';
import type {
  LeveragePositionIntentResult,
  OpenPositionFromDebtTokenParams,
  OpenPositionParams,
  SpokeChainKey,
  SpokeExecActionParams,
} from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useOpenLeveragePosition}.
 *
 * `side` picks which asset funds the open, and the two take different params — so the union is
 * discriminated rather than merged, and the wrong field set is a type error instead of a revert.
 */
export type UseOpenLeveragePositionVars<K extends SpokeChainKey = SpokeChainKey> =
  | ({ side?: 'collateral' } & Omit<SpokeExecActionParams<K, false, OpenPositionParams<K>>, 'raw'>)
  | ({ side: 'debt' } & Omit<SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>, 'raw'>);

/**
 * Opens a leveraged position, funded from any chain, and reports the intent it posts.
 *
 * Thin over `sodax.leverageYield.openLeveragePosition`, which owns the pairing — a non-React caller
 * gets the same guarantee. Resolving means the intent is LIVE, not that the position is open: read
 * `notified` before telling the owner to wait, since a failed notification still resolves.
 *
 * Positions are owned by the hub wallet, never the signing address — pass the signer as
 * `params.srcAddress` and the SDK resolves the owner.
 *
 * @experimental Off-hub (spoke) origins are unverified on-chain; see the SDK method.
 */
export function useOpenLeveragePosition<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<LeveragePositionIntentResult, UseOpenLeveragePositionVars<K>> = {}): SafeUseMutationResult<
  LeveragePositionIntentResult,
  Error,
  UseOpenLeveragePositionVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<LeveragePositionIntentResult, Error, UseOpenLeveragePositionVars<K>>({
    mutationKey: ['leverageYield', 'openPosition'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.openLeveragePosition({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey);
      // A position write changes every position read — account, pending slot, the list itself — and a
      // partner that has to remember this leaves the UI stale after the one action it just took.
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
