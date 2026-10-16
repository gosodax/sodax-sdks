import {
  type Address,
  createPublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type PublicClient,
} from 'viem';
import {
  type Hex,
  type HubAddress,
  type Result,
  type SolverConfig,
  getIntentRelayChainId,
  type SonicChainKey,
  type EvmRawTransactionReceipt,
  ChainKeys,
  type PartnerFee,
  type TxReturnType,
  type EvmContractCall,
  isSonicChainKey,
  isNativeToken,
  type WalletProviderSlot,
  type EvmReturnType,
  type HubConfig,
} from '@sodax/types';
import { invariant } from '../../utils/tiny-invariant.js';
import { encodeAddress, encodeRecipient, randomUint256 } from '../../utils/shared-utils.js';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import { buildEvmRpcTransport } from '../../utils/transport-utils.js';
import { Erc20Service, type Erc20IsAllowanceParams } from '../erc-20/Erc20Service.js';
import { wrappedSonicAbi, sonicWalletFactoryAbi } from '../../abis/index.js';
import { EvmSolverService } from '../../../swap/EvmSolverService.js';
import { HookService } from '../../../swap/HookService.js';
import { IntentDataService } from '../../../swap/IntentDataService.js';
import { isSonicChainKeyType } from '../../guards.js';
import type {
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
  EstimateGasParams,
  GetDepositParams,
  GetBalanceParams,
  GetBalancesParams,
  SendMessageParams,
  DepositParams,
} from '../../types/spoke-types.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import type { CreateIntentParams, Intent } from '../../types/intent-types.js';
import type { ConfigService } from '../../config/ConfigService.js';

export type WithdrawInfo = {
  aTokenAddress: Address;
  aTokenAmount: bigint;
  token: Address;
};

export type BorrowInfo = {
  variableDebtTokenAddress: Address;
  vaultAddress: Address;
  amount: bigint;
};

export type GetUserRouterParams = {
  address: Address;
  chainId: SonicChainKey;
};

export type CreateSonicSwapIntentParams<Raw extends boolean> = {
  createIntentParams: CreateIntentParams;
  creatorHubWalletAddress: Address;
  solverConfig: SolverConfig;
  fee: PartnerFee | undefined;
  hubProvider: { config: ConfigService; chainConfig: HubConfig };
} & WalletProviderSlot<SonicChainKey, Raw>;

export class SonicSpokeService {
  private readonly config: ConfigService;
  // since sonic is sole hub chain we only need one public client
  public readonly publicClient: PublicClient;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  public constructor(config: ConfigService) {
    this.config = config;
    const chainConfig = config.getChainConfig(ChainKeys.SONIC_MAINNET);
    this.publicClient = createPublicClient({
      transport: buildEvmRpcTransport(chainConfig),
      chain: getEvmViemChain(ChainKeys.SONIC_MAINNET),
    });
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  /**
   * Check ERC-20 allowance on Sonic (hub) for a given spender (e.g. intents contract).
   */
  public async isAllowanceValid(
    params: Omit<Erc20IsAllowanceParams<SonicChainKey>, 'publicClient' | 'nativeToken'>,
  ): Promise<Result<boolean>> {
    try {
      return await Erc20Service.isAllowanceValid({
        ...params,
        publicClient: this.publicClient,
        nativeToken: this.config.getChainConfig(params.chainKey).nativeToken as Address,
      });
    } catch (e) {
      return {
        ok: false,
        error: e,
      };
    }
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<SonicChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<SonicChainKey>>> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: params.txHash as `0x${string}`,
        pollingInterval: params.pollingIntervalMs ?? this.pollingIntervalMs,
        timeout: params.maxTimeoutMs ?? this.maxTimeoutMs,
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

      return { ok: true, value: { status: 'success', receipt: response satisfies EvmRawTransactionReceipt } };
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

  /**

    * Estimates the gas necessary to complete a transaction without submitting it to the network.
    *
    * - Docs: https://viem.sh/docs/actions/public/estimateGas
    * - JSON-RPC Methods: [`eth_estimateGas`](https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_estimategas)
    *
    * @param {EstimateGasParams<SonicChainKey>} params - The parameters for the gas estimation, including the from, to, value, and data.
    * @returns {Promise<bigint>} Estimated gas for the transaction.
    *
    * @example
    *
    * const params: EstimateGasParams<SonicChainKey> = {
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
  public async estimateGas(params: EstimateGasParams<SonicChainKey>): Promise<bigint> {
    // Use viem's estimateGas with explicit parameter types
    return this.publicClient.estimateGas({
      account: params.tx.from,
      to: params.tx.to,
      value: params.tx.value,
      data: params.tx.data,
    });
  }

  /**
   * Get the derived address of a contract deployed with CREATE3.
   * @param {GetUserRouterParams} params - The parameters for the get user router
   * @returns {HubAddress} The computed contract address as a EVM address (hex) string
   */
  public async getUserRouter(params: GetUserRouterParams): Promise<HubAddress> {
    return this.publicClient.readContract({
      address: this.config.getChainConfig(params.chainId).addresses.walletRouter,
      abi: sonicWalletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [params.address],
    });
  }

  /**
   * Deposit tokens to the spoke chain using the Sonic wallet abstraction.
   * @param {DepositParams<SonicChainKey, Raw>} params - The parameters for the deposit
   * @returns {Promise<TxReturnType<SonicChainKey, Raw>>} A promise that resolves to the transaction hash
   */
  public async deposit<Raw extends boolean>(
    params: DepositParams<SonicChainKey, Raw>,
  ): Promise<TxReturnType<SonicChainKey, Raw>> {
    invariant(isSonicChainKeyType(params.srcChainKey), '[SonicSpokeService] invalid spoke provider');

    const chainConfig = this.config.getChainConfig(params.srcChainKey);

    // Decode the data field which contains the encoded calls array
    const calls = Array.from(
      decodeAbiParameters(
        [
          {
            name: 'calls',
            type: 'tuple[]',
            components: [
              { name: 'address', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
            ],
          },
        ],
        params.data,
      )[0] satisfies readonly EvmContractCall[],
    );

    if (params.token.toLowerCase() === chainConfig.nativeToken.toLowerCase()) {
      // Add a call to wrap the native token
      const wrapCall = {
        address: chainConfig.addresses.wrappedSonic,
        value: params.amount,
        data: encodeFunctionData({
          abi: wrappedSonicAbi,
          functionName: 'deposit',
        }),
      } satisfies EvmContractCall;
      calls.unshift(wrapCall);
    } else {
      const transferFromCall = Erc20Service.encodeTransferFrom(
        params.token,
        params.srcAddress,
        params.to,
        params.amount,
      );
      calls.unshift(transferFromCall);
    }

    const txData = encodeFunctionData({
      abi: sonicWalletFactoryAbi,
      functionName: 'route',
      args: [
        calls.map(call => ({
          addr: call.address,
          value: call.value,
          data: call.data,
        })),
      ],
    });

    const rawTx: TxReturnType<SonicChainKey, true> = {
      from: params.srcAddress,
      to: chainConfig.addresses.walletRouter,
      data: txData,
      value: params.token.toLowerCase() === chainConfig.nativeToken.toLowerCase() ? params.amount : 0n,
    };

    if (params.raw === true) {
      return rawTx satisfies TxReturnType<SonicChainKey, true> as TxReturnType<SonicChainKey, Raw>;
    }

    return params.walletProvider.sendTransaction(rawTx, {
      expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
    }) satisfies Promise<TxReturnType<SonicChainKey, false>> as Promise<TxReturnType<SonicChainKey, Raw>>;
  }

  public static async createSwapIntent<Raw extends boolean>(
    params: CreateSonicSwapIntentParams<Raw>,
  ): Promise<[TxReturnType<SonicChainKey, Raw>, Intent, bigint, Hex]> {
    const { createIntentParams, creatorHubWalletAddress, solverConfig, fee, hubProvider } = params;
    // On Sonic spoke, token/address fields are always EVM-shaped 0x addresses.
    const inputToken = createIntentParams.inputToken as Address;
    const srcAddress = createIntentParams.srcAddress as Address;

    const outputToken = isSonicChainKey(createIntentParams.dstChainKey)
      ? (createIntentParams.outputToken as `0x${string}`)
      : hubProvider.config.getSpokeTokenFromOriginalAssetAddress(
          createIntentParams.dstChainKey,
          createIntentParams.outputToken,
        )?.hubAsset;

    invariant(
      inputToken,
      `hub asset not found for spoke chain token (intent.inputToken): ${createIntentParams.inputToken}`,
    );
    invariant(
      outputToken,
      `hub asset not found for spoke chain token (intent.outputToken): ${createIntentParams.outputToken}`,
    );

    // Apply the delivery hook (if any): may override dstAddress and derive deliveryData.
    const { dstAddress, deliveryData } = HookService.resolveDelivery(createIntentParams);
    // Encode the partner fee, then fold it together with any delivery payload into the intent `data`.
    const [feeEnvelope, feeAmount] = EvmSolverService.createIntentFeeData(fee, createIntentParams.inputAmount);
    const intentData = IntentDataService.composeIntentData(feeEnvelope, deliveryData);

    const intentsContract = solverConfig.intentsContract;
    const intent = {
      intentId: randomUint256(),
      creator: creatorHubWalletAddress,
      inputToken,
      outputToken,
      inputAmount: createIntentParams.inputAmount - feeAmount,
      minOutputAmount: createIntentParams.minOutputAmount,
      deadline: createIntentParams.deadline,
      allowPartialFill: createIntentParams.allowPartialFill,
      srcChain: getIntentRelayChainId(createIntentParams.srcChainKey),
      dstChain: getIntentRelayChainId(createIntentParams.dstChainKey),
      srcAddress: encodeAddress(createIntentParams.srcChainKey, createIntentParams.srcAddress),
      dstAddress: encodeRecipient(createIntentParams.dstChainKey, dstAddress),
      solver: createIntentParams.solver ?? '0x0000000000000000000000000000000000000000',
      data: intentData, // fee amount will be deducted from the input amount; may also carry delivery data
    } satisfies Intent;

    const txData = EvmSolverService.encodeCreateIntent(intent, intentsContract);

    const rawTx = {
      from: srcAddress,
      to: txData.address,
      data: txData.data,
      value:
        inputToken.toLowerCase() === hubProvider.chainConfig.nativeToken.toLowerCase()
          ? createIntentParams.inputAmount
          : 0n,
    } satisfies TxReturnType<SonicChainKey, true>;

    if (params.raw) {
      return [rawTx as TxReturnType<SonicChainKey, Raw>, intent, feeAmount, txData.data];
    }

    return [
      (await params.walletProvider.sendTransaction(rawTx, {
        expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
      })) satisfies TxReturnType<SonicChainKey, false> as TxReturnType<SonicChainKey, Raw>,
      intent,
      feeAmount,
      txData.data,
    ];
  }
  /**
   * Get the balance of the token in the hub (sonic) chain.
   * @param {GetDepositParams<SonicChainKey>} params - The parameters for the deposit, including the token and chain id.
   * @returns {Promise<bigint>} The balance of the token.
   */
  public async getDeposit(params: GetDepositParams<SonicChainKey>): Promise<bigint> {
    return this.publicClient.readContract({
      address: params.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [params.token],
    });
  }

  /**
   * Get the user's own wallet balance of a token on the hub (Sonic) chain, in smallest units.
   * Native coin via `eth_getBalance`; erc20 via `balanceOf`.
   * @param {GetBalanceParams<SonicChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units.
   */
  public async getWalletBalance(params: GetBalanceParams<SonicChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    if (isNativeToken(srcChainKey, token)) {
      return this.publicClient.getBalance({ address: srcAddress });
    }

    const balance = await this.publicClient.readContract({
      address: token.address as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [srcAddress],
    });
    return balance ?? 0n;
  }

  /**
   * Get the user's own wallet balances of multiple tokens on the hub (Sonic) chain, in smallest
   * units. Non-native tokens are batched via multicall3 when the chain supports it, otherwise
   * read in parallel.
   * @param {GetBalancesParams<SonicChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<SonicChainKey>): Promise<WalletBalanceMap> {
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

    if (getEvmViemChain(srcChainKey).contracts?.multicall3) {
      // allowFailure (viem's default) keeps a single reverting token — or a rate-limited aggregate3
      // chunk, which viem fans out as a failure entry per call — from discarding the balances that
      // did resolve. Each failure still goes through the collector so it is logged, not silent.
      const results = await this.publicClient.multicall({
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
      this.publicClient.readContract({
        address: token.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [srcAddress],
      }),
    );
    return collector.finish();
  }

  /**
   * Execute a batch of contract calls through the Sonic wallet contract.
   * @param {Hex} payload - The encoded payload containing the calls array
   * @param {SonicSpokeProviderType} spokeProvider - The provider for the spoke chain
   * @returns {Promise<TxReturnType<S, R>>} A promise that resolves to the transaction hash
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<SonicChainKey, Raw>,
  ): Promise<TxReturnType<SonicChainKey, Raw>> {
    invariant(isSonicChainKeyType(params.srcChainKey), '[SonicSpokeService.callWallet] invalid chain id');

    // Decode the payload which contains the encoded calls array
    const calls = decodeAbiParameters(
      [
        {
          name: 'calls',
          type: 'tuple[]',
          components: [
            { name: 'address', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
      ],
      params.payload,
    )[0] satisfies readonly EvmContractCall[];

    const txData = encodeFunctionData({
      abi: sonicWalletFactoryAbi,
      functionName: 'route',
      args: [
        calls.map(call => ({
          addr: call.address,
          value: call.value,
          data: call.data,
        })),
      ],
    });

    const rawTx: EvmReturnType<true> = {
      from: params.srcAddress,
      to: this.config.getChainConfig(params.srcChainKey).addresses.walletRouter,
      data: txData,
      value: 0n,
    };

    if (params.raw === true) {
      return rawTx satisfies TxReturnType<SonicChainKey, true> as TxReturnType<SonicChainKey, Raw>;
    }

    return params.walletProvider.sendTransaction(rawTx, {
      expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
    }) satisfies Promise<TxReturnType<SonicChainKey, false>> as Promise<TxReturnType<SonicChainKey, Raw>>;
  }
}
