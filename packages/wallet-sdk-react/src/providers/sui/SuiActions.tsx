import { useEffect, useRef } from 'react';
import { getWalletUniqueIdentifier, useDAppKit, useWallets } from '@mysten/dapp-kit-react';
import { useXWalletStore } from '@/useXWalletStore.js';

/**
 * Registers SUI ChainActions into the store.
 */
export const SuiActions = () => {
  const dAppKit = useDAppKit();
  const suiWallets = useWallets();
  const registerChainActions = useXWalletStore(state => state.registerChainActions);

  const dAppKitRef = useRef(dAppKit);
  const walletsRef = useRef(suiWallets);

  useEffect(() => {
    dAppKitRef.current = dAppKit;
  }, [dAppKit]);
  useEffect(() => {
    walletsRef.current = suiWallets;
  }, [suiWallets]);

  useEffect(() => {
    registerChainActions('SUI', {
      connect: async (xConnectorId: string) => {
        const wallet = walletsRef.current.find(w => getWalletUniqueIdentifier(w) === xConnectorId);
        if (!wallet) {
          console.warn(
            `[SuiActions] connect: wallet "${xConnectorId}" not found in adapter list`,
            walletsRef.current.map(w => w.name),
          );
          return undefined;
        }
        await dAppKitRef.current.connectWallet({ wallet });
        return undefined;
      },
      disconnect: async () => {
        await dAppKitRef.current.disconnectWallet();
        // SUI disconnection state is cleared by SuiHydrator (single writer for provider-managed chains)
      },
      getConnectors: () => useXWalletStore.getState().xConnectorsByChain.SUI ?? [],
      getConnection: () => useXWalletStore.getState().xConnections.SUI,
      signMessage: async (message: string) => {
        const res = await dAppKitRef.current.signPersonalMessage({
          message: new Uint8Array(new TextEncoder().encode(message)),
        });
        return res.signature;
      },
    });
  }, [registerChainActions]);

  return null;
};
