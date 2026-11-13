// packages/dapp-kit/src/hooks/partner/useSetSwapPreference.ts
import type { HubChainKey, SetSwapPreferenceAction, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Mutation variables for {@link useSetSwapPreference}; `K` is the hub chain key, as in the SDK signature. */
export type UseSetSwapPreferenceVars<K extends HubChainKey = HubChainKey> = Omit<
  SetSwapPreferenceAction<K, false>,
  'raw'
>;

/**
 * React hook to set the partner's auto-swap preferences (output token + destination chain +
 * destination address) on the protocol-intents contract.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped tx return value on success.
 */
export function useSetSwapPreference<K extends HubChainKey = HubChainKey>({
  mutationOptions,
}: MutationHookParams<TxReturnType<K, false>, UseSetSwapPreferenceVars<K>> = {}): SafeUseMutationResult<
  TxReturnType<K, false>,
  Error,
  UseSetSwapPreferenceVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<TxReturnType<K, false>, Error, UseSetSwapPreferenceVars<K>>({
    mutationKey: ['partner', 'setSwapPreference'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.partners.feeClaim.setSwapPreference({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      queryClient.invalidateQueries({
        queryKey: ['partner', 'feeClaim', 'autoSwapPreferences', (vars.params as { srcAddress: string }).srcAddress],
      });
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}

// Helper alias for the common Sonic-only call shape.
export type UseSetSwapPreferenceVarsHub = UseSetSwapPreferenceVars<HubChainKey>;
