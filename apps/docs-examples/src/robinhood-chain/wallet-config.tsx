// #region wallet-config
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const config: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.ROBINHOOD_MAINNET]: { rpcUrl: 'https://rpc.mainnet.chain.robinhood.com' }, // rate-limited: use a provider endpoint in production
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://rpc.soniclabs.com' },
    },
  },
};
// #endregion wallet-config

export const App = ({ children }: { children: React.ReactNode }) => (
  <SodaxWalletProvider config={config}>{children}</SodaxWalletProvider>
);
