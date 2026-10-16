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
  calculatePercentageFeeAmount,
  encodeAddress,
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

/**
 * Stateless utility class for EVM-level intent operations on the SODAX hub chain (Sonic).
 *
 * All methods are `static` — this class is never instantiated and holds no mutable state.
 * It handles the low-level on-chain concerns for the swap feature:
 * - Constructing and ABI-encoding intent creation/cancellation contract calls
 * - Encoding partner fee data into the intent's `data` field
 * - Reading back `Intent` and `IntentState` structs from hub-chain transaction receipts
 * - Computing the keccak256 intent hash used as the on-chain intent ID
 *
 * `SwapService` and `SonicSpokeService` delegate all EVM encoding and decoding to this class.
 */
export class EvmSolverService {
  private constructor() {}

  /**
   * Builds the complete calldata and `Intent` struct for registering a swap intent on the hub chain.
   *
   * Performs three steps:
   * 1. Resolves spoke-chain token addresses to their hub (Sonic) equivalents via `ConfigService`.
   * 2. Computes partner fee data and deducts the fee from `inputAmount`.
   * 3. ABI-encodes a multicall payload: `[ERC-20.approve(intentsContract, inputAmount), intents.createIntent(intent)]`.
   *
   * The returned `Hex` payload is passed as the `data` field in a spoke deposit, so the hub
   * wallet abstraction executes both the approval and the intent creation atomically.
   *
   * @param createIntentParams - Source/destination tokens, amounts, chain keys, addresses, and optional solver.
   * @param creatorHubWalletAddress - The hub chain wallet address derived from the user's spoke address.
   * @param config - Used to resolve hub asset addresses and the intents contract address.
   * @param fee - Optional partner fee configuration (fixed amount or percentage).
   * @returns A tuple `[encodedPayload, intent, feeAmount]`:
   *   - `encodedPayload` — ABI-encoded multicall data to send to the hub wallet abstraction.
   *   - `intent` — The fully constructed `Intent` struct (with fee deducted from `inputAmount`).
   *   - `feeAmount` — The actual fee deducted, in the input token's smallest unit (`0n` if no fee).
   * @throws Invariant errors if hub asset addresses cannot be resolved for either token.
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

    const outputToken = !isHubChainKey(createIntentParams.dstChainKey)
      ? config.getSpokeTokenFromOriginalAssetAddress(createIntentParams.dstChainKey, createIntentParams.outputToken)
          ?.hubAsset
      : (createIntentParams.outputToken as `0x${string}`);

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
      srcAddress: encodeAddress(createIntentParams.srcChainKey, createIntentParams.srcAddress),
      dstAddress: encodeRecipient(createIntentParams.dstChainKey, dstAddress),
      solver: createIntentParams.solver ?? '0x0000000000000000000000000000000000000000',
      data: intentData, // fee amount will be deducted from the input amount; may also carry delivery data
    } satisfies Intent;

    calls.push(Erc20Service.encodeApprove(intent.inputToken, intentsContract, createIntentParams.inputAmount));
    calls.push(EvmSolverService.encodeCreateIntent(intent, intentsContract));
    return [encodeContractCalls(calls), intent, feeAmount];
  }

  /**
   * Encodes partner fee configuration into the `data` field of an intent.
   *
   * When a fee is configured, encodes a `FeeData` struct (`{ fee, receiver }`) and wraps it
   * in an `IntentData` envelope (`{ type: IntentDataType.FEE, data: encodedFeeData }`).
   * The intents contract reads this on-chain and routes the fee to the partner address.
   *
   * Supports two fee modes:
   * - `PartnerFeeAmount` — fixed bigint amount deducted from `inputAmount`.
   * - `PartnerFeePercentage` — percentage in basis points (validated: 0 – `FEE_PERCENTAGE_SCALE`).
   *
   * @param fee - Partner fee config, or `undefined` for no fee.
   * @param inputAmount - The gross input amount (used to calculate percentage-based fees). Must be > 0.
   * @returns A tuple `[encodedFeeHex, feeAmount]`:
   *   - `encodedFeeHex` — packed ABI encoding of the fee data to embed in `Intent.data` (`'0x'` if no fee).
   *   - `feeAmount` — the fee in input token units (`0n` if no fee).
   * @throws Invariant error if `inputAmount` is `0n` or if the fee percentage is out of range.
   */
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

    // Create the fee data struct
    const feeData = {
      fee: feeAmount,
      receiver: fee.address,
    } satisfies FeeData;

    // Encode the fee data
    const encodedFeeData = encodeAbiParameters(
      [
        { name: 'fee', type: 'uint256' },
        { name: 'receiver', type: 'address' },
      ],
      [feeData.fee, feeData.receiver],
    );

    // Create the intent data struct
    const intentData = {
      type: IntentDataType.FEE,
      data: encodedFeeData,
    } satisfies IntentData;

    // Encode the intent data
    return [encodePacked(['uint8', 'bytes'], [intentData.type, intentData.data]), feeAmount];
  }

  /**
   * Recovers the partner fee amount embedded in an intent's `data` field.
   *
   * Inverse of {@link createIntentFeeData}: returns the encoded fee, regardless of whether the `data`
   * is a bare fee envelope or a multi-entry envelope that also carries delivery data. The envelope
   * parsing lives in {@link IntentDataService.extractFeePayload}; this method just decodes the fee struct.
   *
   * @param data - The intent's `data` field (`'0x'` when no fee was configured).
   * @returns The fee amount in the input token's smallest unit (`0n` when no fee is present).
   */
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

  /**
   * Re-derives the byte-identical relay payload that `createIntent` originally produced, from a
   * fully-populated `Intent` alone.
   *
   * Mirrors the two payload shapes built at intent-creation time:
   * - Hub (Sonic) source — raw `createIntent(intent)` calldata (no approval, no multicall), matching
   *   {@link SonicSpokeService.createSwapIntent}.
   * - Spoke source — the `[approve(intentsContract, gross), createIntent(intent)]` multicall, matching
   *   {@link constructCreateIntentData}. The gross approval amount is recovered as
   *   `intent.inputAmount + feeAmount`, where `feeAmount` comes from {@link decodeIntentFeeAmount}.
   *
   * Byte-identity holds because this reuses the exact encode primitives (`encodeCreateIntent`,
   * `Erc20Service.encodeApprove`, `encodeContractCalls`) that produced the original — the only
   * originally-random input, `intentId`, is already carried on the `Intent`.
   *
   * @param intent - The fully-populated intent (e.g. from `createIntent` or `getIntent`).
   * @param intentsContract - The hub-chain intents contract address (`config.solver.intentsContract`).
   * @param isHubSource - `true` when the intent's source chain is the hub (Sonic).
   * @returns The byte-identical relay payload `Hex`.
   */
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

  /**
   * Reads an `Intent` struct from a hub-chain transaction receipt.
   *
   * Waits for the transaction to be mined, then parses the `IntentCreated` event logs,
   * matching against the configured intents contract address. Validates that the intent's
   * source and destination chain IDs are recognized by the active config.
   *
   * @param txHash - The hub-chain (Sonic) transaction hash of the intent creation.
   * @param config - Used to identify the intents contract and validate relay chain IDs.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns The `Intent` struct extracted from the matching event log.
   * @throws If the transaction contains no matching `IntentCreated` event, or if the
   *   intent's chain IDs are not recognized.
   */
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

  /**
   * Reads an `IntentState` struct from a hub-chain fill transaction receipt.
   *
   * Waits for the transaction to be mined, then parses the `IntentFilled` event logs,
   * matching against the configured intents contract address.
   *
   * @param txHash - The hub-chain (Sonic) transaction hash of the solver's fill transaction.
   * @param solverConfig - Used to identify the intents contract address.
   * @param publicClient - Viem public client connected to the hub chain.
   * @returns `IntentState`: `{ exists, remainingInput, receivedOutput, pendingPayment }`.
   * @throws If the transaction contains no matching `IntentFilled` event.
   */
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

  /**
   * Computes the keccak256 hash of an intent struct, which serves as its unique ID on the hub chain.
   *
   * Uses the same ABI encoding as the `createIntent` function signature so the result matches
   * what the on-chain intents contract stores.
   *
   * @param intent - The intent to hash.
   * @returns The `0x`-prefixed keccak256 digest of the ABI-encoded intent.
   */
  public static getIntentHash(intent: Intent): Hex {
    return keccak256(encodeAbiParameters(getAbiItem({ abi: IntentsAbi, name: 'createIntent' }).inputs, [intent]));
  }

  /**
   * ABI-encodes a `createIntent(Intent)` call for the hub intents contract.
   *
   * @param intent - The fully constructed intent struct to register.
   * @param intentsContract - The hub-chain address of the intents contract.
   * @returns An `EvmContractCall` with `address`, `value: 0n`, and ABI-encoded `data`.
   */
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

  /**
   * ABI-encodes a `cancelIntent(Intent)` call for the hub intents contract.
   *
   * @param intent - The intent to cancel. Must match the on-chain intent exactly (same `intentId`).
   * @param intentsContract - The hub-chain address of the intents contract.
   * @returns An `EvmContractCall` with `address`, `value: 0n`, and ABI-encoded `data`.
   */
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
