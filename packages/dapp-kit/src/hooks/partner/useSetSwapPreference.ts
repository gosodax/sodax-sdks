import type { HubChainKey, SetSwapPreferenceAction, SpokeChainKey, TxReturnType } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/** Generic only for SDK signature compatibility; the SDK enforces hub-only at runtime. */
export type UseSetSwapPreferenceVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  SetSwapPreferenceAction<K, false>,
  'raw'
>;

export function useSetSwapPreference<K extends SpokeChainKey = SpokeChainKey>({
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

export type UseSetSwapPreferenceVarsHub = UseSetSwapPreferenceVars<HubChainKey>;
