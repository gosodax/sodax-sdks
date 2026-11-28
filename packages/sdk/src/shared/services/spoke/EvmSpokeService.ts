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
import { TRANSACTION_REVERTED_MESSAGE } from './evm-receipt.js';

/**
 * HBAR is tracked as 8 decimals but Hedera's EVM layer treats native value as 18, so msg.value is scaled by 10^10
 * while the asset-manager `transfer` amount stays in 8.
 */
const HEDERA_NATIVE_VALUE_SCALE = 10n ** 10n;
function scaleNativeMsgValue(chainKey: EvmSpokeOnlyChainKey, amount: bigint): bigint {
  return chainKey === ChainKeys.HEDERA_MAINNET ? amount * HEDERA_NATIVE_VALUE_SCALE : amount;
}

/** Inverse of {@link scaleNativeMsgValue}: `eth_getBalance` returns HBAR in 18-decimal weibar. */
function scaleNativeBalance(chainKey: EvmSpokeOnlyChainKey, amount: bigint): bigint {
  return chainKey === ChainKeys.HEDERA_MAINNET ? amount / HEDERA_NATIVE_VALUE_SCALE : amount;
}

export type CreateViemPublicClientParams = {
  chainId: EvmSpokeOnlyChainKey;
  rpcUrl?: string;
};

export class EvmSpokeService {
  private readonly config: ConfigService;
  // Lazily created per chain
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

  public async estimateGas({ tx, chainKey: chainId }: EstimateGasParams<EvmSpokeOnlyChainKey>): Promise<bigint> {
    return this.getPublicClient(chainId).estimateGas({
      account: tx.from,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    });
  }

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

  /** Deposit into the spoke chain asset manager to transfer tokens to the hub. */
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

  public async getDeposit(params: GetDepositParams<EvmSpokeOnlyChainKey>): Promise<bigint> {
    return this.getPublicClient(params.srcChainKey).readContract({
      address: params.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.config.getChainConfig(params.srcChainKey).addresses.assetManager],
    });
  }

  /** Native coin via `eth_getBalance` (Hedera scaled to canonical decimals); erc20 via `balanceOf`. */
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

  /** Non-native tokens are batched via multicall3 when the chain supports it, otherwise read in parallel. */
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
      // allowFailure keeps one reverting token (or a rate-limited aggregate3 chunk, fanned out per call) from discarding
      // the balances that did resolve; each failure still goes through the collector.
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
        return { ok: true, value: { status: 'failure', error: new Error(TRANSACTION_REVERTED_MESSAGE) } };
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
