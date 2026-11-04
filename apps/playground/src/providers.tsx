import { ChainKeys, SodaxProvider, type SodaxOptions, createSodaxQueryClient } from '@sodax/dapp-kit';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { solanaRpcUrl, swapsApiKey, walletConnectProjectId } from './config';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';

const queryClient = createSodaxQueryClient();

const sodaxConfig: SodaxOptions = {
  ...(swapsApiKey ? { apiKey: swapsApiKey } : {}),
  chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: solanaRpcUrl } },
};

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: true,
    reconnectOnMount: false,
    ...(walletConnectProjectId ? { walletConnect: { projectId: walletConnectProjectId } } : {}),
  },
  SOLANA: {
    autoConnect: false,
    chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: solanaRpcUrl } },
  },
  SUI: { autoConnect: false },
  // The remaining families use SDK defaults; Bitcoin execution is not mounted.
  STELLAR: {},
  NEAR: {},
  STACKS: {},
  INJECTIVE: {},
};

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
