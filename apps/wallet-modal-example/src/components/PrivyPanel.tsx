import { useExportWallet, usePrivy } from '@privy-io/react-auth';
import { useXConnection, useXSignMessage } from '@sodax/wallet-sdk-react';
import { PRIVY_CONNECTOR_ID } from '@sodax/wallet-sdk-react/privy';

// Privy hooks render only while the EVM wallet is the Privy one: if Privy cannot start (e.g. plain http
// on a LAN address), the SDK keeps the app running without PrivyProvider.
export default function PrivyPanel() {
  const connection = useXConnection({ xChainType: 'EVM' });
  if (connection?.xConnectorId !== PRIVY_CONNECTOR_ID) {
    return <p className="text-sm text-gray-600">Open the modal, pick EVM, then "Email (Privy)".</p>;
  }
  return <PrivyAccount address={connection.xAccount.address} />;
}

function PrivyAccount({ address }: { address: string | undefined }) {
  const { user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const signMessage = useXSignMessage();

  return (
    <div className="space-y-3 text-sm">
      <p>
        Signed in as <strong>{user?.email?.address ?? 'unknown'}</strong>
      </p>
      <code className="block break-all rounded bg-gray-100 p-2 text-xs">{address}</code>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => signMessage.mutate({ xChainType: 'EVM', message: 'Hello from SODAX' })}
          className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
        >
          Sign a message
        </button>
        <button type="button" onClick={() => exportWallet()} className="rounded border px-3 py-1.5 hover:bg-gray-50">
          Export private key
        </button>
      </div>
      {signMessage.data && <code className="block break-all text-xs">{String(signMessage.data)}</code>}
      {signMessage.error && <p className="text-red-600">{signMessage.error.message}</p>}
    </div>
  );
}
