import { useSodaxContext } from '../shared/useSodaxContext.js';
import { invalidateBalances } from '../shared/invalidateBalances.js';
import type { SpokeChainKey, VaultSwapActionParams, VaultSwapResponse } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

/**
 * Mutation variables for {@link useLeverageYieldVaultSwap}. Generic over `K extends SpokeChainKey`
 * (defaults to the full union). Sophisticated callers can lock K at the hook call site to narrow
 * the `walletProvider` and `params.srcChainKey` types.
 */
export type UseLeverageYieldVaultSwapVars<K extends SpokeChainKey = SpokeChainKey> = Omit<
  VaultSwapActionParams<K, false>,
  'raw'
>;

/**
 * React hook for executing an end-to-end leverage-yield vault swap (deposit or withdraw).
 *
 * Spread a `LeverageYieldSwapPayload` built by {@link useLeverageYieldDeposit} /
 * {@link useLeverageYieldWithdraw} into `mutate` alongside the wallet provider:
 * `vaultSwap({ ...payload, walletProvider })`. Runs `sodax.leverageYield.vaultSwap`, so vault flows
 * never touch the generic swap surface.
 *
 * Which transport it takes is config, not an argument. With `leverageYield.useBackendSubmitTx` on,
 * it creates the intent and hands the broadcast tx to the leverage-yield API, which relays and
 * post-executes server-side, falling back to the client-side path (verify → relay → notify solver)
 * on any non-success. With it off, that client-side path runs outright. Read the effective value on
 * `sodax.config.leverageYieldUseBackendSubmitTx` rather than assuming which way it points.
 * Either way the resolved value is the same `VaultSwapResponse`.
 *
 * Pass `extras.apiKey` to key the backend leg per action, overriding the instance key. Poll the
 * result with {@link useLeverageYieldDetailedStatus}, which reads a vault swap's status from the
 * source-chain tx hash whichever transport completed it.
 *
 * Throws on SDK failure so React Query's native error model engages (`isError`, `error`,
 * `onError`, `retry`). Returns the unwrapped `VaultSwapResponse` on success.
 */
export function useLeverageYieldVaultSwap<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<VaultSwapResponse, UseLeverageYieldVaultSwapVars<K>> = {}): SafeUseMutationResult<
  VaultSwapResponse,
  Error,
  UseLeverageYieldVaultSwapVars<K>
> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<VaultSwapResponse, Error, UseLeverageYieldVaultSwapVars<K>>({
    mutationKey: ['leverageYield', 'vaultSwap'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.leverageYield.vaultSwap({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
