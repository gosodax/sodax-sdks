import {
  ChainKeys,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmChainKey,
  type EvmRawTransaction,
  type EvmRawTransactionReceipt,
  type EvmSendBatchOptions,
  type EvmSendTransactionOptions,
  type IEvmWalletProvider,
} from '@sodax/types';
import type {
  Account,
  Address,
  Chain,
  GetCapabilitiesReturnType,
  Hash,
  PublicClient,
  TransactionReceipt,
  Transport,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, defineChain, WaitForCallsStatusTimeoutError } from 'viem';
import { BaseWalletProvider } from '../BaseWalletProvider.js';
import type {
  BrowserExtensionEvmWalletConfig,
  EvmSendTransactionPolicy,
  EvmWaitForCallsStatusPolicy,
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
/** Status reads one {@link EvmWalletProvider.waitForBatch} makes before a read error ends the wait. */
const BATCH_STATUS_ATTEMPTS = 3;

export const hyper = /*#__PURE__*/ defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { decimals: 18, name: 'HYPE', symbol: 'HYPE' },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
  blockExplorers: { default: { name: 'HyperEVMScan', url: 'https://hyperevmscan.io/' } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 13051 } },
});

/**
 * Manually defined viem chain config for Robinhood Chain (not yet in `viem/chains`).
 */
export const robinhoodChain = /*#__PURE__*/ defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
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
    case ChainKeys.ROBINHOOD_MAINNET:
      return robinhoodChain;
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
 * All 14 supported EVM chains are covered via {@link getEvmViemChain}; HyperEVM and
 * Robinhood Chain are defined locally ({@link hyper}, {@link robinhoodChain}) because they
 * are absent from `viem/chains`.
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
  async sendTransaction(
    txData: EvmRawTransaction,
    options?: EvmSendTransactionPolicy & EvmSendTransactionOptions,
  ): Promise<Hash> {
    const { expectedChainId, ...policyOverrides } = options ?? {};
    if (expectedChainId !== undefined) {
      await this.assertActiveChain(expectedChainId);
    }
    const policy = this.mergePolicy('sendTransaction', policyOverrides);
    const tx = { ...policy, ...txData } as Parameters<typeof this.walletClient.sendTransaction>[0];
    return this.walletClient.sendTransaction(tx);
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

  /**
   * EIP-5792 `atomic` capability of the connected wallet on `chainId`. A private-key account has no
   * wallet to batch for it, so it is always `'unsupported'`. RPC errors propagate to the caller.
   */
  async getAtomicBatchSupport(chainId: number): Promise<EvmAtomicBatchSupport> {
    if (!this.hasWalletAccount()) return 'unsupported';
    // viem types the per-chain entry as present, but a wallet omits the chains it cannot serve.
    const capabilities: GetCapabilitiesReturnType<number> | undefined = await this.walletClient.getCapabilities({
      chainId,
    });
    const status = capabilities?.atomic?.status;
    return status === 'supported' || status === 'ready' ? status : 'unsupported';
  }

  /**
   * Sends `txs` as one EIP-5792 batch the wallet must execute atomically and in order. Resolves to
   * the wallet's batch id; read the transaction hash from {@link waitForBatch}.
   */
  async sendAtomicBatch(txs: readonly EvmRawTransaction[], options: EvmSendBatchOptions): Promise<string> {
    if (!this.hasWalletAccount()) {
      throw new Error(
        '[EvmWalletProvider] atomic batches need a connected wallet; a private-key account cannot send them',
      );
    }
    await this.assertActiveChain(options.expectedChainId);
    // Unlike sendTransaction, viem's sendCalls takes the batch's chainId from the client without checking it.
    if (this.walletClient.chain.id !== options.expectedChainId) {
      throw new Error(
        `[EvmWalletProvider] wallet client is bound to chain ${this.walletClient.chain.id} but the batch targets chain ${options.expectedChainId}; rebuild the client for that chain`,
      );
    }
    const { id } = await this.walletClient.sendCalls({
      calls: txs.map(({ to, value, data }) => ({ to, value, data })),
      forceAtomic: true,
    });
    return id;
  }

  /**
   * Polls until the batch reaches a terminal EIP-5792 status and returns its receipts. Throws on timeout.
   * A failed status read is retried within the timeout, up to {@link BATCH_STATUS_ATTEMPTS} reads in all:
   * viem's own wait ends on the first one, which would report a batch that is still landing as lost.
   */
  async waitForBatch(batchId: string, options?: EvmWaitForCallsStatusPolicy): Promise<EvmBatchResult> {
    const { timeout, ...policy } = this.mergePolicy('waitForCallsStatus', options);
    // viem reads a zero timeout as "no timeout"; give up at once instead.
    const budget = timeout === undefined ? undefined : Math.max(1, timeout);
    const deadline = budget === undefined ? undefined : Date.now() + budget;
    const retryDelay = policy.pollingInterval ?? this.walletClient.pollingInterval;
    let remaining = budget;
    let result: Awaited<ReturnType<WalletClient['waitForCallsStatus']>>;
    for (let attempt = 1; ; attempt++) {
      try {
        result = await this.walletClient.waitForCallsStatus({ ...policy, timeout: remaining, id: batchId });
        break;
      } catch (error) {
        const timeLeft = deadline === undefined ? retryDelay : deadline - Date.now() - retryDelay;
        if (error instanceof WaitForCallsStatusTimeoutError || attempt >= BATCH_STATUS_ATTEMPTS || timeLeft <= 0) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        remaining = deadline === undefined ? undefined : Math.max(1, deadline - Date.now());
      }
    }
    return {
      status: result.status === 'success' ? 'success' : 'failure',
      statusCode: result.statusCode,
      atomic: result.atomic,
      receipts: (result.receipts ?? []).map(receipt => ({
        transactionHash: receipt.transactionHash,
        status: receipt.status,
      })),
    };
  }

  private hasWalletAccount(): boolean {
    return this.walletClient.account.type === 'json-rpc';
  }

  private async assertActiveChain(expectedChainId: number): Promise<void> {
    // The wallet broadcasts on its ACTUAL active chain, not the chain the calldata targets.
    const actualChainId = await this.walletClient.getChainId();
    if (actualChainId !== expectedChainId) {
      throw new Error(
        `[EvmWalletProvider] wallet is connected to chain ${actualChainId} but the transaction targets chain ${expectedChainId}; switch the wallet network and retry`,
      );
    }
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
