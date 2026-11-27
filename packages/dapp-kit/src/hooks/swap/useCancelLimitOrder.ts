import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { GetWalletProviderType, Intent, SpokeChainKey, TxHashPair } from '@sodax/sdk';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { unwrapResult } from '../shared/unwrapResult.js';

type CancelLimitOrderParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  walletProvider: GetWalletProviderType<K>;
  intent: Intent;
  timeout?: number;
};

/** Throws on SDK failure; resolves to the unwrapped `TxHashPair`. */
export function useCancelLimitOrder({
  mutationOptions,
}: MutationHookParams<TxHashPair, CancelLimitOrderParams> = {}): SafeUseMutationResult<
  TxHashPair,
  Error,
  CancelLimitOrderParams
> {
  const { sodax } = useSodaxContext();

  return useSafeMutation<TxHashPair, Error, CancelLimitOrderParams>({
    mutationKey: ['swap', 'limitOrder', 'cancel'],
    ...mutationOptions,
    mutationFn: async ({ srcChainKey, walletProvider, intent, timeout }) =>
      unwrapResult(await sodax.swaps.cancelLimitOrder({ params: { srcChainKey, intent }, walletProvider, timeout })),
  });
}
