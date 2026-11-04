import { useMemo } from 'react';
import type { ChainType } from '@sodax/types';
import type { XAccount } from '@/types/index.js';
import { useEnabledChains } from './useEnabledChains.js';
import { useXConnections } from './useXConnections.js';

/**
 * Returns connected accounts for every enabled chain type, keyed by `ChainType`.
 *
 * Each entry is always populated — disconnected chains have `address: undefined`,
 * mirroring `useXAccount`'s shape. Iterates `enabledChains` so the result reflects
 * exactly the slots present in `SodaxWalletProvider` config.
 *
 * Useful for "manage connections" panels and multi-chain status badges. For an
 * enriched view with connector metadata (name, icon), use `useConnectedChains` —
 * which also exposes a hydration `status` flag to gate first-paint UI.
 *
 * @see {@link https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#read-connected-account-state | Connect Flow — Read state}
 */
export function useXAccounts() {
  const enabledChains = useEnabledChains();
  const xConnections = useXConnections();

  return useMemo(() => {
    const result: Partial<Record<ChainType, XAccount>> = {};
    for (const xChainType of enabledChains) {
      const xConnection = xConnections[xChainType];
      result[xChainType] = xConnection?.xAccount ?? { address: undefined, xChainType };
    }
    return result;
  }, [enabledChains, xConnections]);
}
