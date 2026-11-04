import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  http,
  type HttpTransport,
  type PublicClient,
} from 'viem';
import { connectionAbi, erc20Abi, spokeAssetManagerAbi } from '../../abis/index.js';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import type {
  DepositParams,
  GetDepositParams,
  GetBalanceParams,
  GetBalancesParams,
  SendMessageParams,
  EstimateGasParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import { Erc20Service, type Erc20IsAllowanceParams } from '../erc-20/Erc20Service.js';
import type { ConfigService } from '../../config/ConfigService.js';
import {
  ChainKeys,
  type EvmSpokeOnlyChainKey,
  type Result,
  type TxReturnType,
  getIntentRelayChainId,
  isNativeToken,
  type EvmReturnType,
} from '@sodax/types';

/**
 * Scales a native-token amount from the token's canonical decimals to the EVM
 * msg.value decimals for chains where they differ (currently only Hedera).
 *
 * Why: HBAR is tracked as 8 decimals in spoke accounting, but Hedera's EVM
 * layer treats native value as 18 decimals — so msg.value must be multiplied
 * by 10^10 even though the asset-manager `transfer` argument stays in 8.
 */
const HEDERA_NATIVE_VALUE_SCALE = 10n ** 10n;
function scaleNativeMsgValue(chainKey: EvmSpokeOnlyChainKey, amount: bigint): bigint {
  return chainKey === ChainKeys.HEDERA_MAINNET ? amount * HEDERA_NATIVE_VALUE_SCALE : amount;
}

/**
 * Inverse of {@link scaleNativeMsgValue}: scales a native balance read from the EVM layer back
 * to the token's canonical decimals. `eth_getBalance` returns HBAR in 18-decimal "weibar", but
 * HBAR is tracked as 8 decimals, so divide by 10^10 on Hedera.
 */
function scaleNativeBalance(chainKey: EvmSpokeOnlyChainKey, amount: bigint): bigint {
  return chainKey === ChainKeys.HEDERA_MAINNET ? amount / HEDERA_NATIVE_VALUE_SCALE : amount;
}

export type CreateViemPublicClientParams = {
  chainId: EvmSpokeOnlyChainKey;
  rpcUrl?: string;
};

export class EvmSpokeService {
  private readonly config: ConfigService;
  // map containing the public clients for each evm spoke chain, lazy loaded on demand
  private readonly publicClients: Map<EvmSpokeOnlyChainKey, PublicClient<HttpTransport>> = new Map();

  public constructor(config: ConfigService) {
    this.config = config;
  }

  getPublicClient(chainId: EvmSpokeOnlyChainKey): PublicClient<HttpTransport> {
    return (
      this.publicClients.get(chainId) ??
      this.constructPublicClient({ chainId, rpcUrl: this.config.getChainConfig(chainId).rpcUrl })
    );
  }

  public constructPublicClient({ chainId, rpcUrl }: CreateViemPublicClientParams): PublicClient<HttpTransport> {
    const chain = getEvmViemChain(chainId);
    const publicClient = createPublicClient({
      transport: http(rpcUrl ?? chain.rpcUrls.default.http[0]),
      chain,
    });
    this.publicClients.set(chainId, publicClient);
    return publicClient;
  }

  /**
   * Estimates the gas necessary to complete a transaction without submitting it to the network.
   *
   * - Docs: https://viem.sh/docs/actions/public/estimateGas
   * - JSON-RPC Methods: [`eth_estimateGas`](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_estimategas)
   *
   * @param {EstimateGasParams<EvmSpokeOnlyChainKey>} params - The parameters for the gas estimation, including the from, to, value, and data.
   * @returns {Promise<bigint>} Estimated gas for the transaction.
   *
   * @example
   *
   * const rawTx: EvmRawTransaction = {
   *   from: '0x1234...abcd', // sender address
   *   to: '0xabcd...1234',   // recipient address
   *   value: 1000000000000000000n, // 1 ETH in wei
   *   data: '0x', // no calldata
   * };
   *
   * // Assume spokeProvider is an initialized EvmSpokeProvider
   * const estimatedGas = await EvmSpokeService.estimateGas(rawTx, spokeProvider);
   * console.log(`Estimated gas: ${estimatedGas}`);
   */
  public async estimateGas({ tx, chainKey: chainId }: EstimateGasParams<EvmSpokeOnlyChainKey>): Promise<bigint> {
    // Use viem's estimateGas with explicit parameter types
    return this.getPublicClient(chainId).estimateGas({
      account: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    });
  }

  /**
   * Check if spender has enough ERC20 allowance for given amount
   * @param token - ERC20 token address
   * @param amount - Amount to check allowance for
   * @param owner - User wallet address
   * @param spender - Spender address
   * @param chainId - Chain ID
   * @param configService - Config service
   * @return - True if spender is allowed to spend amount on behalf of owner
   */
  public async isAllowanceValid(
    params: Omit<Erc20IsAllowanceParams<EvmSpokeOnlyChainKey>, 'publicClient' | 'nativeToken'>,
  ): Promise<Result<boolean>> {
    try {
      return await Erc20Service.isAllowanceValid({
        ...params,
        publicClient: this.getPublicClient(params.chainKey),
        nativeToken: this.config.getChainConfig(params.chainKey).nativeToken as Address,
      });
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  /**
   * Transfers tokens to the hub chain by depositing into spoke chain asset maanger.
   * @param {DepositParams<EvmSpokeOnlyChainKey, Raw>} params - The parameters for the transfer, including:
   *   - {FromParams<EvmSpokeOnlyChainKey>} fromParams: The parameters for the from chain.
   *   - {Address} token: The original spoke chain address of the token to deposit.
   *   - {Address} to: The recipient address on the hub chain.
   *   - {bigint} amount: The amount to deposit.
   *   - {Hex} [data="0x"]: Additional data for the deposit.
   *   - {boolean} raw: The return type raw or just transaction hash.
   * @returns {Promise<TxReturnType<EvmSpokeOnlyChainKey, Raw>>} A promise that resolves to the transaction hash.
   */
  public async deposit<Raw extends boolean = false>(
    params: DepositParams<EvmSpokeOnlyChainKey, Raw>,
  ): Promise<TxReturnType<EvmSpokeOnlyChainKey, Raw>> {
    const { srcChainKey, srcAddress: from, token, to, amount, data = '0x' } = params;
    const chainConfig = this.config.getChainConfig(srcChainKey);
    const isNative = token.toLowerCase() === chainConfig.nativeToken.toLowerCase();
    const rawTx: EvmReturnType<true> = {
      from: from,
      to: chainConfig.addresses.assetManager,
      value: isNative ? scaleNativeMsgValue(srcChainKey, amount) : 0n,
      data: encodeFunctionData({
        abi: spokeAssetManagerAbi,
        functionName: 'transfer',
        args: [token, to, amount, data],
      }),
    };

    if (params.raw === true) {
      return rawTx satisfies TxReturnType<EvmSpokeOnlyChainKey, true> as TxReturnType<EvmSpokeOnlyChainKey, Raw>;
    }

    return params.walletProvider.sendTransaction(rawTx, {
      expectedChainId: getEvmViemChain(srcChainKey).id,
    }) satisfies Promise<TxReturnType<EvmSpokeOnlyChainKey, false>> as Promise<TxReturnType<EvmSpokeOnlyChainKey, Raw>>;
  }

  /**
   * Get the balance of the token deposited in the spoke chain asset manager.
   * @param {GetDepositParams<EvmSpokeOnlyChainKey>} params - The parameters for the deposit, including the token and chain id.
   * @returns {Promise<bigint>} The balance of the token deposited in the spoke chain asset manager.
   */
  public async getDeposit(params: GetDepositParams<EvmSpokeOnlyChainKey>): Promise<bigint> {
    return this.getPublicClient(params.srcChainKey).readContract({
      address: params.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.config.getChainConfig(params.srcChainKey).addresses.assetManager],
    });
  }

  /**
   * Get the user's own wallet balance of a token on an EVM spoke chain, in smallest units.
   * Native coin via `eth_getBalance` (Hedera scaled to canonical decimals); erc20 via `balanceOf`.
   * @param {GetBalanceParams<EvmSpokeOnlyChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units.
   */
  public async getWalletBalance(params: GetBalanceParams<EvmSpokeOnlyChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;
    const publicClient = this.getPublicClient(srcChainKey);

    if (isNativeToken(srcChainKey, token)) {
      const balance = await publicClient.getBalance({ address: srcAddress });
      return scaleNativeBalance(srcChainKey, balance);
    }

    const balance = await publicClient.readContract({
      address: token.address as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [srcAddress],
    });
    return balance ?? 0n;
  }

  /**
   * Get the user's own wallet balances of multiple tokens on an EVM spoke chain, in smallest
   * units. Non-native tokens are batched via multicall3 when the chain supports it, otherwise
   * read in parallel.
   * @param {GetBalancesParams<EvmSpokeOnlyChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<EvmSpokeOnlyChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;

    const nativeTokens = tokens.filter(token => isNativeToken(srcChainKey, token));
    const nonNativeTokens = tokens.filter(token => !isNativeToken(srcChainKey, token));

    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, nativeTokens, token =>
      this.getWalletBalance({ srcChainKey, srcAddress, token }),
    );

    if (nonNativeTokens.length === 0) {
      return collector.finish();
    }

    const publicClient = this.getPublicClient(srcChainKey);

    if (getEvmViemChain(srcChainKey).contracts?.multicall3) {
      // allowFailure (viem's default) keeps a single reverting token — or a rate-limited aggregate3
      // chunk, which viem fans out as a failure entry per call — from discarding the balances that
      // did resolve. Each failure still goes through the collector so it is logged, not silent.
      const results = await publicClient.multicall({
        contracts: nonNativeTokens.map(token => ({
          abi: erc20Abi,
          address: token.address as Address,
          functionName: 'balanceOf',
          args: [srcAddress],
        })),
      });
      nonNativeTokens.forEach((token, index) => {
        const result = results[index];
        if (result?.status === 'success') {
          collector.ok(token.address, BigInt(result.result));
        } else {
          collector.fail(token.address, result?.error ?? new Error(`missing multicall result for ${token.address}`));
        }
      });
      return collector.finish();
    }

    await settleWalletBalances(collector, nonNativeTokens, token =>
      publicClient.readContract({
        address: token.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [srcAddress],
      }),
    );
    return collector.finish();
  }

  /**
   * Sends a message to the hub chain.
   * @param {SendMessageParams} params - Includes dstChainKey, the chain key of the hub chain.
   * @param {Address} dstAddress - The address on the hub chain.
   * @param {Hex} payload - The payload to send.
   * @param {EvmSpokeProviderType} spokeProvider - The provider for the spoke chain.
   * @param {boolean} raw - The return type raw or just transaction hash
   * @returns {Promise<TxReturnType<EvmSpokeProviderType, R>>} A promise that resolves to the transaction hash.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<EvmSpokeOnlyChainKey, Raw>,
  ): Promise<TxReturnType<EvmSpokeOnlyChainKey, Raw>> {
    const { srcAddress: from, srcChainKey, dstChainKey, dstAddress, payload } = params;
    const relayId = getIntentRelayChainId(dstChainKey);
    const rawTx: EvmReturnType<true> = {
      from: from,
      to: this.config.getChainConfig(srcChainKey).addresses.connection satisfies Address,
      value: 0n,
      data: encodeFunctionData({
        abi: connectionAbi,
        functionName: 'sendMessage',
        args: [relayId, dstAddress, payload],
      }),
    };

    if (params.raw) {
      return rawTx satisfies TxReturnType<EvmSpokeOnlyChainKey, true> as TxReturnType<EvmSpokeOnlyChainKey, Raw>;
    }

    return params.walletProvider.sendTransaction(rawTx, {
      expectedChainId: getEvmViemChain(srcChainKey).id,
    }) satisfies Promise<TxReturnType<EvmSpokeOnlyChainKey, false>> as Promise<TxReturnType<EvmSpokeOnlyChainKey, Raw>>;
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<EvmSpokeOnlyChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<EvmSpokeOnlyChainKey>>> {
    try {
      const publicClient = this.getPublicClient(params.chainKey);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: params.txHash as `0x${string}`,
        pollingInterval: params.pollingIntervalMs,
        timeout: params.maxTimeoutMs,
      });

      if (receipt.status === 'reverted') {
        return { ok: true, value: { status: 'failure', error: new Error('Transaction reverted') } };
      }

      const response = {
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
        effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      };

      return { ok: true, value: { status: 'success', receipt: response } };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');
      return {
        ok: true,
        value: {
          status: isTimeout ? 'timeout' : 'failure',
          error: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }
  }
}
