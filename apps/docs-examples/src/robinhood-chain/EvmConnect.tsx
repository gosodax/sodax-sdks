// #region evm-connect
import { useXConnectors, useXConnect, useXAccount } from '@sodax/wallet-sdk-react';

function EvmConnect() {
  const connectors = useXConnectors({ xChainType: 'EVM' }); // MetaMask, Rabby, ...
  const { mutateAsync: connect } = useXConnect();
  const account = useXAccount({ xChainType: 'EVM' });

  if (account.address) return <p>Connected: {account.address}</p>;

  return connectors.map(c => (
    <button key={c.id} type="button" onClick={() => connect(c)}>
      {c.name}
    </button>
  ));
}
// #endregion evm-connect

export { EvmConnect };
