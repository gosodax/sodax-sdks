import { useEffect, useRef } from 'react';
import { useConfig, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { useXWalletStore } from '@/useXWalletStore.js';

export const EvmActions = () => {
  const wagmiConfig = useConfig();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const registerChainActions = useXWalletStore(state => state.registerChainActions);

  const connectRef = useRef(connectAsync);
  const disconnectRef = useRef(disconnectAsync);
  const signMessageRef = useRef(signMessageAsync);
  const wagmiConfigRef = useRef(wagmiConfig);

  useEffect(() => {
    connectRef.current = connectAsync;
    disconnectRef.current = disconnectAsync;
    signMessageRef.current = signMessageAsync;
    wagmiConfigRef.current = wagmiConfig;
  }, [connectAsync, disconnectAsync, signMessageAsync, wagmiConfig]);

  useEffect(() => {
    registerChainActions('EVM', {
      connect: async (xConnectorId: string) => {
        const connector = wagmiConfigRef.current.connectors.find(c => c.id === xConnectorId);
        if (!connector) {
          console.warn(
            `[EvmActions] connect: connector "${xConnectorId}" not found in wagmi config`,
            wagmiConfigRef.current.connectors.map(c => c.id),
          );
          return undefined;
        }
        // Clear flag before awaiting — flips re-fire EvmHydrator's effects, surfacing
        // any pre-existing wagmi connection (ghost auto-reconnect).
        useXWalletStore.getState().clearUserDisconnected('EVM');
        try {
          await connectRef.current({ connector });
        } catch (error) {
          if (error instanceof Error && error.name === 'ConnectorAlreadyConnectedError') {
            return undefined;
          }
          throw error;
        }
        return undefined;
      },
      disconnect: async () => {
        // Clear zustand + flag synchronously so UI is consistent regardless of whether
        // wagmi.disconnect() throws (Hana 4200), hangs (WC relay), or succeeds.
        const store = useXWalletStore.getState();
        store.unsetXConnection('EVM');
        store.markUserDisconnected('EVM');
        try {
          await disconnectRef.current();
        } catch (error) {
          console.warn('[EvmActions] wagmi disconnect failed (zustand already cleared):', error);
        }
      },
      getConnectors: () => useXWalletStore.getState().xConnectorsByChain.EVM ?? [],
      getConnection: () => useXWalletStore.getState().xConnections.EVM,
      signMessage: async (message: string) => {
        const signature = await signMessageRef.current({ message });
        return signature;
      },
    });
  }, [registerChainActions]);

  return null;
};
