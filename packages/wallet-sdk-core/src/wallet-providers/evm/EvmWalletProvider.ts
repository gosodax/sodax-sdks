import {
  ChainKeys,
  type EvmChainKey,
  type EvmRawTransaction,
  type EvmRawTransactionReceipt,
  type IEvmWalletProvider,
} from '@sodax/types';
import type {
  Account,
  Address,
  Chain,
  Hash,
  Hex,
  PublicClient,
  TransactionReceipt,
  Transport,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionEvmWalletConfig,
  EvmSendTransactionPolicy,
  EvmWaitForTransactionReceiptPolicy,
  EvmWalletConfig,
  EvmWalletDefaults,
  PrivateKeyEvmWalletConfig,
} from './types.js';
import {
  sonic,
  avalanche,
  arbitrum,
  base,
  optimism,
  bsc,
  polygon,
  mainnet,
  redbellyMainnet,
  kaia,
  lightlinkPhoenix,
  hedera,
} from 'viem/chains';

/**
 * Manually defined viem chain config for HyperEVM.
 *
 * HyperEVM is absent from the `viem/chains` package, so the chain is defined
 * here using `defineChain` with the canonical RPC, block-explorer, and Multicall3
 * contract address.
 */
export const hyper = /*#__PURE__*/ defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { decimals: 18, name: 'HYPE', symbol: 'HYPE' },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io/' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 13051 } },
});

/** Monad mainnet — absent from the pinned `viem/chains`, which only carries its testnet. */
export const monad = /*#__PURE__*/ defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { decimals: 18, name: 'Monad', symbol: 'MON' },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://monadscan.com/' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

/**
 * Returns the viem `Chain` config for the given EVM chain key.
 *
 * @param key - An `EvmChainKey` constant (e.g. `ChainKeys.SONIC_MAINNET`).
 * @returns The corresponding viem chain object.
 * @throws {Error} If `key` is not a recognised EVM chain key.
 */
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
    case ChainKeys.MONAD_MAINNET:
      return monad;
    default: {
      const exhaustiveCheck: never = key; // The never type is used to ensure that the default case is exhaustive
      console.log(exhaustiveCheck);
      throw new Error(`Unsupported EVM chain key: ${key}`);
    }
  }
}

/** Returns `true` when `config` carries a hex private key (server-side / script usage). */
export function isPrivateKeyEvmWalletConfig(config: EvmWalletConfig): config is PrivateKeyEvmWalletConfig {
  return 'privateKey' in config && config.privateKey.startsWith('0x');
}

/** Returns `true` when `config` carries pre-built viem wallet and public clients (browser extension / dApp usage). */
export function isBrowserExtensionEvmWalletConfig(config: EvmWalletConfig): config is BrowserExtensionEvmWalletConfig {
  return 'walletClient' in config && 'publicClient' in config;
}

/**
 * EVM wallet provider backed by [viem](https://viem.sh).
 *
 * Supports two modes selected by config shape:
 * - **Private-key** (`PrivateKeyEvmWalletConfig`): creates its own viem wallet and public
 *   clients from the supplied private key, chain ID, and optional RPC URL. Intended for
 *   Node scripts and server-side testing.
 * - **Browser-extension** (`BrowserExtensionEvmWalletConfig`): accepts pre-built viem clients
 *   injected by the dApp's wallet adapter (e.g. wagmi). Transport/client defaults are ignored
 *   in this mode.
 *
 * All 13 supported EVM chains are covered via {@link getEvmViemChain}; HyperEVM is defined
 * locally as {@link hyper} because it is absent from `viem/chains`.
 */
export class EvmWalletProvider extends BaseWalletProvider<EvmWalletDefaults> implements IEvmWalletProvider {
  public readonly chainType = 'EVM' as const;
  public readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient<Transport, Chain, Account>;

  constructor(config: EvmWalletConfig) {
    super(config.defaults);

    if (isPrivateKeyEvmWalletConfig(config)) {
      const chain = getEvmViemChain(config.chainId);
      const transport = http(config.rpcUrl ?? chain.rpcUrls.default.http[0], this.defaults.transport);
      this.walletClient = createWalletClient({
        chain,
        transport,
        account: privateKeyToAccount(config.privateKey),
        ...this.defaults.walletClient,
      });
      this.publicClient = createPublicClient({ chain, transport, ...this.defaults.publicClient });
      return;
    }

    if (isBrowserExtensionEvmWalletConfig(config)) {
      this.walletClient = config.walletClient;
      this.publicClient = config.publicClient;
      if (this.defaults.transport || this.defaults.publicClient || this.defaults.walletClient) {
        console.warn(
          '[EvmWalletProvider] defaults.{transport,publicClient,walletClient} ignored in browser-extension mode.',
        );
      }
      return;
    }

    throw new Error('Invalid EVM wallet config');
  }

  async getWalletAddress(): Promise<Address> {
    return this.walletClient.account.address;
  }

  /** Submits a signed transaction to the network and returns the transaction hash. */
  async sendTransaction(txData: EvmRawTransaction, options?: EvmSendTransactionPolicy): Promise<Hash> {
    const policy = this.mergePolicy('sendTransaction', options);
    const tx = { ...policy, ...txData } as Parameters<typeof this.walletClient.sendTransaction>[0];
    return this.walletClient.sendTransaction(tx);
  }

  /** EIP-191 `personal_sign` over the raw bytes of `hash`, for withdraw-auth on MPC-relay EVM spokes. */
  async signMessage(hash: Hex): Promise<Hex> {
    return this.walletClient.signMessage({ account: this.walletClient.account, message: { raw: hash } });
  }

  /**
   * Polls until the transaction is included in a block and returns the serialised receipt.
   * All `bigint` fields are converted to strings to allow safe JSON serialisation.
   */
  async waitForTransactionReceipt(
    txHash: Hash,
    options?: EvmWaitForTransactionReceiptPolicy,
  ): Promise<EvmRawTransactionReceipt> {
    const policy = this.mergePolicy('waitForTransactionReceipt', options);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash, ...policy });
    return EvmWalletProvider.serializeReceipt(receipt);
  }

  private static serializeReceipt(receipt: TransactionReceipt): EvmRawTransactionReceipt {
    return {
      ...receipt,
      transactionIndex: receipt.transactionIndex.toString(),
      blockNumber: receipt.blockNumber.toString(),
      cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
      gasUsed: receipt.gasUsed.toString(),
      contractAddress: receipt.contractAddress?.toString() ?? null,
      logs: receipt.logs.map(log => ({
        ...log,
        blockNumber: log.blockNumber.toString() as `0x${string}`,
        logIndex: log.logIndex.toString() as `0x${string}`,
        transactionIndex: log.transactionIndex.toString() as `0x${string}`,
      })),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    };
  }
}
