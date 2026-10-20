import type { GetWalletProviderType, SpokeChainKey } from '@sodax/dapp-kit';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { useAppStore } from '@/zustand/useAppStore';

export type ChainWallet = {
  address: string | undefined;
  isConnected: boolean;
  /** Pass as `walletProvider` to SDK calls / dapp-kit mutations for `chainKey`. */
  walletProvider: GetWalletProviderType<SpokeChainKey> | undefined;
  /** Connected, but an EVM wallet sits on a different network than `chainKey`. */
  isWrongChain: boolean;
  switchChain: () => void;
  connect: () => void;
};

/** The wallet that signs on `chainKey`, whatever its chain family. */
export function useChainWallet(chainKey: SpokeChainKey): ChainWallet {
  const { address } = useXAccount({ xChainId: chainKey });
  const walletProvider = useWalletProvider({ xChainId: chainKey });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: chainKey });
  const connect = useAppStore(state => state.openWalletModal);
  return {
    address,
    isConnected: !!address,
    walletProvider,
    isWrongChain: !!address && isWrongChain,
    switchChain: handleSwitchChain,
    connect,
  };
}
