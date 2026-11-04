import type { ChainType } from '@sodax/types';
import { useCallback } from 'react';
import { useXWalletStore } from '@/useXWalletStore.js';

export type UseXDisconnectArgs = {
  xChainType: ChainType;
};

/**
 * Returns a callback that disconnects the wallet for a given chain type.
 *
 * The callback delegates to the chain's `ChainActions.disconnect()` — provider-managed
 * chains (EVM/Solana/Sui) trigger native SDK disconnect and let the Hydrator clear the
 * store; non-provider chains call `unsetXConnection` directly.
 *
 * **Never throws.** When no `ChainActions` are registered (chain not enabled in
 * `SodaxWalletProvider` config), the callback logs a warning and resolves silently.
 * Even if the wallet's native disconnect throws, the store is cleared — the UI never
 * gets stuck on "connected" state.
 *
 * @see {@link https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#disconnect | Connect Flow — Disconnect}
 */
export function useXDisconnect(): (args: UseXDisconnectArgs) => Promise<void> {
  const actionsRegistry = useXWalletStore(state => state.chainActions);

  return useCallback(
    async ({ xChainType }: UseXDisconnectArgs) => {
      const chainActions = actionsRegistry[xChainType];
      if (chainActions) {
        await chainActions.disconnect();
      } else {
        console.warn(
          `[useXDisconnect] No chain actions registered for "${xChainType}". Is it enabled in config.chains?`,
        );
      }
    },
    [actionsRegistry],
  );
}
