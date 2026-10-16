import type { ChainType } from '@sodax/types';
import { useXWalletStore } from '@/useXWalletStore.js';
import type { IXConnector } from '@/types/interfaces.js';
import { shouldWarnChainDisabled } from './warnChainDisabled.js';

export type UseXConnectorsOptions = {
  xChainType?: ChainType;
};

const warnedChains = new Set<ChainType>();

/**
 * Returns available wallet connectors for a specific chain type, with enriched
 * metadata (`isInstalled`, `installUrl`, `icon`).
 *
 * Each `connector.isInstalled` reads `window.*` at access time — no extra subscription
 * is installed. Components receive fresh values through normal React render triggers
 * (store updates, parent re-renders).
 *
 * Returns `[]` when the chain isn't enabled in `SodaxWalletProvider` config and logs a
 * one-time warning per chain to help debug missing connector lists. For multi-chain
 * pickers, prefer `useXConnectorsByChain` which avoids the warning per chain.
 *
 * Pair with `sortConnectors(connectors, { preferred })` to rank installed/preferred wallets
 * first. `preferred` matches by exact `connector.id` — for substring/case-insensitive matching,
 * use `useIsWalletInstalled`.
 *
 * @see {@link https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#discover-connectors | Connect Flow — Discover}
 */
export function useXConnectors({ xChainType }: UseXConnectorsOptions = {}): IXConnector[] {
  return useXWalletStore(state => {
    if (!xChainType) return [];
    if (shouldWarnChainDisabled(xChainType, state, warnedChains)) {
      console.warn(
        `[useXConnectors] chain "${xChainType}" is not enabled in SodaxWalletProvider config.chains — returning empty list`,
      );
    }
    return state.xConnectorsByChain[xChainType] ?? [];
  });
}
