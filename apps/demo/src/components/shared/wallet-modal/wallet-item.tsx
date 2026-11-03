import { XIcon, Loader2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { ChainType } from '@sodax/dapp-kit';
import { useXAccount, useXConnect, useXConnection, useXConnectors, useXDisconnect } from '@sodax/wallet-sdk-react';
import type { IXConnector } from '@sodax/wallet-sdk-react';
import { Button } from '@/components/ui/button';

export type WalletItemProps = {
  name: string;
  xChainType: ChainType;
  /**
   * Optional callback to close the wallet modal after successful connection.
   * Used to auto-close the modal when a wallet is connected.
   */
  onConnectionSuccess?: () => void;
};

export function shortenAddress(address: string, chars = 7): string {
  return `${address.substring(0, chars + 2)}...${address.substring(address.length - chars)}`;
}

const INSTALL_RECHECK_MS = 1_000;
const INSTALL_RECHECK_FOR_MS = 10_000;

const installedIds = (xConnectors: IXConnector[]): string =>
  xConnectors
    .filter(connector => connector.isInstalled)
    .map(connector => connector.id)
    .join(',');

const WalletItem = ({ name, xChainType, onConnectionSuccess }: WalletItemProps) => {
  const xConnection = useXConnection({ xChainType });
  const { address } = useXAccount({ xChainType });

  const [connectingXConnector, setConnectingXConnector] = useState<IXConnector | null>(null);
  const [wasConnecting, setWasConnecting] = useState(false);

  const xConnectors = useXConnectors({ xChainType });
  const { mutateAsync: xConnect, isPending } = useXConnect();
  const xDisconnect = useXDisconnect();

  const handleConnect = useCallback(
    async (xConnector: IXConnector) => {
      setConnectingXConnector(xConnector);
      setWasConnecting(true);
      try {
        await xConnect(xConnector);
        // Address will be updated via useXAccount hook, useEffect will handle closing
      } catch (error) {
        // Closing a wallet's own dialog (Privy, WalletConnect) rejects the connect; that is not an error.
        if (!(error instanceof Error && error.name === 'UserRejectedRequestError')) console.error(error);
        setWasConnecting(false);
      } finally {
        setConnectingXConnector(null);
      }
    },
    [xConnect],
  );

  // Auto-close modal when address becomes available after a connection attempt
  // This provides smooth UX: user connects wallet → modal closes automatically → user returns to borrow modal
  useEffect(() => {
    if (wasConnecting && address && onConnectionSuccess) {
      setWasConnecting(false);
      // Small delay to allow UI to update and show connected state
      const timeoutId = setTimeout(() => {
        onConnectionSuccess();
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [address, wasConnecting, onConnectionSuccess]);

  const handleDisconnect = useCallback(() => {
    setConnectingXConnector(null);
    xDisconnect({ xChainType });
  }, [xDisconnect, xChainType]);

  ///////////////////////////////////////////////////////////////////////////////////////////
  const activeXConnector = useMemo(() => {
    return xConnectors.find(connector => connector.id === xConnection?.xConnectorId);
  }, [xConnectors, xConnection]);

  // Some connectors probe window with no event when an extension injects, so re-check for a while after the sheet opens.
  // The state holds the installed ids, so a tick re-renders only when that set changes.
  const [, setInstalledIds] = useState(() => installedIds(xConnectors));
  useEffect(() => {
    const timer = setInterval(() => setInstalledIds(installedIds(xConnectors)), INSTALL_RECHECK_MS);
    const stop = setTimeout(() => clearInterval(timer), INSTALL_RECHECK_FOR_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [xConnectors]);

  // Not memoized: isInstalled probes window on each read, so a late-injected extension appears on the next render.
  const installedXConnectors = xConnectors.filter(connector => connector.isInstalled);
  const hanaWallet = installedXConnectors.find(connector => connector.name === 'Hana Wallet');
  const others = installedXConnectors.filter(connector => connector.name !== 'Hana Wallet');
  const sortedXConnectors = hanaWallet ? [hanaWallet, ...others] : installedXConnectors;

  return (
    <div className="flex items-center gap-3 sm:gap-6 text-[#0d0229]">
      <div className="w-[76px] text-right text-black text-xs font-bold leading-none">{name}</div>

      <div className="flex flex-wrap justify-start gap-2 grow">
        {address ? (
          <div className="flex justify-between items-center w-full">
            <div className="cursor-pointer w-10 h-10 p-1 bg-white rounded-[11px] justify-center items-center inline-flex">
              <img src={activeXConnector?.icon} className="w-full h-full rounded-lg" />
            </div>
            <div className="flex gap-1 lowercase">
              {/* <CopyableAddress account={address} /> */}
              <span>{shortenAddress(address, 4)}</span>
              <div className="text-body cursor-pointer" onClick={handleDisconnect}>
                <XIcon />
              </div>
            </div>
          </div>
        ) : (
          <>
            {sortedXConnectors.length === 0 && (
              <span className="text-xs text-muted-foreground">No wallet detected</span>
            )}
            {sortedXConnectors.map(xConnector => {
              return (
                <Button
                  key={`${xChainType}-${xConnector.name}`}
                  className="cursor-pointer w-10 h-10 p-1 bg-[#d4c5f9] rounded-[11px] justify-center items-center inline-flex"
                  onClick={() => handleConnect(xConnector)}
                  disabled={isPending && connectingXConnector?.id === xConnector.id}
                >
                  {isPending && connectingXConnector?.id === xConnector.id && <Loader2 className="animate-spin" />}
                  {!(isPending && connectingXConnector?.id === xConnector.id) && (
                    <img src={xConnector.icon} className="w-full h-full rounded-lg" />
                  )}
                </Button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};

export default WalletItem;
