import { useEffect, useMemo, useRef } from 'react';
import {
  type ConnectedWallet,
  type LinkedAccountWithMetadata,
  useCreateWallet,
  useLogin,
  usePrivy,
  useWallets,
} from '@privy-io/react-auth';
import type { EmbeddedWallet, PrivyRuntime } from './runtime.js';

/** The only place Privy hooks run: mirrors Privy state into the runtime the connector reads. */
export function PrivyBridge({ runtime }: { runtime: PrivyRuntime }) {
  const { ready, authenticated, user, error, logout, isModalOpen } = usePrivy();
  // Not `useWallets().ready`: it also waits on external-wallet connectors, which this config turns off.
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  // Stable callbacks: Privy re-registers them when the object identity changes.
  const callbacks = useMemo(
    () => ({
      onComplete: () => runtime.loginCompleted(),
      onError: (code: string) => runtime.loginFailed(code),
    }),
    [runtime],
  );
  const { login } = useLogin(callbacks);

  // Privy's hook handles are not stable; the runtime gets one ops object that reads the latest.
  const latest = useRef({ login, logout, createWallet });
  useEffect(() => {
    latest.current = { login, logout, createWallet };
  });

  useEffect(() => {
    runtime.attach({
      login: () => latest.current.login(),
      logout: () => latest.current.logout(),
      createWallet: () => latest.current.createWallet(),
    });
    return () => runtime.unmount();
  }, [runtime]);

  const wallet = pickEmbeddedWallet(wallets);
  const embedded = useMemo(() => (wallet ? toEmbeddedWallet(wallet) : undefined), [wallet]);
  const hasEmbeddedAccount = user?.linkedAccounts.some(isEmbeddedEthereumAccount) ?? false;
  const userLoaded = user !== null;

  useEffect(() => {
    runtime.publish({ ready, authenticated, error, userLoaded, hasEmbeddedAccount, embedded, modalOpen: isModalOpen });
  }, [runtime, ready, authenticated, error, userLoaded, hasEmbeddedAccount, embedded, isModalOpen]);

  return null;
}

// Deterministic: the user's first HD wallet, not whichever one Privy lists first.
function pickEmbeddedWallet(wallets: ConnectedWallet[]): ConnectedWallet | undefined {
  const embedded = wallets.filter(wallet => wallet.walletClientType === 'privy');
  return embedded.find(wallet => wallet.walletIndex === 0) ?? embedded[0];
}

function toEmbeddedWallet(wallet: ConnectedWallet): EmbeddedWallet {
  return {
    address: wallet.address,
    getEthereumProvider: () => wallet.getEthereumProvider(),
    switchChain: chainId => wallet.switchChain(chainId),
  };
}

function isEmbeddedEthereumAccount(account: LinkedAccountWithMetadata): boolean {
  return account.type === 'wallet' && account.walletClientType === 'privy' && account.chainType === 'ethereum';
}
