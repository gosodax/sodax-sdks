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

/** Discriminated on `side` so a wrong field set is a type error rather than a revert. */
export type UseOpenLeveragePositionVars<K extends SpokeChainKey = SpokeChainKey> =
  | ({ side?: 'collateral' } & Omit<SpokeExecActionParams<K, false, OpenPositionParams<K>>, 'raw'>)
  | ({ side: 'debt' } & Omit<SpokeExecActionParams<K, false, OpenPositionFromDebtTokenParams<K>>, 'raw'>);

/**
 * Resolving means the intent is live, not that the position is open; check `notified`, since a failed notification still resolves.
 * Pass the signer as `params.srcAddress`; the SDK resolves the owning hub wallet.
 * @experimental Off-hub (spoke) origins are unverified on-chain.
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
      // A position write affects every position read (account, pending slot, list).
      queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
