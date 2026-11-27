import { assertMpcSwapRoute, assertProductionSwapRoute } from '../../utils/shared-utils.js';
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
import { encodeRecipient, randomUint256 } from '../../utils/shared-utils.js';
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
  // Sonic is the sole hub chain, so one public client suffices.
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

  /** ERC-20 allowance on Sonic (hub) for a spender such as the intents contract. */
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

  public async estimateGas(params: EstimateGasParams<SonicChainKey>): Promise<bigint> {
    return this.publicClient.estimateGas({
      account: params.tx.from,
      to: params.tx.to,
      value: params.tx.value,
      data: params.tx.data,
    });
  }

  /** The user's CREATE3-derived router (hub wallet) address. */
  public async getUserRouter(params: GetUserRouterParams): Promise<HubAddress> {
    return this.publicClient.readContract({
      address: this.config.getChainConfig(params.chainId).addresses.walletRouter,
      abi: sonicWalletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [params.address],
    });
  }

  /** Deposit via the Sonic wallet abstraction: `data` holds the encoded calls array. */
  public async deposit<Raw extends boolean>(
    params: DepositParams<SonicChainKey, Raw>,
  ): Promise<TxReturnType<SonicChainKey, Raw>> {
    invariant(isSonicChainKeyType(params.srcChainKey), '[SonicSpokeService] invalid spoke provider');

    const chainConfig = this.config.getChainConfig(params.srcChainKey);

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

    const { dstChainKey } = createIntentParams;
    const outputTokenInfo = isSonicChainKey(dstChainKey)
      ? undefined
      : hubProvider.config.getSpokeTokenFromOriginalAssetAddress(dstChainKey, createIntentParams.outputToken);
    const outputToken = isSonicChainKey(dstChainKey)
      ? (createIntentParams.outputToken as Address)
      : outputTokenInfo?.hubAsset;
    assertProductionSwapRoute(solverConfig.solverApiEndpoint, createIntentParams);
    assertMpcSwapRoute({ ...createIntentParams, outputToken: outputTokenInfo });

    invariant(
      inputToken,
      `hub asset not found for spoke chain token (intent.inputToken): ${createIntentParams.inputToken}`,
    );
    invariant(
      outputToken,
      `hub asset not found for spoke chain token (intent.outputToken): ${createIntentParams.outputToken}`,
    );

    // The delivery hook (if any) may override dstAddress and derive deliveryData.
    const { dstAddress, deliveryData } = HookService.resolveDelivery(createIntentParams);
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
      srcAddress: encodeRecipient(createIntentParams.srcChainKey, createIntentParams.srcAddress),
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
  /** Balance of the token on the hub (Sonic) chain. */
  public async getDeposit(params: GetDepositParams<SonicChainKey>): Promise<bigint> {
    return this.publicClient.readContract({
      address: params.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [params.token],
    });
  }

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

  /** Non-native tokens are batched via multicall3 when the chain supports it, otherwise read in parallel. */
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
      // allowFailure keeps one reverting token (or a rate-limited aggregate3 chunk, fanned out per call) from discarding
      // the balances that did resolve; each failure still goes through the collector.
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

  /** Execute a batch of contract calls (encoded in `payload`) through the Sonic wallet contract. */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<SonicChainKey, Raw>,
  ): Promise<TxReturnType<SonicChainKey, Raw>> {
    invariant(isSonicChainKeyType(params.srcChainKey), '[SonicSpokeService.callWallet] invalid chain id');

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
