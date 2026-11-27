import { IntentsAbi } from '../shared/abis/intents.abi.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import {
  type Address,
  type GetLogsReturnType,
  type PublicClient,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAbiItem,
  keccak256,
  parseEventLogs,
} from 'viem';
import { Erc20Service } from '../shared/services/erc-20/Erc20Service.js';
import {
  assertMpcSwapRoute,
  assertProductionSwapRoute,
  calculatePercentageFeeAmount,
  encodeRecipient,
  randomUint256,
} from '../shared/utils/shared-utils.js';
import { encodeContractCalls } from '../shared/utils/evm-utils.js';
import { isPartnerFeeAmount, isPartnerFeePercentage } from '../shared/guards.js';
import {
  IntentDataType,
  type CreateIntentParams,
  type FeeData,
  type Intent,
  type IntentData,
  type IntentState,
} from '../shared/types/intent-types.js';
import { HookService } from './HookService.js';
import { IntentDataService } from './IntentDataService.js';
import {
  getIntentRelayChainId,
  isHubChainKey,
  type Hash,
  type Hex,
  type SolverConfig,
  type EvmContractCall,
  type PartnerFee,
  FEE_PERCENTAGE_SCALE,
} from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { CLPositionManagerAbi } from '@pancakeswap/infinity-sdk';
export const IntentCreatedEventAbi = getAbiItem({ abi: IntentsAbi, name: 'IntentCreated' });
export type IntentCreatedEventLog = GetLogsReturnType<typeof IntentCreatedEventAbi>[number];
export const IntentFilledEventAbi = getAbiItem({ abi: IntentsAbi, name: 'IntentFilled' });
export type IntentFilledEventLog = GetLogsReturnType<typeof IntentFilledEventAbi>[number];
export const MintPositionEventAbi = getAbiItem({ abi: CLPositionManagerAbi, name: 'MintPosition' });
export type MintPositionEventLog = GetLogsReturnType<typeof MintPositionEventAbi>[number];

/** Stateless EVM encode/decode helpers for swap intents on the hub. */
export class EvmSolverService {
  private constructor() {}

  /**
   * Returns `[payload, intent, feeAmount]`; payload is the `[approve, createIntent]` multicall for a spoke deposit.
   * Validates the destination payout floor but not a refund floor to an MPC-relay source: callers must check that.
   */
  public static constructCreateIntentData(
    createIntentParams: CreateIntentParams,
    creatorHubWalletAddress: Address,
    config: ConfigService,
    fee: PartnerFee | undefined,
  ): [Hex, Intent, bigint] {
    const inputToken = !isHubChainKey(createIntentParams.srcChainKey)
      ? config.getSpokeTokenFromOriginalAssetAddress(createIntentParams.srcChainKey, createIntentParams.inputToken)
          ?.hubAsset
      : (createIntentParams.inputToken as `0x${string}`);

    const { dstChainKey } = createIntentParams;
    const outputTokenInfo = isHubChainKey(dstChainKey)
      ? undefined
      : config.getSpokeTokenFromOriginalAssetAddress(dstChainKey, createIntentParams.outputToken);
    const outputToken = isHubChainKey(dstChainKey)
      ? (createIntentParams.outputToken as Address)
      : outputTokenInfo?.hubAsset;

    assertProductionSwapRoute(config.solver.solverApiEndpoint, createIntentParams);
    assertMpcSwapRoute({ ...createIntentParams, outputToken: outputTokenInfo });

    invariant(
      inputToken,
      `hub asset not found for spoke chain token (intent.inputToken): ${createIntentParams.inputToken}`,
    );
    invariant(
      outputToken,
      `hub asset not found for spoke chain token (intent.outputToken): ${createIntentParams.outputToken}`,
    );

    const { dstAddress, deliveryData } = HookService.resolveDelivery(createIntentParams);
    const [feeEnvelope, feeAmount] = EvmSolverService.createIntentFeeData(fee, createIntentParams.inputAmount);
    const intentData = IntentDataService.composeIntentData(feeEnvelope, deliveryData);

    const calls: EvmContractCall[] = [];
    const intentsContract = config.solver.intentsContract;
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

    calls.push(Erc20Service.encodeApprove(intent.inputToken, intentsContract, createIntentParams.inputAmount));
    calls.push(EvmSolverService.encodeCreateIntent(intent, intentsContract));
    return [encodeContractCalls(calls), intent, feeAmount];
  }

  /** Returns `[IntentData(FEE) envelope or '0x', feeAmount]`; percentage fees are in bps up to `FEE_PERCENTAGE_SCALE`. */
  public static createIntentFeeData(fee: PartnerFee | undefined, inputAmount: bigint): [Hex, bigint] {
    invariant(inputAmount > 0n, 'Input amount must be greater than 0');
    if (!fee) {
      return ['0x', 0n];
    }

    let feeAmount: bigint;
    if (isPartnerFeeAmount(fee)) {
      feeAmount = fee.amount;
    } else if (isPartnerFeePercentage(fee)) {
      invariant(
        fee.percentage >= 0 && fee.percentage <= FEE_PERCENTAGE_SCALE,
        `Fee percentage must be between 0 and ${FEE_PERCENTAGE_SCALE}}`,
      );

      feeAmount = calculatePercentageFeeAmount(inputAmount, fee.percentage);
    } else {
      return ['0x', 0n];
    }

    const feeData = {
      fee: feeAmount,
      receiver: fee.address,
    } satisfies FeeData;

    const encodedFeeData = encodeAbiParameters(
      [
        { name: 'fee', type: 'uint256' },
        { name: 'receiver', type: 'address' },
      ],
      [feeData.fee, feeData.receiver],
    );

    const intentData = {
      type: IntentDataType.FEE,
      data: encodedFeeData,
    } satisfies IntentData;

    return [encodePacked(['uint8', 'bytes'], [intentData.type, intentData.data]), feeAmount];
  }

  /** Inverse of {@link createIntentFeeData}; works for bare fee and multi-entry envelopes alike. */
  public static decodeIntentFeeAmount(data: Hex): bigint {
    const feePayload = IntentDataService.extractFeePayload(data);
    return feePayload ? EvmSolverService.decodeFeePayload(feePayload) : 0n;
  }

  /** Decodes a raw `FeeData` payload (`abi.encode(uint256 fee, address receiver)`) to its fee amount. */
  private static decodeFeePayload(payload: Hex): bigint {
    const [feeAmount] = decodeAbiParameters(
      [
        { name: 'fee', type: 'uint256' },
        { name: 'receiver', type: 'address' },
      ],
      payload,
    );
    return feeAmount;
  }

  /** Byte-identical rebuild of the original relay payload; the spoke approval amount is `inputAmount + feeAmount`. */
  public static reconstructCreateIntentData(intent: Intent, intentsContract: Address, isHubSource: boolean): Hex {
    const createIntentCall = EvmSolverService.encodeCreateIntent(intent, intentsContract);

    if (isHubSource) {
      return createIntentCall.data;
    }

    const grossInputAmount = intent.inputAmount + EvmSolverService.decodeIntentFeeAmount(intent.data);

    return encodeContractCalls([
      Erc20Service.encodeApprove(intent.inputToken, intentsContract, grossInputAmount),
      createIntentCall,
    ]);
  }

  public static async getIntent(txHash: Hash, config: ConfigService, publicClient: PublicClient): Promise<Intent> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const logs: IntentCreatedEventLog[] = parseEventLogs({
      abi: IntentsAbi,
      eventName: 'IntentCreated',
      logs: receipt.logs,
      strict: true,
    });

    for (const log of logs) {
      if (log.address.toLowerCase() === config.solver.intentsContract.toLowerCase()) {
        if (!log.args.intent) {
          continue;
        }

        if (
          !config.isValidIntentRelayChainId(log.args.intent.srcChain) ||
          !config.isValidIntentRelayChainId(log.args.intent.dstChain)
        ) {
          throw new Error(`Invalid intent relay chain id: ${log.args.intent.srcChain} or ${log.args.intent.dstChain}`);
        }

        return {
          intentId: log.args.intent.intentId,
          creator: log.args.intent.creator,
          inputToken: log.args.intent.inputToken,
          outputToken: log.args.intent.outputToken,
          inputAmount: log.args.intent.inputAmount,
          minOutputAmount: log.args.intent.minOutputAmount,
          deadline: log.args.intent.deadline,
          data: log.args.intent.data,
          allowPartialFill: log.args.intent.allowPartialFill,
          srcChain: log.args.intent.srcChain,
          dstChain: log.args.intent.dstChain,
          srcAddress: log.args.intent.srcAddress,
          dstAddress: log.args.intent.dstAddress,
          solver: log.args.intent.solver,
        } satisfies Intent;
      }
    }

    throw new Error(`No intent found for ${txHash}`);
  }

  public static async getFilledIntent(
    txHash: Hash,
    solverConfig: SolverConfig,
    publicClient: PublicClient,
  ): Promise<IntentState> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const logs: IntentFilledEventLog[] = parseEventLogs({
      abi: IntentsAbi,
      eventName: 'IntentFilled',
      logs: receipt.logs,
      strict: true,
    });

    for (const log of logs) {
      if (log.address.toLowerCase() === solverConfig.intentsContract.toLowerCase()) {
        if (!log.args.intentHash || !log.args.intentState) {
          continue;
        }

        return {
          exists: log.args.intentState.exists,
          remainingInput: log.args.intentState.remainingInput,
          receivedOutput: log.args.intentState.receivedOutput,
          pendingPayment: log.args.intentState.pendingPayment,
        } satisfies IntentState;
      }
    }

    throw new Error(`No filled intent found for ${txHash}`);
  }

  public static getIntentHash(intent: Intent): Hex {
    return keccak256(encodeAbiParameters(getAbiItem({ abi: IntentsAbi, name: 'createIntent' }).inputs, [intent]));
  }

  public static encodeCreateIntent(intent: Intent, intentsContract: Address): EvmContractCall {
    return {
      address: intentsContract,
      value: 0n,
      data: encodeFunctionData({
        abi: IntentsAbi,
        functionName: 'createIntent',
        args: [intent],
      }),
    };
  }

  /** `intent` must match the on-chain intent exactly. */
  public static encodeCancelIntent(intent: Intent, intentsContract: Address): EvmContractCall {
    return {
      address: intentsContract,
      value: 0n,
      data: encodeFunctionData({
        abi: IntentsAbi,
        functionName: 'cancelIntent',
        args: [intent],
      }),
    };
  }
}
