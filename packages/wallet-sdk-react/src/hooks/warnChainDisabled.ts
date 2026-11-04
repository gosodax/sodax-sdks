import type { ChainType } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

/** The slice of the store this check reads. */
export type ChainEnablementState = {
  enabledChains: ChainType[];
  walletConfig: SodaxWalletConfig | undefined;
};

/**
 * Whether to emit the one-time "chain not enabled" warning, recording the chain in `warned`.
 *
 * Stays silent until `initChainServices` has run. `enabledChains` is `[]` on the first render of
 * every child, because the store is populated from an effect in `useInitChainServices` and React
 * runs children before parent effects — so a correctly-configured app hits this path once on
 * mount. Warning there is worse than noise: the one-shot is keyed by chain type, so the spurious
 * warning consumes it and a genuine misconfiguration on that chain is then never reported.
 *
 * `walletConfig` is the init signal: it is `undefined` in the store's initial state, is set only by
 * `initChainServices`, and is excluded from `partialize`, so persist rehydration cannot forge it.
 */
export function shouldWarnChainDisabled(
  chainType: ChainType,
  state: ChainEnablementState,
  warned: Set<ChainType>,
): boolean {
  if (!state.walletConfig) return false;
  if (state.enabledChains.includes(chainType)) return false;
  if (warned.has(chainType)) return false;

  warned.add(chainType);
  return true;
}
