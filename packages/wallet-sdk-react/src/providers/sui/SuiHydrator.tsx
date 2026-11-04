import { useEffect, useMemo, useRef } from 'react';
import {
  getWalletUniqueIdentifier,
  useCurrentAccount,
  useCurrentClient,
  useCurrentWallet,
  useDAppKit,
  useWallets,
} from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import { SuiWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys, type SuiTransaction } from '@sodax/types';
import { SuiXService, SuiXConnector } from '@/xchains/sui/index.js';
import { useXWalletStore } from '@/useXWalletStore.js';
import { useWalletConfig } from '@/context/WalletConfigContext.js';
import { getEntryDefaults } from '@/utils/walletRpcConfig.js';

type SuiHydratorProps = {
  /** Resolved by SuiProvider so the endpoint is decided in exactly one place. */
  grpcUrl: string;
};

/**
 * Hydrates SUI state from @mysten/dapp-kit-react hooks into SuiXService singleton and store.
 */
export const SuiHydrator = ({ grpcUrl }: SuiHydratorProps): null => {
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const currentWallet = useCurrentWallet();
  const suiAccount = useCurrentAccount();
  const suiWallets = useWallets();
  const setXConnection = useXWalletStore(state => state.setXConnection);
  const unsetXConnection = useXWalletStore(state => state.unsetXConnection);
  const setWalletProvider = useXWalletStore(state => state.setWalletProvider);
  const walletConfig = useWalletConfig();
  const suiDefaults = getEntryDefaults<typeof ChainKeys.SUI_MAINNET>(walletConfig.SUI?.chains?.[ChainKeys.SUI_MAINNET]);

  // Sync dapp-kit values into the SuiXService singleton in a single effect.
  // The singleton is read by SuiXService balance methods.
  useEffect(() => {
    const service = SuiXService.getInstance();
    if (suiClient) service.suiClient = suiClient;
    if (currentWallet) service.suiWallet = currentWallet;
    if (suiAccount) service.suiAccount = suiAccount;
  }, [suiClient, currentWallet, suiAccount]);

  // Memoize the connector list — useWallets returns a new array reference even when the
  // underlying wallet set hasn't changed. Without memoization, every render would create
  // new XConnector instances and trigger downstream re-renders.
  const suiConnectors = useMemo(() => suiWallets.map(wallet => new SuiXConnector(wallet)), [suiWallets]);
  useEffect(() => {
    SuiXService.getInstance().setXConnectors(suiConnectors);
    useXWalletStore.getState().setXConnectors('SUI', suiConnectors);
  }, [suiConnectors]);

  const wasConnectedRef = useRef(!!useXWalletStore.getState().xConnections.SUI);
  useEffect(() => {
    if (currentWallet && suiAccount?.address) {
      wasConnectedRef.current = true;
      setXConnection('SUI', {
        xAccount: { address: suiAccount.address, xChainType: 'SUI' },
        xConnectorId: getWalletUniqueIdentifier(currentWallet),
      });
    } else if (wasConnectedRef.current) {
      wasConnectedRef.current = false;
      unsetXConnection('SUI');
    }
  }, [currentWallet, suiAccount, setXConnection, unsetXConnection]);

  // Create wallet provider directly from hook values (not singleton) — useMemo runs during
  // render, before the useEffect that syncs values into the singleton. Reading from the
  // singleton here would use stale fields from the previous render.
  const walletProvider = useMemo(() => {
    if (!suiAccount) return undefined;
    return new SuiWalletProvider({
      grpcUrl,
      address: suiAccount.address,
      // Shape adapter only: dApp Kit's signer is options-shaped, ours is positional. The
      // provider has already built the transaction against its client by this point, and
      // `account` is named so the wallet cannot sign with a different connected account.
      signTransaction: async (txn: SuiTransaction) =>
        dAppKit.signTransaction({ transaction: Transaction.from(await txn.toJSON()), account: suiAccount }),
      defaults: suiDefaults,
    });
  }, [dAppKit, grpcUrl, suiAccount, suiDefaults]);

  useEffect(() => {
    setWalletProvider('SUI', walletProvider);
  }, [walletProvider, setWalletProvider]);

  return null;
};
