import { XService } from '@/core/XService.js';
import { ChainKeys, type XToken } from '@sodax/types';
import type { EvmTypeConfig } from '@/types/config.js';
import { getRpcUrl, getWagmiChainId, isNativeToken } from '@/utils/index.js';

import { type Address, type Chain, defineChain, erc20Abi } from 'viem';
import { getPublicClient } from 'wagmi/actions';
import {
  type Config,
  type CreateConnectorFn,
  createConfig,
  http,
  createStorage,
  cookieStorage,
  cookieToInitialState,
  type State,
} from 'wagmi';
import {
  mainnet,
  avalanche,
  base,
  optimism,
  polygon,
  arbitrum,
  bsc,
  sonic,
  lightlinkPhoenix,
  redbellyMainnet,
  kaia,
  hedera,
} from 'wagmi/chains';
type WagmiOptions = {
  reconnectOnMount?: boolean;
  ssr?: boolean;
  /**
   * Base key for wagmi's cookie storage (state cookie = `<persistKey>.store`). @default 'sodax'.
   * SSR server and client must build from the same key, else the server reads the wrong cookie.
   */
  persistKey?: string;
};

// Hedera's JSON-RPC relay reports native HBAR in 18-decimal "weibar" via eth_getBalance,
// but HBAR is configured with its canonical 8 decimals. Scale the raw balance down by 10^10
// so it matches token.decimals. Mirrors `scaleNativeMsgValue` in the SDK's EvmSpokeService,
// which scales outgoing msg.value up by the same factor.
const HEDERA_NATIVE_BALANCE_SCALE = 10n ** 10n;

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

// Robinhood Chain is not yet in viem/wagmi's bundled chain list, so define it manually
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

export const createWagmiConfig = (
  evmChains?: EvmTypeConfig['chains'],
  options?: WagmiOptions & { connectors?: CreateConnectorFn[] },
): Config => {
  return createConfig({
    chains: [
      mainnet,
      avalanche,
      arbitrum,
      base,
      bsc,
      sonic,
      optimism,
      polygon,
      hyper,
      lightlinkPhoenix,
      kaia,
      redbellyMainnet,
      hedera,
      robinhoodChain,
    ],
    connectors: options?.connectors ?? [],
    // NOTE: wagmi's `ssr` is a hydration-timing flag, not an "is host app SSR"
    // flag. `true` defers `Hydrate.onMount()` into `useEffect` (safe for both
    // CSR and SSR); `false` runs it in render and trips React's "setState
    // during render" warning on subscribers like `EvmHydrator`. Default to
    // `true` so direct callers of `createWagmiConfig` stay safe — only pass
    // `false` if you have a specific reason. See issue #129.
    ssr: options?.ssr ?? true,
    transports: {
      [mainnet.id]: http(getRpcUrl(evmChains?.[ChainKeys.ETHEREUM_MAINNET])),
      [avalanche.id]: http(getRpcUrl(evmChains?.[ChainKeys.AVALANCHE_MAINNET])),
      [arbitrum.id]: http(getRpcUrl(evmChains?.[ChainKeys.ARBITRUM_MAINNET])),
      [base.id]: http(getRpcUrl(evmChains?.[ChainKeys.BASE_MAINNET])),
      [bsc.id]: http(getRpcUrl(evmChains?.[ChainKeys.BSC_MAINNET])),
      [sonic.id]: http(getRpcUrl(evmChains?.[ChainKeys.SONIC_MAINNET])),
      [optimism.id]: http(getRpcUrl(evmChains?.[ChainKeys.OPTIMISM_MAINNET])),
      [polygon.id]: http(getRpcUrl(evmChains?.[ChainKeys.POLYGON_MAINNET])),
      [hyper.id]: http(getRpcUrl(evmChains?.[ChainKeys.HYPEREVM_MAINNET])),
      [lightlinkPhoenix.id]: http(getRpcUrl(evmChains?.[ChainKeys.LIGHTLINK_MAINNET])),
      [redbellyMainnet.id]: http(getRpcUrl(evmChains?.[ChainKeys.REDBELLY_MAINNET])),
      [kaia.id]: http(getRpcUrl(evmChains?.[ChainKeys.KAIA_MAINNET])),
      [hedera.id]: http(getRpcUrl(evmChains?.[ChainKeys.HEDERA_MAINNET])),
      [robinhoodChain.id]: http(getRpcUrl(evmChains?.[ChainKeys.ROBINHOOD_MAINNET])),
    },
    storage: createStorage({
      storage: cookieStorage,
      key: options?.persistKey ?? 'sodax',
    }),
  });
};

/**
 * Wraps wagmi's `cookieToInitialState` so a malformed cookie returns `undefined` instead of throwing
 * during SSR. NOT validation: a well-formed but attacker-controlled cookie still passes — the live
 * wallet is authoritative once a connection is established. Errors are swallowed (not logged).
 */
export function tryCookieToInitialState(config: Config, cookie: string | null | undefined): State | undefined {
  try {
    return cookieToInitialState(config, cookie ?? undefined);
  } catch {
    return undefined;
  }
}

/**
 * Service class for handling EVM chain interactions.
 * Implements singleton pattern and provides methods for wallet/chain operations.
 */

export class EvmXService extends XService {
  private static instance: EvmXService;
  public wagmiConfig: Config | undefined;

  private constructor() {
    super('EVM');
  }

  public static getInstance(): EvmXService {
    if (!EvmXService.instance) {
      EvmXService.instance = new EvmXService();
    }
    return EvmXService.instance;
  }

  // get erc20 token balance in a chain (evm chain only)
  async _getTokenBalance(address: string | undefined, chainId: number, tokenAddress: string): Promise<bigint> {
    const publicClient = getPublicClient(this.wagmiConfig as Config, { chainId: chainId });
    if (!publicClient) throw new Error('Public client not found');
    const balance = await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress as `0x${string}`,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return balance || 0n;
  }

  //get native balance of the chain (evm chain only)
  async _getChainBalance(address: string | undefined, chainId: number) {
    const balance = await getPublicClient(this.wagmiConfig as Config, { chainId: chainId })?.getBalance({
      address: address as Address,
    });
    return balance || 0n;
  }

  override async getBalance(address: string | undefined, xToken: XToken): Promise<bigint> {
    if (!address) return 0n;
    if (!this.wagmiConfig) return 0n;

    const chainId = getWagmiChainId(xToken.chainKey);

    if (isNativeToken(xToken)) {
      const balance = await this._getChainBalance(address, chainId);
      if (xToken.chainKey === ChainKeys.HEDERA_MAINNET) {
        return balance / HEDERA_NATIVE_BALANCE_SCALE;
      }
      return balance;
    }

    throw new Error(`Unsupported token: ${xToken.symbol}`);
  }

  override async getBalances(address: string | undefined, xTokens: XToken[]) {
    if (!address) return {};
    if (!this.wagmiConfig) return {};

    const nativeTokenBalancePromises = xTokens
      .filter(xToken => isNativeToken(xToken))
      .map(async xToken => {
        const balance = await this.getBalance(address, xToken);
        return { symbol: xToken.symbol, address: xToken.address, balance };
      });

    const nativeTokenBalances = await Promise.all(nativeTokenBalancePromises);
    const tokenMap: Record<string, bigint> = nativeTokenBalances.reduce<Record<string, bigint>>(
      (map, { address, balance }) => {
        if (balance) map[address] = balance;
        return map;
      },
      {},
    );

    const nonNativeXTokens = xTokens.filter(xToken => !isNativeToken(xToken));
    const firstToken = xTokens[0];
    if (!firstToken) return tokenMap;
    const chainKey = firstToken.chainKey;
    const viemChain: Chain = this.wagmiConfig.chains.find(chain => chain.id === getWagmiChainId(chainKey)) as Chain;
    const chainId = getWagmiChainId(chainKey);

    const publicClient = getPublicClient(this.wagmiConfig, { chainId: chainId });
    if (!publicClient) throw new Error('Public client not found');

    if (viemChain?.contracts?.multicall3) {
      //multicall supports
      const result = await publicClient.multicall({
        contracts: nonNativeXTokens.map(token => ({
          abi: erc20Abi,
          address: token.address as `0x${string}`,
          functionName: 'balanceOf',
          args: [address],
        })),
      });

      return nonNativeXTokens.reduce((acc, token, index) => {
        const resultValue = result?.[index]?.result;
        acc[token.address] = resultValue !== undefined && resultValue !== null ? BigInt(resultValue) : 0n;
        return acc;
      }, tokenMap);
    }

    const nonNativeTokenBalances: bigint[] = await Promise.all(
      nonNativeXTokens.map(token => this._getTokenBalance(address, chainId, token.address)),
    );

    return nonNativeXTokens.reduce((acc, token, idx) => {
      acc[token.address] = nonNativeTokenBalances[idx] ?? 0n;
      return acc;
    }, tokenMap);
  }
}
