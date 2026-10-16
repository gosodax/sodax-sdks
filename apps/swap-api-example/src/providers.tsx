import { ChainKeys } from '@sodax/types';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';

const queryClient = new QueryClient();

/** Connect every chain family the wallet SDK supports, mirroring wallet-modal-example. Public RPCs
 *  are fine for a demo; override via env in a real app. */
export default function Providers({ children }: { children: ReactNode }) {
  const walletConfig = useMemo((): SodaxWalletConfig => {
    const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
    return {
      EVM: {
        ssr: true,
        reconnectOnMount: true,
        walletConnect: wcProjectId ? { projectId: wcProjectId } : undefined,
        chains: {
          [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
          [ChainKeys.AVALANCHE_MAINNET]: { rpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com' },
          [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
          [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc.drpc.org' },
          [ChainKeys.OPTIMISM_MAINNET]: { rpcUrl: 'https://optimism-rpc.publicnode.com' },
          [ChainKeys.POLYGON_MAINNET]: { rpcUrl: 'https://polygon-bor-rpc.publicnode.com' },
          [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://ethereum-rpc.publicnode.com' },
          [ChainKeys.HYPEREVM_MAINNET]: { rpcUrl: 'https://rpc.hyperliquid.xyz/evm' },
          [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arbitrum-one-rpc.publicnode.com' },
        },
      },
      SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://solana-rpc.publicnode.com' } } },
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
            sorobanRpcUrl: 'https://rpc.ankr.com/stellar_soroban',
          },
        },
      },
      ICON: {},
      INJECTIVE: {},
      NEAR: { chains: { [ChainKeys.NEAR_MAINNET]: { rpcUrl: 'https://free.rpc.fastnear.com' } } },
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>
    </QueryClientProvider>
  );
}
