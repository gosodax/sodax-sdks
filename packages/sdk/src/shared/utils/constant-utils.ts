import {
  arbitrum,
  avalanche,
  base,
  bsc,
  optimism,
  polygon,
  sonic,
  lightlinkPhoenix,
  mainnet,
  redbellyMainnet,
  kaia,
  hedera,
} from 'viem/chains';
import { type Chain, defineChain } from 'viem';
import { type EvmChainKey, ChainKeys } from '@sodax/types';

// HyperEVM chain is not supported by viem, so we need to define it manually
export const hyper = /*#__PURE__*/ defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: {
    decimals: 18,
    name: 'HYPE',
    symbol: 'HYPE',
  },
  rpcUrls: {
    default: { http: ['https://rpc.hyperliquid.xyz/evm'] },
  },
  blockExplorers: {
    default: {
      name: 'HyperEVMScan',
      url: 'https://hyperevmscan.io/',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      blockCreated: 13051,
    },
  },
});

// Robinhood Chain is not yet in viem's bundled chain list, so define it manually
export const robinhoodChain = /*#__PURE__*/ defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://robinhoodchain.blockscout.com',
    },
  },
});

export function getEvmViemChain(key: EvmChainKey): Chain {
  switch (key) {
    case ChainKeys.SONIC_MAINNET:
      return sonic;
    case ChainKeys.AVALANCHE_MAINNET:
      return avalanche;
    case ChainKeys.ARBITRUM_MAINNET:
      return arbitrum;
    case ChainKeys.BASE_MAINNET:
      return base;
    case ChainKeys.OPTIMISM_MAINNET:
      return optimism;
    case ChainKeys.BSC_MAINNET:
      return bsc;
    case ChainKeys.POLYGON_MAINNET:
      return polygon;
    case ChainKeys.HYPEREVM_MAINNET:
      return hyper;
    case ChainKeys.LIGHTLINK_MAINNET:
      return lightlinkPhoenix;
    case ChainKeys.ETHEREUM_MAINNET:
      return mainnet;
    case ChainKeys.REDBELLY_MAINNET:
      return redbellyMainnet;
    case ChainKeys.KAIA_MAINNET:
      return kaia;
    case ChainKeys.HEDERA_MAINNET:
      return hedera;
    case ChainKeys.ROBINHOOD_MAINNET:
      return robinhoodChain;
    default: {
      const exhaustiveCheck: never = key; // The never type is used to ensure that the default case is exhaustive
      console.log(exhaustiveCheck);
      throw new Error(`Unsupported EVM chain key: ${key}`);
    }
  }
}
