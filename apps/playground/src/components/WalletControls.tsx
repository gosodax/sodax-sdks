import type { Execution } from '../hooks/useExecution';
import { Modal } from './Modal';

function familyName(type: string): string {
  return type === 'EVM' ? type : type.charAt(0) + type.slice(1).toLowerCase();
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletControls({ execution }: { execution: Execution }) {
  const e = execution;
  const connected = e.connectType === e.sourceType ? e.source : e.destination;
  return (
    <Modal
      title={`Connect ${familyName(e.connectType ?? '')} wallet`}
      open={e.connectType !== undefined}
      onClose={e.closeConnect}
    >
      {connected?.address ? (
        <div className="modal-body">
          <p className="address-text">{connected.address}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (e.connectType) e.disconnect({ xChainType: e.connectType });
              e.closeConnect();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="wallet-list">
          <p className="muted small">Choose a wallet. Connecting does not move funds.</p>
          {e.connectors.length === 0 && (
            <p>
              No compatible wallet detected. Open this widget in your wallet’s browser or install a compatible wallet.
            </p>
          )}
          {e.connectors.map(connector => (
            <button
              type="button"
              className="btn wallet-option"
              key={connector.id}
              disabled={e.connection.status === 'connecting'}
              onClick={() => e.connection.connect(connector)}
            >
              {connector.icon && <img src={connector.icon} alt="" width="28" height="28" />}
              {connector.name}
              {e.connection.activeConnector?.id === connector.id &&
                e.connection.status === 'connecting' &&
                ' — waiting for wallet…'}
            </button>
          ))}
          {e.connection.status === 'error' && (
            <p className="alert" role="alert">
              {e.connection.error?.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function WalletButton({ execution: e, receiving = false }: { execution: Execution; receiving?: boolean }) {
  const account = receiving ? e.destination : e.source;
  const type = receiving ? e.destinationType : e.sourceType;
  if (!e.signable || (!account?.address && (!receiving || !e.source?.address))) return null;
  return (
    <button
      type="button"
      className="btn wallet-inline"
      disabled={!!e.phase || !!e.activity}
      onClick={() => e.openConnect(type)}
      aria-label={
        account?.address
          ? `${receiving ? 'Receiving' : 'Sending'} wallet ${account.address}`
          : `Connect ${familyName(type)} receiving wallet`
      }
    >
      {/* The side is on the chip now: the captions that used to carry it are gone, and both sides
          report the same address whenever the two chains share a wallet family. */}
      {account?.address
        ? `${receiving ? 'Receiving' : 'Sending'} ${shortAddress(account.address)}`
        : `Connect ${familyName(type)} wallet`}
    </button>
  );
}
