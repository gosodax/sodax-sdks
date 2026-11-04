'use client';

/**
 * Email login with Privy — adds "Email (Privy)" (connector id `privy`) to the EVM wallet list.
 * The user types an email, enters Privy's one-time code and gets an embedded EVM wallet that signs
 * like any other wallet.
 *
 * Before running:
 * - `pnpm add @privy-io/react-auth` (3.40 or newer) — an optional peer of `@sodax/wallet-sdk-react`.
 * - Create an app at https://dashboard.privy.io: enable Email login and Ethereum embedded wallets,
 *   and allow this origin (`http://localhost:<port>` plus every deployed and preview URL).
 *
 * Next.js App Router: keep this whole file client-side (`'use client'` above). React refuses to pass
 * `privy()`'s value from a Server Component.
 *
 * For Privy-only data (the user's email, key export) use Privy's own hooks such as `usePrivy()`
 * below `SodaxWalletProvider` — see `../recipes/privy-email-login.md`.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SodaxWalletProvider,
  type SodaxWalletConfig,
  useWalletModal,
  useXAccount,
  useXConnection,
  useXConnectors,
  useXDisconnect,
  useXSignMessage,
} from '@sodax/wallet-sdk-react';
import { PRIVY_CONNECTOR_ID, privy } from '@sodax/wallet-sdk-react/privy';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://mainnet.base.org' },
    },
    // The App ID is public. An unset env var only warns and leaves "Email (Privy)" out; privy() never throws.
    privy: privy({ appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '' }),
  },
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>
        <EmailLogin />
      </SodaxWalletProvider>
    </QueryClientProvider>
  );
}

function EmailLogin() {
  const modal = useWalletModal();
  const connectors = useXConnectors({ xChainType: 'EVM' });
  const account = useXAccount({ xChainType: 'EVM' });
  const connection = useXConnection({ xChainType: 'EVM' });
  const disconnect = useXDisconnect();

  const privyConnector = connectors.find(c => c.id === PRIVY_CONNECTOR_ID);

  // Privy's own login dialog owns the screen while it is connecting
  if (modal.state.kind === 'connecting' && modal.state.connector.id === PRIVY_CONNECTOR_ID) {
    return null;
  }

  if (account.address) {
    return (
      <div>
        <code>{account.address}</code>
        {connection?.xConnectorId === PRIVY_CONNECTOR_ID && <span> (email wallet)</span>}
        <button type="button" onClick={() => disconnect({ xChainType: 'EVM' })}>
          Disconnect
        </button>
        <SignInDialog />
      </div>
    );
  }

  if (!privyConnector) {
    return <p>Email login not configured — set NEXT_PUBLIC_PRIVY_APP_ID</p>;
  }

  return (
    <div>
      <button type="button" onClick={() => modal.selectWallet(privyConnector)}>
        Log in with email
      </button>
      {/* Closing Privy's dialog lands here with a user-rejection error */}
      {modal.state.kind === 'error' && <p>Login failed: {modal.state.error.message}</p>}
    </div>
  );
}

/** A dialog of your own that signs while open: Privy's confirmation screen appears on top of it. */
function SignInDialog() {
  const [open, setOpen] = useState(false);
  const signMessage = useXSignMessage();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Sign in to the app
      </button>
    );
  }

  return (
    <OutsideClickDialog onClose={() => setOpen(false)}>
      <p>Sign a message to prove you own this wallet.</p>
      <button
        type="button"
        disabled={signMessage.isPending}
        onClick={() => signMessage.mutate({ xChainType: 'EVM', message: 'Sign in to my SODAX app' })}
      >
        Sign
      </button>
      {signMessage.data && <code>{String(signMessage.data)}</code>}
    </OutsideClickDialog>
  );
}

/** True for events inside Privy's screens (login, confirmations, MFA), which render outside your components. */
function isInPrivyDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('#privy-dialog') !== null;
}

/**
 * Closes on a click outside itself — except a click on Privy's screens, which would otherwise close it
 * mid-signature. Radix / shadcn equivalent on `DialogContent` or `SheetContent`:
 * `onInteractOutside={event => { if (isInPrivyDialog(event.target)) event.preventDefault(); }}`
 */
function OutsideClickDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || ref.current?.contains(target) || isInPrivyDialog(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-modal="true">
      {children}
    </div>
  );
}
