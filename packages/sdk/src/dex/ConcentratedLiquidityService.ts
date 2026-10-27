import type { Hex, PublicClient } from 'viem';
import {
  type SpokeService,
  encodeContractCalls,
  relayTxAndWaitPacket,
  Permit2Service,
  Erc20Service,
  Erc4626Service,
  type ConfigService,
  type HubProvider,
  isHubChainKeyType,
  type SendMessageParams,
} from '../shared/index.js';
import { SodaxError, isSodaxError } from '../errors/SodaxError.js';
import { intentCreationFailed, lookupFailed } from '../errors/wrappers.js';
import { dexInvariant, isDexCreateIntentError } from './errors.js';
import type { MintPositionEventLog } from '../swap/EvmSolverService.js';
import type {
  Address,
  CLPositionConfig,
  EvmContractCall,
  GetAddressType,
  Hash,
  HttpUrl,
  OriginalAssetAddress,
  PoolKey,
  Result,
  SpokeChainKey,
  SpokeExecActionParams,
  TxReturnType,
  XToken,
} from '@sodax/types';
import { isMpcRelayChainKey } from '@sodax/types';
import type { IntentTxResult, TxHashPair } from '../shared/types/types.js';
import { erc20Abi, maxUint160, maxUint48, parseEventLogs } from 'viem';
import { Price, Token } from '@pancakeswap/swap-sdk-core';

import {
  CLPoolManagerAbi,
  CLPositionManagerAbi,
  decodePoolKey,
  getPoolId,
  encodeCLPositionManagerMintCalldata,
  encodeCLPositionManagerIncreaseLiquidityCalldata,
  encodeCLPositionManagerDecreaseLiquidityCalldata,
} from '@pancakeswap/infinity-sdk';
import {
  maxLiquidityForAmount0Precise,
  maxLiquidityForAmount1,
  maxLiquidityForAmounts,
  PositionMath,
  sqrtRatioX96ToPrice,
  TickMath,
  tickToPrice,
} from '@pancakeswap/v3-sdk';
import { invariant } from '../shared/utils/tiny-invariant.js';

/** CL calls pay the hub wallet, and the SDK confirms an MPC-relay message only by a release to its source chain. */
const MPC_RELAY_UNSUPPORTED_MESSAGE =
  'Concentrated liquidity does not support MPC-relay source chains yet; use a supported spoke or the hub';

export type ClMintPositionEventLog = {
  tokenId: bigint;
};

// Pool reward configuration from hook contract
export type PoolRewardConfig = {
  rewardCurrency: Address; // Currency (currency0 or currency1) to use as reward token
  rewardRatePerSecond: bigint; // Amount of reward tokens per second
  lastActionTimestamp: bigint; // Timestamp of last position-affecting action
};

// APY range for concentrated liquidity positions
export type ApyRange = {
  minApy: number; // APY when liquidity is spread across all ticks (wide range)
  maxApy: number; // APY when liquidity is concentrated in 1 tick (narrow range)
};

// Types for concentrated liquidity operations
export type ClSupplyParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tickLower: bigint; // lower tick
  tickUpper: bigint; // upper tick
  liquidity: bigint; // amount of liquidity to add (should be calculated with slippage applied in UI)
  amount0Max: bigint; // max amount of token0 (user's full balance)
  amount1Max: bigint; // max amount of token1 (user's full balance)
  sqrtPriceX96: bigint; // current sqrt price for the pool
};

export type ClSupplyAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClSupplyParams<K>
>;

export type ClGetPoolDataParams = {
  token0: string; // token0 address
  token1: string; // token1 address
  fee: bigint; // fee tier
};

export type ClWithdrawParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  asset: OriginalAssetAddress; // asset address
  amount: bigint; // amount of asset to withdraw
};

export type ClLiquidityWithdrawAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClWithdrawParams<K>
>;

export type ClIncreaseLiquidityParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint; // NFT token ID
  tickLower: bigint; // lower tick
  tickUpper: bigint; // upper tick
  liquidity: bigint; // amount of liquidity to add
  amount0Max: bigint; // maximum amount of token0
  amount1Max: bigint; // maximum amount of token1
  sqrtPriceX96: bigint; // current sqrt price for the pool
};

export type ClLiquidityIncreaseLiquidityAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClIncreaseLiquidityParams<K>
>;

export type ClDecreaseLiquidityParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint; // NFT token ID
  liquidity: bigint; // amount of liquidity to remove
  amount0Min: bigint; // minimum amount of token0
  amount1Min: bigint; // minimum amount of token1
};

export type ClLiquidityDecreaseLiquidityAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClDecreaseLiquidityParams<K>
>;

// Claim rewards parameters
export type ClClaimRewardsParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint; // NFT token ID
  tickLower: bigint; // Lower tick of the position
  tickUpper: bigint; // Upper tick of the position
};

export type ClLiquidityClaimRewardsAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClClaimRewardsParams<K>
>;

// Union type for all concentrated liquidity parameters
export type ConcentratedLiquidityParams<K extends SpokeChainKey> =
  | ClSupplyParams<K>
  | ClIncreaseLiquidityParams<K>
  | ClDecreaseLiquidityParams<K>
  | ClWithdrawParams<K>
  | ClClaimRewardsParams<K>;

export type ClPositionInfo = {
  // Raw position data from PancakeSwap Infinity
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  subscriber: Address;

  // Calculated fields
  amount0: bigint;
  amount1: bigint;
  tickLowerPrice: Price<Token, Token>;
  tickUpperPrice: Price<Token, Token>;

  // Unclaimed fees
  unclaimedFees0: bigint; // Unclaimed fees in token0
  unclaimedFees1: bigint; // Unclaimed fees in token1

  // StatAToken unwrapped amounts (only present if token is a StatAToken)
  amount0Underlying?: bigint; // Underlying asset amount for token0 (if StatAToken)
  amount1Underlying?: bigint; // Underlying asset amount for token1 (if StatAToken)
  unclaimedFees0Underlying?: bigint; // Unclaimed fees in underlying token0 (if StatAToken)
  unclaimedFees1Underlying?: bigint; // Unclaimed fees in underlying token1 (if StatAToken)
};

/**
 * Token data with optional ERC4626 conversion information
 */
export type TokenWithConversion = Token & {
  isStatAToken: boolean; // Whether this token is a StatAToken (ERC4626)
  conversionRate?: bigint; // Conversion rate from wrapped to underlying (1e18 precision)
  underlyingToken?: Token; // Underlying token info (if StatAToken)
};

/**
 * Extended token object with StatAToken metadata
 */
export type EnrichedToken = {
  token: Token;
  isStatAToken: boolean;
  conversionRate?: bigint;
  underlyingToken?: Token;
};

// Token information interface for concentrated liquidity
export interface ConcentratedLiquidityTokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  address: Address;
}

// Pool data interface for UI consumption
export interface PoolData {
  // Pool identification
  poolId: string;
  poolKey: {
    currency0: Address;
    currency1: Address;
    hooks: Address;
    poolManager: Address;
    fee: number;
    parameters: string;
  };

  // Current pool state (from slot0)
  sqrtPriceX96: bigint;
  currentTick: number;
  protocolFee: number;
  lpFee: number;

  // Calculated prices
  price: Price<Token, Token>; // token1/token0

  // Pool liquidity
  totalLiquidity: bigint;

  // Pool fees
  feeTier: number;
  tickSpacing: number;

  // Token information
  token0: Token;
  token1: Token;

  // StatAToken enrichment data (for ERC4626 wrapped tokens)
  token0IsStatAToken: boolean;
  token0ConversionRate?: bigint; // Conversion rate with 1e18 precision (1 share = X underlying)
  token0UnderlyingToken?: Token; // Underlying token (e.g., ETH for aStatETH)
  token1IsStatAToken: boolean;
  token1ConversionRate?: bigint;
  token1UnderlyingToken?: Token;

  // Additional pool metrics
  isActive: boolean;
  createdAt?: number; // Block number when pool was created

  // Reward configuration (if pool has rewards)
  rewardConfig?: PoolRewardConfig;
}

export type PoolSpokeAssets = { token0: XToken; token1: XToken };

export type ClServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Service for concentrated-liquidity pool operations on the SODAX DEX (PancakeSwap Infinity / Uniswap V3-style).
 *
 * All pools live on the Sonic hub chain. Cross-chain users submit a signed message on
 * their spoke chain; the relayer delivers it to the hub where the position manager
 * contract executes the action inside the user's hub wallet abstraction.
 *
 * Responsibilities:
 * - Open new positions (`executeSupplyLiquidity` / `supplyLiquidity`)
 * - Add to existing positions (`executeIncreaseLiquidity` / `increaseLiquidity`)
 * - Remove from positions (`executeDecreaseLiquidity` / `decreaseLiquidity`)
 * - Harvest hook rewards (`executeClaimRewards` / `claimRewards`)
 * - Read pool state and position data (`getPoolData`, `getPositionInfo`, `getPools`)
 * - Uniswap V3 tick/liquidity math helpers (`calculateLiquidityFromAmounts`,
 *   `calculateAmount0FromAmount1`, `calculateAmount1FromAmount0`,
 *   `calculateMaxAmountsForSlippage`, `priceToTick`)
 *
 * The `execute*` variants return an `IntentTxResult` (spoke tx + relay data) so
 * callers can relay manually. The non-prefixed variants (`supplyLiquidity`, etc.)
 * additionally wait for the cross-chain packet to arrive at the hub and return a
 * `TxHashPair` (spoke tx hash + hub tx hash).
 *
 * @namespace SodaxFeatures
 */
export class ClService {
  private readonly relayerApiEndpoint: HttpUrl;
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: ClServiceConstructorParams) {
    this.config = config;
    this.spoke = spoke;
    this.hubProvider = hubProvider;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
  }

  /**
   * Resolve the spoke-chain `XToken` descriptors for both sides of a pool.
   *
   * Translates hub-side pool currency addresses (which are StatAToken / vault-token
   * addresses) back to their original spoke-chain asset representations using the
   * SDK config, so UI layers can display recognisable token symbols and logos.
   *
   * @param srcChainKey - The spoke chain the caller is operating from.
   * @param poolKey - The on-chain pool key identifying the concentrated-liquidity pool.
   * @returns An object with `token0` and `token1` as `XToken` descriptors on the spoke chain.
   * @throws If either currency address cannot be resolved to a known spoke-chain token.
   */
  public getAssetsForPool(srcChainKey: SpokeChainKey, poolKey: PoolKey): PoolSpokeAssets {
    const token0SpokeAddress = this.config.getOriginalAssetAddressFromStakedATokenAddress(
      srcChainKey,
      poolKey.currency0,
    );
    const token1SpokeAddress = this.config.getOriginalAssetAddressFromStakedATokenAddress(
      srcChainKey,
      poolKey.currency1,
    );
    const token0 = this.config.findTokenByOriginalAddress(token0SpokeAddress, srcChainKey);
    const token1 = this.config.findTokenByOriginalAddress(token1SpokeAddress, srcChainKey);

    dexInvariant(token0, `[getAssetsForPool] Token0 ${token0SpokeAddress} not found`);
    dexInvariant(token1, `[getAssetsForPool] Token1 ${token1SpokeAddress} not found`);
    return {
      token0,
      token1,
    };
  }

  /**
   * Build and submit the spoke-side transaction that opens a new concentrated-liquidity position.
   *
   * The method encodes Permit2 approvals for both pool tokens, then encodes a
   * `CLPositionManager.mint` call into a single batched payload. The payload is
   * sent from the spoke chain to the user's hub wallet via `SpokeService.sendMessage`.
   *
   * When `raw` is `true` the signed transaction bytes are returned without broadcasting;
   * when `false` the transaction is broadcast and its hash is returned.
   *
   * @param _params - Action parameters including pool key, tick range, desired liquidity,
   *   maximum token amounts, and current `sqrtPriceX96`.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, contains the spoke-chain tx
   *   (hash or raw bytes depending on `raw`) and the relay data needed to track the
   *   cross-chain packet.
   */
  public async executeSupplyLiquidity<K extends SpokeChainKey, Raw extends boolean>(
    _params: ClSupplyAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>>> {
    const { params, skipSimulation } = _params;
    try {
      dexInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        srcChainKey: params.srcChainKey,
        field: 'srcChainKey',
      });
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const calls: EvmContractCall[] = [];

      const token0Approvals = this.permit2Approve(
        params.poolKey.currency0,
        this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
      );
      calls.push(...token0Approvals);

      const token1Approvals = this.permit2Approve(
        params.poolKey.currency1,
        this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
      );
      calls.push(...token1Approvals);

      const positionConfig: CLPositionConfig = {
        poolKey: params.poolKey,
        tickLower: Number(params.tickLower),
        tickUpper: Number(params.tickUpper),
      };

      const calldata = encodeCLPositionManagerMintCalldata(
        positionConfig,
        params.liquidity,
        hubWallet,
        params.amount0Max,
        params.amount1Max,
        BigInt(2) ** BigInt(256) - BigInt(1),
        '0x',
      );

      const supplyCall: EvmContractCall = {
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        value: 0n,
        data: calldata,
      };

      calls.push(supplyCall);

      const data = encodeContractCalls(calls);
      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
        skipSimulation,
      } as const;

      const sendMessageParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SendMessageParams<K, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        this.config.logger.error('executeSupplyLiquidity error', txResult.error);
        return {
          ok: false,
          error: intentCreationFailed('dex', txResult.error),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      this.config.logger.error('executeSupplyLiquidity error', error);
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /**
   * Parse the `MintPosition` event emitted by the hub's `CLPositionManager` contract.
   *
   * After a `supplyLiquidity` call lands on the hub chain, callers need the NFT
   * `tokenId` that was assigned to the new position. This method waits for the hub
   * transaction receipt and extracts that id from the event log.
   *
   * @param hubTxHash - The transaction hash on the hub chain (Sonic) where the mint was executed.
   * @returns `Result<ClMintPositionEventLog>` — on success, contains `{ tokenId }` (the NFT
   *   token ID of the newly minted position).
   */
  public async getMintPositionEvent(hubTxHash: Hash): Promise<Result<ClMintPositionEventLog>> {
    try {
      const receipt = await this.hubProvider.publicClient.waitForTransactionReceipt({ hash: hubTxHash });
      const logs: MintPositionEventLog[] = parseEventLogs({
        abi: CLPositionManagerAbi,
        eventName: 'MintPosition',
        logs: receipt.logs,
        strict: true,
      });

      const eventLog = logs[0];
      if (!eventLog) {
        return {
          ok: false,
          error: new SodaxError('LOOKUP_FAILED', `No mint position event found for ${hubTxHash}`, {
            feature: 'dex',
            context: { phase: 'lookup', method: 'getMintPositionEvent' },
          }),
        };
      }

      if (!eventLog.args.tokenId) {
        return {
          ok: false,
          error: new SodaxError('LOOKUP_FAILED', `No tokenId found for ${hubTxHash}`, {
            feature: 'dex',
            context: { phase: 'lookup', method: 'getMintPositionEvent' },
          }),
        };
      }

      return { ok: true, value: { tokenId: eventLog.args.tokenId } };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('dex', 'getMintPositionEvent', error),
      };
    }
  }

  /**
   * Build and submit the spoke-side transaction that adds liquidity to an existing position.
   *
   * Encodes a `CLPositionManager.increaseLiquidity` call for the given NFT `tokenId` and
   * delivers it to the hub via `SpokeService.sendMessage`. No Permit2 approvals are
   * re-encoded here — tokens should already be approved from the initial mint.
   *
   * @param _params - Action parameters including the NFT `tokenId`, pool key, tick range,
   *   additional liquidity amount, and maximum token amounts.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, contains the spoke-chain tx
   *   and relay data for cross-chain packet tracking.
   */
  public async executeIncreaseLiquidity<K extends SpokeChainKey, Raw extends boolean>(
    _params: ClLiquidityIncreaseLiquidityAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>>> {
    const { params, skipSimulation } = _params;
    try {
      dexInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        srcChainKey: params.srcChainKey,
        field: 'srcChainKey',
      });
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const calls: EvmContractCall[] = [];

      const positionConfig: CLPositionConfig = {
        poolKey: params.poolKey,
        tickLower: Number(params.tickLower),
        tickUpper: Number(params.tickUpper),
      };

      const calldata = encodeCLPositionManagerIncreaseLiquidityCalldata(
        params.tokenId,
        positionConfig,
        params.liquidity,
        params.amount0Max,
        params.amount1Max,
        hubWallet, // recipient
        '0x', // no hook data
        BigInt(2) ** BigInt(256) - BigInt(1), // maxUint256 deadline
      );

      const increaseCall: EvmContractCall = {
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        value: 0n,
        data: calldata,
      };

      calls.push(increaseCall);

      // Execute the transaction

      const data: Hex = encodeContractCalls(calls);

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
        skipSimulation,
      } as const;

      const sendMessageParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SendMessageParams<K, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        return {
          ok: false,
          error: intentCreationFailed('dex', txResult.error),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: encodeContractCalls(calls) },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /**
   * Build and submit the spoke-side transaction that removes liquidity from an existing position.
   *
   * Encodes a `CLPositionManager.decreaseLiquidity` call for the given NFT `tokenId` and
   * delivers it to the hub via `SpokeService.sendMessage`. Fees accumulated in the
   * position are automatically collected as part of the decrease operation by the
   * position manager contract.
   *
   * @param _params - Action parameters including the NFT `tokenId`, pool key, liquidity to
   *   remove, and minimum token amounts (slippage protection).
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, contains the spoke-chain tx
   *   and relay data for cross-chain packet tracking.
   */
  public async executeDecreaseLiquidity<K extends SpokeChainKey, Raw extends boolean>(
    _params: ClLiquidityDecreaseLiquidityAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>>> {
    const { params, skipSimulation } = _params;
    try {
      dexInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        srcChainKey: params.srcChainKey,
        field: 'srcChainKey',
      });
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const calls: EvmContractCall[] = [];

      const calldata = encodeCLPositionManagerDecreaseLiquidityCalldata({
        tokenId: params.tokenId,
        poolKey: params.poolKey,
        liquidity: params.liquidity,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        recipient: hubWallet,
        hookData: '0x',
        deadline: BigInt(2) ** BigInt(256) - BigInt(1), // maxUint256
      });

      const decreaseCall: EvmContractCall = {
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        value: 0n,
        data: calldata,
      };

      calls.push(decreaseCall);

      const data = encodeContractCalls(calls);

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
        skipSimulation,
      } as const;

      const sendMessageParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SendMessageParams<K, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        return {
          ok: false,
          error: intentCreationFailed('dex', txResult.error),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /**
   * Encode the two on-chain calls required to grant a contract Permit2-gated access to a token.
   *
   * The position manager uses Permit2 for token pulls. Before minting, the hub wallet must:
   * 1. Grant the position manager a Permit2 allowance (amount + expiry) via the Permit2 singleton.
   * 2. Approve the Permit2 singleton contract to spend the ERC-20 token (standard `approve`).
   *
   * Both calls are returned as `EvmContractCall` objects ready to be batched with
   * `encodeContractCalls` into a single multicall payload.
   *
   * @param token - The ERC-20 token address to approve.
   * @param contract - The contract (typically the CL position manager) to whitelist via Permit2.
   * @returns An array of two `EvmContractCall` entries: `[permit2Approve, erc20Approve]`.
   */
  public permit2Approve(token: Address, contract: Address): EvmContractCall[] {
    const calls: EvmContractCall[] = [];

    const permit2Call = Permit2Service.encodeApprove(
      this.config.sodaxConfig.dex.concentratedLiquidityConfig.permit2,
      token,
      contract,
      maxUint160,
      Number(maxUint48),
    );
    calls.push(permit2Call);

    const erc20Call = Erc20Service.encodeApprove(
      token,
      this.config.sodaxConfig.dex.concentratedLiquidityConfig.permit2,
      maxUint160,
    );
    calls.push(erc20Call);

    return calls;
  }

  /**
   * Open a new concentrated-liquidity position and wait for the cross-chain relay to complete.
   *
   * Calls `executeSupplyLiquidity` to broadcast on the spoke chain, then blocks until
   * the relayer delivers the packet to the hub (or the optional timeout elapses).
   * When the source is the hub chain itself the relay step is skipped.
   *
   * @param _params - Action parameters including pool key, tick range, liquidity, max amounts,
   *   and an optional `timeout` (ms) for the relay wait.
   * @returns `Result<TxHashPair>` — on success, contains `srcChainTxHash` (spoke) and
   *   `dstChainTxHash` (hub) once the packet has been confirmed.
   */
  public async supplyLiquidity<K extends SpokeChainKey>(
    _params: ClSupplyAction<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.config.analytics.trackResult(
      'dex',
      'supplyLiquidity',
      async () => {
        const { params, timeout } = _params;
        try {
          const txResult = await this.executeSupplyLiquidity(_params);

          if (!txResult.ok) {
            return txResult;
          }

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout: timeout,
            });

            if (!packetResult.ok) return packetResult;

            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          this.config.logger.error('supplyLiquidity error', error);
          if (isDexCreateIntentError(error)) return { ok: false, error };
          return { ok: false, error: intentCreationFailed('dex', error) };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          currency0: _params.params.poolKey.currency0,
          currency1: _params.params.poolKey.currency1,
          fee: _params.params.poolKey.fee,
          tickLower: _params.params.tickLower,
          tickUpper: _params.params.tickUpper,
          liquidity: _params.params.liquidity,
          amount0Max: _params.params.amount0Max,
          amount1Max: _params.params.amount1Max,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Add liquidity to an existing position and wait for the cross-chain relay to complete.
   *
   * Calls `executeIncreaseLiquidity` to broadcast on the spoke chain, then blocks until
   * the relayer delivers the packet to the hub (or the optional timeout elapses).
   * When the source is the hub chain itself the relay step is skipped.
   *
   * @param _params - Action parameters including the NFT `tokenId`, pool key, tick range,
   *   additional liquidity, max token amounts, and an optional `timeout` (ms).
   * @returns `Result<TxHashPair>` — on success, contains `srcChainTxHash` (spoke) and
   *   `dstChainTxHash` (hub) once the packet has been confirmed.
   */
  public async increaseLiquidity<K extends SpokeChainKey>(
    _params: ClLiquidityIncreaseLiquidityAction<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.config.analytics.trackResult(
      'dex',
      'increaseLiquidity',
      async () => {
        const { params, timeout } = _params;
        try {
          const txResult = await this.executeIncreaseLiquidity(_params);

          if (!txResult.ok) {
            return txResult;
          }

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout: timeout,
            });

            if (!packetResult.ok) return packetResult;

            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isDexCreateIntentError(error)) return { ok: false, error };
          return { ok: false, error: intentCreationFailed('dex', error) };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          currency0: _params.params.poolKey.currency0,
          currency1: _params.params.poolKey.currency1,
          fee: _params.params.poolKey.fee,
          tokenId: _params.params.tokenId,
          tickLower: _params.params.tickLower,
          tickUpper: _params.params.tickUpper,
          liquidity: _params.params.liquidity,
          amount0Max: _params.params.amount0Max,
          amount1Max: _params.params.amount1Max,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Remove liquidity from an existing position and wait for the cross-chain relay to complete.
   *
   * Calls `executeDecreaseLiquidity` to broadcast on the spoke chain, then blocks until
   * the relayer delivers the packet to the hub (or the optional timeout elapses).
   * When the source is the hub chain itself the relay step is skipped.
   *
   * @param _params - Action parameters including the NFT `tokenId`, pool key, liquidity to
   *   remove, minimum token amounts, and an optional `timeout` (ms).
   * @returns `Result<TxHashPair>` — on success, contains `srcChainTxHash` (spoke) and
   *   `dstChainTxHash` (hub) once the packet has been confirmed.
   */
  public async decreaseLiquidity<K extends SpokeChainKey>(
    _params: ClLiquidityDecreaseLiquidityAction<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.config.analytics.trackResult(
      'dex',
      'decreaseLiquidity',
      async () => {
        const { params, timeout } = _params;
        try {
          const txResult = await this.executeDecreaseLiquidity(_params);

          if (!txResult.ok) {
            return txResult;
          }

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout: timeout,
            });

            if (!packetResult.ok) return packetResult;

            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isDexCreateIntentError(error)) return { ok: false, error };
          return { ok: false, error: intentCreationFailed('dex', error) };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          currency0: _params.params.poolKey.currency0,
          currency1: _params.params.poolKey.currency1,
          fee: _params.params.poolKey.fee,
          tokenId: _params.params.tokenId,
          liquidity: _params.params.liquidity,
          amount0Min: _params.params.amount0Min,
          amount1Min: _params.params.amount1Min,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Fetch the reward configuration stored in the pool's hook contract.
   *
   * Pools that use a reward hook expose a `poolRewardConfigs(bytes32)` mapping.
   * This method reads that mapping and returns the rate and token used for
   * liquidity-mining rewards. Returns an error result if the pool has no hook
   * or the hook does not expose the expected interface.
   *
   * @param poolKey - The pool key; its `hooks` field must be a non-zero address.
   * @param publicClient - A viem public client connected to the hub chain (Sonic).
   * @returns `Result<PoolRewardConfig>` — on success, contains the reward token address,
   *   reward rate per second, and the timestamp of the last position-affecting action.
   */
  public async getPoolRewardConfig(poolKey: PoolKey, publicClient: PublicClient): Promise<Result<PoolRewardConfig>> {
    try {
      const hookAddress = poolKey.hooks;

      if (!hookAddress || hookAddress === '0x' || hookAddress === '0x0000000000000000000000000000000000000000') {
        return {
          ok: false,
          error: new SodaxError('VALIDATION_FAILED', 'Pool has no hook configured', {
            feature: 'dex',
            context: { phase: 'validate', field: 'poolKey.hooks' },
          }),
        };
      }

      const poolId = getPoolId(poolKey);

      // ABI for reading poolRewardConfigs mapping from hook contract
      const poolRewardConfigsAbi = [
        {
          inputs: [{ name: 'poolId', type: 'bytes32' }],
          name: 'poolRewardConfigs',
          outputs: [
            { name: 'rewardCurrency', type: 'address' },
            { name: 'rewardRatePerSecond', type: 'uint256' },
            { name: 'lastActionTimestamp', type: 'uint256' },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ] as const;

      const result = await publicClient.readContract({
        address: hookAddress,
        abi: poolRewardConfigsAbi,
        functionName: 'poolRewardConfigs',
        args: [poolId],
      });

      const [rewardCurrency, rewardRatePerSecond, lastActionTimestamp] = result;

      return {
        ok: true,
        value: {
          rewardCurrency: rewardCurrency,
          rewardRatePerSecond,
          lastActionTimestamp,
        },
      };
    } catch (error) {
      this.config.logger.error('getPoolRewardConfig error', error);
      return {
        ok: false,
        error: lookupFailed('dex', 'getPoolRewardConfig', error),
      };
    }
  }

  /**
   * Build and submit the spoke-side transaction that harvests hook rewards for a position.
   *
   * The PancakeSwap Infinity hook distributes rewards whenever a position-affecting call
   * is made. To harvest without changing the position size this method encodes a
   * `decreaseLiquidity` call with `liquidity = 0`, which triggers reward accounting
   * without actually removing any liquidity.
   *
   * @param _params - Action parameters including the NFT `tokenId`, pool key, and tick range.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, contains the spoke-chain tx
   *   and relay data for cross-chain packet tracking.
   */
  public async executeClaimRewards<K extends SpokeChainKey, Raw extends boolean>(
    _params: ClLiquidityClaimRewardsAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>>> {
    const { params, skipSimulation } = _params;
    try {
      dexInvariant(!isMpcRelayChainKey(params.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
        srcChainKey: params.srcChainKey,
        field: 'srcChainKey',
      });
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);
      const calls: EvmContractCall[] = [];

      // Call decrease liquidity with 0 liquidity to trigger reward distribution
      const calldata = encodeCLPositionManagerDecreaseLiquidityCalldata({
        tokenId: params.tokenId,
        poolKey: params.poolKey,
        liquidity: 0n, // 0 liquidity to only claim rewards
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: hubWallet,
        hookData: '0x',
        deadline: BigInt(2) ** BigInt(256) - BigInt(1), // maxUint256
      });

      const claimCall: EvmContractCall = {
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        value: 0n,
        data: calldata,
      };

      calls.push(claimCall);

      // Execute the transaction
      const data: Hex = encodeContractCalls(calls);
      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
        skipSimulation,
      } as const;

      const sendMessageParams = _params.raw
        ? ({
            ...coreParams,
            raw: true,
          } satisfies SendMessageParams<K, true>)
        : ({
            ...coreParams,
            raw: false,
            walletProvider: _params.walletProvider,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        this.config.logger.error('executeClaimRewards error', txResult.error);
        return {
          ok: false,
          error: intentCreationFailed('dex', txResult.error),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      this.config.logger.error('executeClaimRewards error', error);
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /**
   * Harvest hook rewards for a position and wait for the cross-chain relay to complete.
   *
   * Calls `executeClaimRewards` to broadcast on the spoke chain, then blocks until
   * the relayer delivers the packet to the hub (or the optional timeout elapses).
   * When the source is the hub chain itself the relay step is skipped.
   *
   * @param _params - Action parameters including the NFT `tokenId`, pool key, tick range,
   *   and an optional `timeout` (ms) for the relay wait.
   * @returns `Result<TxHashPair>` — on success, contains `srcChainTxHash` (spoke) and
   *   `dstChainTxHash` (hub) once the packet has been confirmed.
   */
  public async claimRewards<K extends SpokeChainKey>(
    _params: ClLiquidityClaimRewardsAction<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.config.analytics.trackResult(
      'dex',
      'claimRewards',
      async () => {
        const { params, timeout } = _params;
        try {
          const txResult = await this.executeClaimRewards(_params);

          if (!txResult.ok) {
            return txResult;
          }

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout: timeout,
            });

            if (!packetResult.ok) return packetResult;

            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          this.config.logger.error('claimRewards error', error);
          if (isDexCreateIntentError(error)) return { ok: false, error };
          return { ok: false, error: intentCreationFailed('dex', error) };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          currency0: _params.params.poolKey.currency0,
          currency1: _params.params.poolKey.currency1,
          fee: _params.params.poolKey.fee,
          tokenId: _params.params.tokenId,
          tickLower: _params.params.tickLower,
          tickUpper: _params.params.tickUpper,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: isSodaxError(error) ? error.code : undefined }),
      },
    );
  }

  /**
   * Return the list of configured concentrated-liquidity pool keys for the SODAX DEX.
   *
   * Pool keys are sourced from the SDK's `ConfigService` (fetched from the backend API
   * or falling back to static defaults). Each `PoolKey` uniquely identifies a pool by
   * its two currencies, fee tier, hook address, and pool manager address.
   *
   * @returns An array of `PoolKey` objects, one per configured DEX pool.
   */
  public getPools(): PoolKey[] {
    return this.config.getDexPools();
  }

  /**
   * Fetch token information (symbol, name, decimals) from ERC20 contract
   */
  private async getTokenInfo(
    tokenAddress: Address,
    publicClient: PublicClient,
  ): Promise<ConcentratedLiquidityTokenInfo> {
    try {
      const [symbol, name, decimals] = await Promise.all([
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'name',
        }),
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
      ]);

      return {
        symbol,
        name,
        decimals,
        address: tokenAddress,
      };
    } catch (error) {
      this.config.logger.error(`Failed to fetch token info for ${tokenAddress}`, error);
      // Return fallback info if contract calls fail
      return {
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18,
        address: tokenAddress,
      };
    }
  }

  /**
   * Check if a token address is a StatAToken (ERC4626 wrapped token)
   */
  private isStatAToken(tokenAddress: Address): boolean {
    const normalizedAddress =
      tokenAddress.toLowerCase() as keyof typeof this.config.sodaxConfig.dex.statATokenAddresses;
    return normalizedAddress in this.config.sodaxConfig.dex.statATokenAddresses;
  }

  /**
   * Get conversion rate for a StatAToken (1 share = X underlying assets)
   * Returns conversion rate with 1e18 precision
   */
  private async getStatATokenConversionRate(statATokenAddress: Address): Promise<bigint> {
    try {
      // Get conversion rate: how much underlying per 1 share (1e18)
      const oneShare = BigInt(10 ** 18); // 1 share
      const result = await Erc4626Service.convertToAssets(statATokenAddress, oneShare, this.hubProvider.publicClient);
      if (!result.ok) {
        this.config.logger.error('[getStatATokenConversionRate] Failed to get conversion rate', result.error);
        return oneShare; // Return 1:1 as fallback
      }
      return result.value;
    } catch (error) {
      this.config.logger.error('[getStatATokenConversionRate] Error', error);
      return BigInt(10 ** 18); // Return 1:1 as fallback
    }
  }

  /**
   * Get enriched token data with StatAToken conversion information
   */
  private async getTokenEnrichmentData(token: Token, publicClient: PublicClient): Promise<EnrichedToken> {
    const isStatAToken = this.isStatAToken(token.address);

    if (!isStatAToken) {
      return {
        token,
        isStatAToken: false,
      };
    }

    try {
      const normalizedAddress =
        token.address.toLowerCase() as keyof typeof this.config.sodaxConfig.dex.statATokenAddresses;
      const underlyingVaultAddress = this.config.sodaxConfig.dex.statATokenAddresses[normalizedAddress];

      invariant(underlyingVaultAddress, `Underlying vault address is undefined for ${normalizedAddress}`);

      const [conversionRate, underlyingInfo] = await Promise.all([
        this.getStatATokenConversionRate(token.address),
        this.getTokenInfo(underlyingVaultAddress, publicClient),
      ]);
      const underlyingToken = new Token(
        146,
        underlyingVaultAddress,
        underlyingInfo.decimals,
        underlyingInfo.symbol,
        underlyingInfo.name,
      );

      return {
        token,
        isStatAToken: true,
        conversionRate,
        underlyingToken,
      };
    } catch (error) {
      this.config.logger.error(`[getTokenEnrichmentData] Failed to enrich token ${token.address}`, error);
      return {
        token,
        isStatAToken: true,
      };
    }
  }

  /**
   * Fetch comprehensive real-time state for a concentrated-liquidity pool.
   *
   * Makes several `eth_call` reads against the hub chain in parallel:
   * `slot0` (price / tick / fees), token metadata, total liquidity, and — when the
   * pool has a hook — the reward configuration. For tokens that are StatATokens
   * (ERC-4626 interest-bearing wrappers), the method also fetches the current
   * conversion rate and underlying token info so UIs can display human-readable values.
   *
   * @param poolKey - The pool key identifying the CL pool on the hub chain.
   * @param publicClient - A viem public client connected to the hub chain (Sonic).
   * @returns `Result<PoolData>` — on success, contains current price, tick, liquidity,
   *   fee tiers, token metadata with optional StatAToken enrichment, and optional
   *   reward configuration. `isActive` is `true` when `sqrtPriceX96 > 0`.
   */
  public async getPoolData(poolKey: PoolKey<'CL'>, publicClient: PublicClient): Promise<Result<PoolData>> {
    try {
      // Get pool ID
      const poolId = getPoolId(poolKey);
      // Get slot0 data using the pool manager contract
      const slot0Data = await publicClient.readContract({
        address: poolKey.poolManager,
        abi: CLPoolManagerAbi,
        functionName: 'getSlot0',
        args: [poolId],
      });

      // Destructure slot0 data
      const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0Data;

      const [token0, token1] = await Promise.all([
        this.getTokenInfo(poolKey.currency0, publicClient),
        this.getTokenInfo(poolKey.currency1, publicClient),
      ]);

      const currency0 = new Token(146, poolKey.currency0, token0.decimals, token0.symbol, token0.name);
      const currency1 = new Token(146, poolKey.currency1, token1.decimals, token1.symbol, token1.name);

      // Get StatAToken enrichment data for both tokens
      const [enrichment0, enrichment1] = await Promise.all([
        this.getTokenEnrichmentData(currency0, publicClient),
        this.getTokenEnrichmentData(currency1, publicClient),
      ]);

      // Calculate current prices from sqrtPriceX96
      const price = sqrtRatioX96ToPrice(sqrtPriceX96, currency0, currency1);

      // Get total liquidity from the pool
      let totalLiquidity = 0n;
      // Try to get liquidity from the pool manager
      const liquidityResult = await publicClient.readContract({
        address: poolKey.poolManager,
        abi: [
          {
            inputs: [{ name: 'poolId', type: 'bytes32' }],
            name: 'getLiquidity',
            outputs: [{ name: 'liquidity', type: 'uint128' }],
            stateMutability: 'view',
            type: 'function',
          },
        ],
        functionName: 'getLiquidity',
        args: [poolId],
      });
      totalLiquidity = liquidityResult;

      // Extract fee tier and tick spacing
      const feeTier = poolKey.fee;

      // For now, we'll decode it or use a default based on fee tier
      const tickSpacing = poolKey.parameters.tickSpacing; // Default tick spacing

      // Fetch reward configuration if pool has a hook
      let rewardConfig: PoolRewardConfig | undefined;

      const hookAddress = poolKey.hooks;
      if (hookAddress && hookAddress !== '0x' && hookAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          const rewardConfigResult = await this.getPoolRewardConfig(poolKey, publicClient);
          if (rewardConfigResult.ok && rewardConfigResult.value.rewardRatePerSecond > 0n) {
            rewardConfig = rewardConfigResult.value;
          }
        } catch (error) {
          // Silently fail if reward config can't be fetched - pool might not have rewards
          this.config.logger.warn('Failed to fetch reward config for pool', { error });
        }
      }

      return {
        ok: true,
        value: {
          poolId,
          poolKey: {
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            hooks: poolKey.hooks ?? '0x',
            poolManager: poolKey.poolManager,
            fee: poolKey.fee,
            parameters: typeof poolKey.parameters === 'string' ? poolKey.parameters : '0x',
          },
          sqrtPriceX96,
          currentTick: tick,
          protocolFee,
          lpFee,
          price,
          totalLiquidity,
          feeTier,
          tickSpacing,
          token0: currency0,
          token1: currency1,
          isActive: sqrtPriceX96 > 0n,
          token0IsStatAToken: enrichment0.isStatAToken,
          token0ConversionRate: enrichment0.conversionRate,
          token0UnderlyingToken: enrichment0.underlyingToken,
          token1IsStatAToken: enrichment1.isStatAToken,
          token1ConversionRate: enrichment1.conversionRate,
          token1UnderlyingToken: enrichment1.underlyingToken,
          rewardConfig,
        },
      };
    } catch (error) {
      this.config.logger.error('Failed to fetch pool data', error);
      return {
        ok: false,
        error: lookupFailed('dex', 'getPoolData', error),
      };
    }
  }

  /**
   * Fetch full details for a concentrated-liquidity position NFT.
   *
   * Reads position data from the `CLPositionManager`, fetches current pool state
   * via `getPoolData`, and then computes:
   * - Token amounts currently held by the position (via `PositionMath`)
   * - Unclaimed fees using the Uniswap V3 fee-growth accounting formula
   * - If either token is a StatAToken, the equivalent underlying asset amounts
   *   and fees (converted via the ERC-4626 share rate)
   *
   * @param tokenId - The NFT token ID assigned to the position at mint time.
   * @param publicClient - A viem public client connected to the hub chain (Sonic).
   * @returns `Result<ClPositionInfo>` — on success, contains tick range, liquidity,
   *   current token amounts, tick-boundary prices, unclaimed fees, and optional
   *   underlying amounts for StatAToken pools.
   */
  public async getPositionInfo(tokenId: bigint, publicClient: PublicClient): Promise<Result<ClPositionInfo>> {
    try {
      // Read position data from the position manager using PancakeSwap SDK ABI
      const positionData = await publicClient.readContract({
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        abi: CLPositionManagerAbi,
        functionName: 'positions',
        args: [tokenId],
      });

      // Extract position data from the PancakeSwap Infinity positions structure:
      // Returns: (PoolKey poolKey, int24 tickLower, int24 tickUpper, uint128 liquidity,
      //           uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, ICLSubscriber _subscriber)
      const [
        encodedPoolKey,
        tickLower,
        tickUpper,
        liquidity,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
        subscriber,
      ] = positionData;
      const poolKey = decodePoolKey(encodedPoolKey, 'CL') as PoolKey<'CL'>;

      // Get pool data to get current tick and token decimals
      const poolDataResult = await this.getPoolData(poolKey, publicClient);
      if (!poolDataResult.ok) return poolDataResult;
      const poolData = poolDataResult.value;

      const tokenAmount0 = PositionMath.getToken0Amount(
        poolData.currentTick,
        tickLower,
        tickUpper,
        poolData.sqrtPriceX96,
        liquidity,
      );
      const tokenAmount1 = PositionMath.getToken1Amount(
        poolData.currentTick,
        tickLower,
        tickUpper,
        poolData.sqrtPriceX96,
        liquidity,
      );

      // Calculate unclaimed fees using fee growth globals and tick data
      // Get the pool ID for contract calls
      const poolId = getPoolId(poolKey);

      // Get global fee growth from pool manager
      const feeGrowthGlobals = await publicClient.readContract({
        address: poolKey.poolManager,
        abi: CLPoolManagerAbi,
        functionName: 'getFeeGrowthGlobals',
        args: [poolId],
      });

      const [feeGrowthGlobal0X128, feeGrowthGlobal1X128] = feeGrowthGlobals;

      // Get tick info for lower and upper ticks
      const [tickLowerInfo, tickUpperInfo] = await Promise.all([
        publicClient.readContract({
          address: poolKey.poolManager,
          abi: CLPoolManagerAbi,
          functionName: 'getPoolTickInfo',
          args: [poolId, tickLower],
        }),
        publicClient.readContract({
          address: poolKey.poolManager,
          abi: CLPoolManagerAbi,
          functionName: 'getPoolTickInfo',
          args: [poolId, tickUpper],
        }),
      ]);

      const feeGrowthOutside0X128Lower = tickLowerInfo.feeGrowthOutside0X128;
      const feeGrowthOutside1X128Lower = tickLowerInfo.feeGrowthOutside1X128;
      const feeGrowthOutside0X128Upper = tickUpperInfo.feeGrowthOutside0X128;
      const feeGrowthOutside1X128Upper = tickUpperInfo.feeGrowthOutside1X128;

      // Calculate fee growth inside the position's tick range
      // If current tick is below the position, all fee growth is "above"
      // If current tick is inside the position, we use the standard formula
      // If current tick is above the position, all fee growth is "below"
      let feeGrowthInside0X128: bigint;
      let feeGrowthInside1X128: bigint;

      if (poolData.currentTick < tickLower) {
        // Current tick is below the position
        feeGrowthInside0X128 = feeGrowthOutside0X128Lower - feeGrowthOutside0X128Upper;
        feeGrowthInside1X128 = feeGrowthOutside1X128Lower - feeGrowthOutside1X128Upper;
      } else if (poolData.currentTick < tickUpper) {
        // Current tick is inside the position
        feeGrowthInside0X128 = feeGrowthGlobal0X128 - feeGrowthOutside0X128Lower - feeGrowthOutside0X128Upper;
        feeGrowthInside1X128 = feeGrowthGlobal1X128 - feeGrowthOutside1X128Lower - feeGrowthOutside1X128Upper;
      } else {
        // Current tick is above the position
        feeGrowthInside0X128 = feeGrowthOutside0X128Upper - feeGrowthOutside0X128Lower;
        feeGrowthInside1X128 = feeGrowthOutside1X128Upper - feeGrowthOutside1X128Lower;
      }

      // Calculate unclaimed fees
      // Formula: (currentFeeGrowthInside - feeGrowthInsideLastX128) * liquidity / 2^128
      const Q128 = BigInt(2) ** BigInt(128);

      // Handle potential underflow with modular arithmetic
      const feeGrowthDelta0 = (feeGrowthInside0X128 - feeGrowthInside0LastX128 + (Q128 << 128n)) % (Q128 << 128n);
      const feeGrowthDelta1 = (feeGrowthInside1X128 - feeGrowthInside1LastX128 + (Q128 << 128n)) % (Q128 << 128n);

      const unclaimedFees0 = (feeGrowthDelta0 * liquidity) / Q128;
      const unclaimedFees1 = (feeGrowthDelta1 * liquidity) / Q128;

      // Calculate underlying amounts if tokens are StatATokens
      let amount0Underlying: bigint | undefined;
      let amount1Underlying: bigint | undefined;
      let unclaimedFees0Underlying: bigint | undefined;
      let unclaimedFees1Underlying: bigint | undefined;

      if (poolData.token0IsStatAToken && poolData.token0ConversionRate) {
        // Convert wrapped amount to underlying amount
        // conversionRate is how much underlying per 1e18 shares
        amount0Underlying = (tokenAmount0 * poolData.token0ConversionRate) / BigInt(10 ** 18);
        unclaimedFees0Underlying = (unclaimedFees0 * poolData.token0ConversionRate) / BigInt(10 ** 18);
      }

      if (poolData.token1IsStatAToken && poolData.token1ConversionRate) {
        // Convert wrapped amount to underlying amount
        amount1Underlying = (tokenAmount1 * poolData.token1ConversionRate) / BigInt(10 ** 18);
        unclaimedFees1Underlying = (unclaimedFees1 * poolData.token1ConversionRate) / BigInt(10 ** 18);
      }

      return {
        ok: true,
        value: {
          poolKey,
          tickLower,
          tickUpper,
          liquidity,
          feeGrowthInside0LastX128,
          feeGrowthInside1LastX128,
          subscriber,
          amount0: tokenAmount0,
          amount1: tokenAmount1,
          unclaimedFees0,
          unclaimedFees1,
          tickLowerPrice: tickToPrice(poolData.token0, poolData.token1, tickLower),
          tickUpperPrice: tickToPrice(poolData.token0, poolData.token1, tickUpper),
          ...(amount0Underlying !== undefined && { amount0Underlying }),
          ...(amount1Underlying !== undefined && { amount1Underlying }),
          ...(unclaimedFees0Underlying !== undefined && { unclaimedFees0Underlying }),
          ...(unclaimedFees1Underlying !== undefined && { unclaimedFees1Underlying }),
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: lookupFailed('dex', 'getPositionInfo', error),
      };
    }
  }

  /**
   * Compute the maximum liquidity achievable given both token input amounts.
   *
   * Applies Uniswap V3 math: when only one token amount is non-zero the
   * single-sided formula is used; otherwise `maxLiquidityForAmounts` selects
   * the binding constraint. Intended for UI: call this to obtain the `liquidity`
   * value required by `executeSupplyLiquidity` / `executeIncreaseLiquidity`.
   *
   * @param amount0 - Available amount of token0 (in token0's raw decimals).
   * @param amount1 - Available amount of token1 (in token1's raw decimals).
   * @param tickLower - Lower tick boundary of the target position.
   * @param tickUpper - Upper tick boundary of the target position.
   * @param currentTick - Current active tick of the pool.
   * @returns The liquidity `bigint` that can be minted with the given amounts.
   */
  public static calculateLiquidityFromAmounts(
    amount0: bigint,
    amount1: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    currentTick: bigint,
  ): bigint {
    const sqrtRatioX96Lower = TickMath.getSqrtRatioAtTick(Number(tickLower));
    const sqrtRatioX96Upper = TickMath.getSqrtRatioAtTick(Number(tickUpper));
    const sqrtRatioX96Current = TickMath.getSqrtRatioAtTick(Number(currentTick));
    if (amount0 === 0n) {
      return maxLiquidityForAmount0Precise(sqrtRatioX96Lower, sqrtRatioX96Upper, amount0);
    }
    if (amount1 === 0n) {
      return maxLiquidityForAmount1(sqrtRatioX96Lower, sqrtRatioX96Upper, amount1);
    }
    return maxLiquidityForAmounts(sqrtRatioX96Current, sqrtRatioX96Lower, sqrtRatioX96Upper, amount0, amount1, true);
  }

  /**
   * Compute the token1 amount paired with a given token0 amount for a position.
   *
   * Derives the required liquidity from `amount0` alone (treating token1 as
   * unconstrained), then applies `PositionMath.getToken1Amount` to find how much
   * token1 that liquidity requires at the current price. Useful for "lock token0,
   * derive token1" UX flows.
   *
   * @param amount0 - Desired token0 input amount.
   * @param tickLower - Lower tick boundary of the position.
   * @param tickUpper - Upper tick boundary of the position.
   * @param currentTick - Current active tick of the pool.
   * @param sqrtPriceX96 - Current `sqrtPriceX96` of the pool (Q64.96 fixed-point).
   * @returns The token1 amount required to pair with `amount0` at the current price.
   */
  public static calculateAmount1FromAmount0(
    amount0: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    currentTick: bigint,
    sqrtPriceX96: bigint,
  ): bigint {
    if (amount0 === 0n) return 0n;

    const sqrtRatioX96Lower = TickMath.getSqrtRatioAtTick(Number(tickLower));
    const sqrtRatioX96Upper = TickMath.getSqrtRatioAtTick(Number(tickUpper));

    // Calculate liquidity using only amount0 (use a very large value for amount1 to not constrain)
    const liquidity = maxLiquidityForAmounts(
      sqrtPriceX96,
      sqrtRatioX96Lower,
      sqrtRatioX96Upper,
      amount0,
      BigInt('0xffffffffffffffffffffffffffffffff'), // max uint128
      true,
    );

    // Calculate amount1 from liquidity using PositionMath
    const amount1 = PositionMath.getToken1Amount(
      Number(currentTick),
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96,
      liquidity,
    );

    return amount1;
  }

  /**
   * Compute the token0 amount paired with a given token1 amount for a position.
   *
   * Mirror of `calculateAmount1FromAmount0`: derives liquidity from `amount1` alone
   * (treating token0 as unconstrained), then applies `PositionMath.getToken0Amount`.
   * Useful for "lock token1, derive token0" UX flows.
   *
   * @param amount1 - Desired token1 input amount.
   * @param tickLower - Lower tick boundary of the position.
   * @param tickUpper - Upper tick boundary of the position.
   * @param currentTick - Current active tick of the pool.
   * @param sqrtPriceX96 - Current `sqrtPriceX96` of the pool (Q64.96 fixed-point).
   * @returns The token0 amount required to pair with `amount1` at the current price.
   */
  public static calculateAmount0FromAmount1(
    amount1: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    currentTick: bigint,
    sqrtPriceX96: bigint,
  ): bigint {
    if (amount1 === 0n) return 0n;

    const sqrtRatioX96Lower = TickMath.getSqrtRatioAtTick(Number(tickLower));
    const sqrtRatioX96Upper = TickMath.getSqrtRatioAtTick(Number(tickUpper));

    // Calculate liquidity using only amount1 (use a very large value for amount0 to not constrain)
    const liquidity = maxLiquidityForAmounts(
      sqrtPriceX96,
      sqrtRatioX96Lower,
      sqrtRatioX96Upper,
      BigInt('0xffffffffffffffffffffffffffffffff'), // max uint128
      amount1,
      true,
    );

    // Calculate amount0 from liquidity using PositionMath
    const amount0 = PositionMath.getToken0Amount(
      Number(currentTick),
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96,
      liquidity,
    );

    return amount0;
  }

  /**
   * Compute worst-case `amount0Max` and `amount1Max` for a given liquidity and slippage tolerance.
   *
   * For concentrated liquidity a price drop increases the token0 requirement while a
   * price rise increases the token1 requirement. This helper applies the slippage
   * percentage to `sqrtPriceX96` in both directions (using integer square-root math to
   * preserve all 160 bits of precision) and returns the maximum of the current and
   * slipped amounts for each token independently.
   *
   * Pass the returned values directly as `amount0Max` / `amount1Max` in
   * `ClSupplyParams` or `ClIncreaseLiquidityParams`.
   *
   * @param liquidity - The liquidity amount for which to compute max token inputs.
   * @param tickLower - Lower tick boundary of the position.
   * @param tickUpper - Upper tick boundary of the position.
   * @param currentTick - Current active tick of the pool.
   * @param sqrtPriceX96 - Current `sqrtPriceX96` of the pool (Q64.96 fixed-point).
   * @param slippagePercent - Slippage tolerance as a percentage (e.g. `0.5` for 0.5 %).
   * @returns `{ amount0Max, amount1Max }` — worst-case token inputs after applying slippage.
   */
  public static calculateMaxAmountsForSlippage(
    liquidity: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    currentTick: bigint,
    sqrtPriceX96: bigint,
    slippagePercent: number,
  ): { amount0Max: bigint; amount1Max: bigint } {
    // Calculate amounts at the current price
    const amount0AtCurrent = PositionMath.getToken0Amount(
      Number(currentTick),
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96,
      liquidity,
    );
    const amount1AtCurrent = PositionMath.getToken1Amount(
      Number(currentTick),
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96,
      liquidity,
    );

    // Apply slippage using integer math so we keep all ~160 bits of sqrtPriceX96.
    // Identity: sqrtPriceX96 * sqrt(1 ± s) = sqrt(sqrtPriceX96² * (SCALE ± scaled) / SCALE)
    const SLIPPAGE_SCALE = 1_000_000_000n;
    const slippageScaled = BigInt(Math.round((slippagePercent * Number(SLIPPAGE_SCALE)) / 100));
    const sqrtPriceX96Squared = sqrtPriceX96 * sqrtPriceX96;

    const sqrtPriceX96Down = ClService.sqrtBigInt(
      (sqrtPriceX96Squared * (SLIPPAGE_SCALE - slippageScaled)) / SLIPPAGE_SCALE,
    );
    const sqrtPriceX96Up = ClService.sqrtBigInt(
      (sqrtPriceX96Squared * (SLIPPAGE_SCALE + slippageScaled)) / SLIPPAGE_SCALE,
    );
    const tickDown = TickMath.getTickAtSqrtRatio(sqrtPriceX96Down);
    const tickUp = TickMath.getTickAtSqrtRatio(sqrtPriceX96Up);

    const amount0AtPriceDrop = PositionMath.getToken0Amount(
      tickDown,
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96Down,
      liquidity,
    );

    const amount1AtPriceRise = PositionMath.getToken1Amount(
      tickUp,
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96Up,
      liquidity,
    );

    // Take the worst case for each token
    const amount0Max = amount0AtPriceDrop > amount0AtCurrent ? amount0AtPriceDrop : amount0AtCurrent;
    const amount1Max = amount1AtPriceRise > amount1AtCurrent ? amount1AtPriceRise : amount1AtCurrent;

    return { amount0Max, amount1Max };
  }

  /**
   * Integer square root via Newton's method. Returns floor(sqrt(n)).
   */
  private static sqrtBigInt(n: bigint): bigint {
    if (n < 0n) throw new Error('sqrtBigInt: negative input');
    if (n < 2n) return n;
    let x = 1n << ((BigInt(n.toString(2).length) + 1n) / 2n);
    while (true) {
      const next = (x + n / x) / 2n;
      if (next >= x) return x;
      x = next;
    }
  }

  /**
   * Convert a human-readable price to the nearest initializable tick for a pool.
   *
   * Constructs a `Price` object from `price` (expressed as "how many token1 per token0"),
   * derives the corresponding `sqrtPriceX96`, calculates the raw tick via the
   * log-base-1.0001 formula, and rounds to the nearest multiple of `tickSpacing`
   * so the tick is actually initializable in the pool.
   *
   * @param price - The price of token0 denominated in token1 (e.g. `1800` for 1 ETH = 1800 USDC).
   * @param token0 - The base token (token0 in the pool).
   * @param token1 - The quote token (token1 in the pool).
   * @param tickSpacing - The pool's tick spacing; the result is rounded to a multiple of this.
   * @returns The nearest initializable tick as a `bigint`.
   */
  public static priceToTick(price: number, token0: Token, token1: Token, tickSpacing: number): bigint {
    // Convert price to Price object
    const priceObj = new Price(
      token0,
      token1,
      BigInt(10 ** token0.decimals),
      BigInt(Math.floor(price * 10 ** token1.decimals)),
    );

    // Calculate tick from sqrtPriceX96
    const sqrtRatioX96 =
      (BigInt(priceObj.numerator.toString()) * BigInt(2) ** BigInt(96)) / BigInt(priceObj.denominator.toString());

    // Calculate tick: tick = log1.0001(price) = log(price) / log(1.0001)
    const tick = Math.floor(Math.log(Number(sqrtRatioX96) / 2 ** 96) / Math.log(1.0001));

    // Round to nearest valid tick based on tickSpacing
    const roundedTick = Math.round(tick / tickSpacing) * tickSpacing;

    return BigInt(roundedTick);
  }
}
