import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/types';

const queryClient = new QueryClient();

const walletConfig: SodaxWalletConfig = {
  EVM: {
    ssr: false,
    reconnectOnMount: true,
    chains: {
      [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
      [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com' },
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arbitrum.drpc.org' },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc.drpc.org' },
      [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: 'https://optimism-rpc.publicnode.com' },
      [ChainKeys.POLYGON_MAINNET]: { rpcUrl: 'https://polygon-bor-rpc.publicnode.com' },
      [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
      [ChainKeys.HYPEREVM_MAINNET]: { rpcUrl: 'https://rpc.hyperliquid.xyz/evm' },
    },
  },
  SOLANA: {
    chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://solana-rpc.publicnode.com' } },
  },
  SUI: {},
  BITCOIN: {
    chains: {
      [ChainKeys.BITCOIN_MAINNET]: {
        rpcUrl: 'https://mempool.space/api',
      },
    },
  },
  STELLAR: {
    chains: {
      [ChainKeys.STELLAR_MAINNET]: {
        horizonRpcUrl: 'https://horizon.stellar.org',
        sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
      },
    },
  },
  ICON: {},
  INJECTIVE: {},
  NEAR: {},
  STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
};

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
