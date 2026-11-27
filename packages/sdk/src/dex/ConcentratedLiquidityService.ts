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
  XToken,
  SendMessageReturnType,
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

/** Read from the pool's hook contract. */
export type PoolRewardConfig = {
  rewardCurrency: Address; // currency0 or currency1
  rewardRatePerSecond: bigint;
  lastActionTimestamp: bigint; // last position-affecting action
};

export type ApyRange = {
  minApy: number; // liquidity spread across all ticks
  maxApy: number; // liquidity concentrated in 1 tick
};

export type ClSupplyParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint; // slippage should already be applied by the caller
  amount0Max: bigint; // user's full balance
  amount1Max: bigint; // user's full balance
  sqrtPriceX96: bigint;
};

export type ClSupplyAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClSupplyParams<K>
>;

export type ClGetPoolDataParams = {
  token0: string;
  token1: string;
  fee: bigint; // fee tier
};

export type ClWithdrawParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  asset: OriginalAssetAddress;
  amount: bigint;
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
  tokenId: bigint; // position NFT
  tickLower: bigint;
  tickUpper: bigint;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  sqrtPriceX96: bigint;
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
  tokenId: bigint; // position NFT
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
};

export type ClLiquidityDecreaseLiquidityAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClDecreaseLiquidityParams<K>
>;

export type ClClaimRewardsParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  poolKey: PoolKey;
  tokenId: bigint; // position NFT
  tickLower: bigint;
  tickUpper: bigint;
};

export type ClLiquidityClaimRewardsAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  ClClaimRewardsParams<K>
>;

export type ConcentratedLiquidityParams<K extends SpokeChainKey> =
  | ClSupplyParams<K>
  | ClIncreaseLiquidityParams<K>
  | ClDecreaseLiquidityParams<K>
  | ClWithdrawParams<K>
  | ClClaimRewardsParams<K>;

export type ClPositionInfo = {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  subscriber: Address;

  amount0: bigint;
  amount1: bigint;
  tickLowerPrice: Price<Token, Token>;
  tickUpperPrice: Price<Token, Token>;

  unclaimedFees0: bigint;
  unclaimedFees1: bigint;

  // Present only when the token is a StatAToken.
  amount0Underlying?: bigint;
  amount1Underlying?: bigint;
  unclaimedFees0Underlying?: bigint;
  unclaimedFees1Underlying?: bigint;
};

export type TokenWithConversion = Token & {
  isStatAToken: boolean;
  conversionRate?: bigint; // wrapped → underlying, 1e18 precision
  underlyingToken?: Token;
};

export type EnrichedToken = {
  token: Token;
  isStatAToken: boolean;
  conversionRate?: bigint;
  underlyingToken?: Token;
};

export interface ConcentratedLiquidityTokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  address: Address;
}

export interface PoolData {
  poolId: string;
  poolKey: {
    currency0: Address;
    currency1: Address;
    hooks: Address;
    poolManager: Address;
    fee: number;
    parameters: string;
  };

  // From slot0.
  sqrtPriceX96: bigint;
  currentTick: number;
  protocolFee: number;
  lpFee: number;

  price: Price<Token, Token>; // token1/token0

  totalLiquidity: bigint;

  feeTier: number;
  tickSpacing: number;

  token0: Token;
  token1: Token;

  token0IsStatAToken: boolean;
  token0ConversionRate?: bigint; // 1e18 precision (1 share = X underlying)
  token0UnderlyingToken?: Token;
  token1IsStatAToken: boolean;
  token1ConversionRate?: bigint;
  token1UnderlyingToken?: Token;

  isActive: boolean;
  createdAt?: number; // block number

  rewardConfig?: PoolRewardConfig;
}

export type PoolSpokeAssets = { token0: XToken; token1: XToken };

export type ClServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Concentrated-liquidity positions (PancakeSwap Infinity) on the hub. `execute*` returns the spoke tx for manual
 * relay; the unprefixed variants also wait for the hub packet.
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

  /** Maps the pool's hub currencies (StatAToken / vault-token addresses) back to spoke-chain tokens. */
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

  /** Spoke message carrying Permit2 approvals for both currencies plus `CLPositionManager.mint`. */
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
          tx: txResult.value satisfies SendMessageReturnType<K, boolean> as SendMessageReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      this.config.logger.error('executeSupplyLiquidity error', error);
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** Waits for the hub mint tx and reads the new position's NFT `tokenId` from its `MintPosition` event. */
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

  /** No Permit2 approvals here — they are expected to persist from the initial mint. */
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
        hubWallet,
        '0x',
        BigInt(2) ** BigInt(256) - BigInt(1),
      );

      const increaseCall: EvmContractCall = {
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        value: 0n,
        data: calldata,
      };

      calls.push(increaseCall);

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
          tx: txResult.value satisfies SendMessageReturnType<K, Raw> as SendMessageReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: encodeContractCalls(calls) },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** Accumulated fees are collected by the position manager as part of the decrease. */
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
        deadline: BigInt(2) ** BigInt(256) - BigInt(1),
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
          tx: txResult.value satisfies SendMessageReturnType<K, Raw> as SendMessageReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

  /** Permit2 allowance for `contract` plus the ERC-20 approval of the Permit2 singleton (max amount and expiry). */
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

  /** Reads the hook's `poolRewardConfigs(bytes32)` mapping; fails when the pool has no hook. */
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

  /** Harvests hook rewards via `decreaseLiquidity(0)`, which triggers reward accounting only. */
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

      const calldata = encodeCLPositionManagerDecreaseLiquidityCalldata({
        tokenId: params.tokenId,
        poolKey: params.poolKey,
        liquidity: 0n,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: hubWallet,
        hookData: '0x',
        deadline: BigInt(2) ** BigInt(256) - BigInt(1),
      });

      const claimCall: EvmContractCall = {
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        value: 0n,
        data: calldata,
      };

      calls.push(claimCall);

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
          tx: txResult.value satisfies SendMessageReturnType<K, Raw> as SendMessageReturnType<K, Raw>,
          relayData: { address: hubWallet, payload: data },
        },
      };
    } catch (error) {
      this.config.logger.error('executeClaimRewards error', error);
      if (isDexCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('dex', error) };
    }
  }

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

  public getPools(): PoolKey[] {
    return this.config.getDexPools();
  }

  /** Falls back to an `UNKNOWN` 18-decimal token when the reads fail. */
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
      return {
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18,
        address: tokenAddress,
      };
    }
  }

  private isStatAToken(tokenAddress: Address): boolean {
    const normalizedAddress =
      tokenAddress.toLowerCase() as keyof typeof this.config.sodaxConfig.dex.statATokenAddresses;
    return normalizedAddress in this.config.sodaxConfig.dex.statATokenAddresses;
  }

  /** Underlying per 1 share, 1e18 precision; falls back to 1:1 on failure. */
  private async getStatATokenConversionRate(statATokenAddress: Address): Promise<bigint> {
    try {
      const oneShare = BigInt(10 ** 18);
      const result = await Erc4626Service.convertToAssets(statATokenAddress, oneShare, this.hubProvider.publicClient);
      if (!result.ok) {
        this.config.logger.error('[getStatATokenConversionRate] Failed to get conversion rate', result.error);
        return oneShare;
      }
      return result.value;
    } catch (error) {
      this.config.logger.error('[getStatATokenConversionRate] Error', error);
      return BigInt(10 ** 18);
    }
  }

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

  /** Live pool state plus StatAToken enrichment and hook rewards; `isActive` is `sqrtPriceX96 > 0`. */
  public async getPoolData(poolKey: PoolKey<'CL'>, publicClient: PublicClient): Promise<Result<PoolData>> {
    try {
      const poolId = getPoolId(poolKey);
      const slot0Data = await publicClient.readContract({
        address: poolKey.poolManager,
        abi: CLPoolManagerAbi,
        functionName: 'getSlot0',
        args: [poolId],
      });

      const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0Data;

      const [token0, token1] = await Promise.all([
        this.getTokenInfo(poolKey.currency0, publicClient),
        this.getTokenInfo(poolKey.currency1, publicClient),
      ]);

      const currency0 = new Token(146, poolKey.currency0, token0.decimals, token0.symbol, token0.name);
      const currency1 = new Token(146, poolKey.currency1, token1.decimals, token1.symbol, token1.name);

      const [enrichment0, enrichment1] = await Promise.all([
        this.getTokenEnrichmentData(currency0, publicClient),
        this.getTokenEnrichmentData(currency1, publicClient),
      ]);

      const price = sqrtRatioX96ToPrice(sqrtPriceX96, currency0, currency1);

      let totalLiquidity = 0n;
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

      const feeTier = poolKey.fee;

      const tickSpacing = poolKey.parameters.tickSpacing;

      let rewardConfig: PoolRewardConfig | undefined;

      const hookAddress = poolKey.hooks;
      if (hookAddress && hookAddress !== '0x' && hookAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          const rewardConfigResult = await this.getPoolRewardConfig(poolKey, publicClient);
          if (rewardConfigResult.ok && rewardConfigResult.value.rewardRatePerSecond > 0n) {
            rewardConfig = rewardConfigResult.value;
          }
        } catch (error) {
          // The pool might simply have no rewards.
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

  /** Position amounts, unclaimed fees (V3 fee-growth accounting) and StatAToken underlying equivalents. */
  public async getPositionInfo(tokenId: bigint, publicClient: PublicClient): Promise<Result<ClPositionInfo>> {
    try {
      const positionData = await publicClient.readContract({
        address: this.config.sodaxConfig.dex.concentratedLiquidityConfig.clPositionManager,
        abi: CLPositionManagerAbi,
        functionName: 'positions',
        args: [tokenId],
      });

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

      const poolId = getPoolId(poolKey);

      const feeGrowthGlobals = await publicClient.readContract({
        address: poolKey.poolManager,
        abi: CLPoolManagerAbi,
        functionName: 'getFeeGrowthGlobals',
        args: [poolId],
      });

      const [feeGrowthGlobal0X128, feeGrowthGlobal1X128] = feeGrowthGlobals;

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

      let feeGrowthInside0X128: bigint;
      let feeGrowthInside1X128: bigint;

      if (poolData.currentTick < tickLower) {
        feeGrowthInside0X128 = feeGrowthOutside0X128Lower - feeGrowthOutside0X128Upper;
        feeGrowthInside1X128 = feeGrowthOutside1X128Lower - feeGrowthOutside1X128Upper;
      } else if (poolData.currentTick < tickUpper) {
        feeGrowthInside0X128 = feeGrowthGlobal0X128 - feeGrowthOutside0X128Lower - feeGrowthOutside0X128Upper;
        feeGrowthInside1X128 = feeGrowthGlobal1X128 - feeGrowthOutside1X128Lower - feeGrowthOutside1X128Upper;
      } else {
        feeGrowthInside0X128 = feeGrowthOutside0X128Upper - feeGrowthOutside0X128Lower;
        feeGrowthInside1X128 = feeGrowthOutside1X128Upper - feeGrowthOutside1X128Lower;
      }

      const Q128 = BigInt(2) ** BigInt(128);

      // Fee growth is uint256 and wraps on-chain, so take the delta mod 2^256.
      const feeGrowthDelta0 = (feeGrowthInside0X128 - feeGrowthInside0LastX128 + (Q128 << 128n)) % (Q128 << 128n);
      const feeGrowthDelta1 = (feeGrowthInside1X128 - feeGrowthInside1LastX128 + (Q128 << 128n)) % (Q128 << 128n);

      const unclaimedFees0 = (feeGrowthDelta0 * liquidity) / Q128;
      const unclaimedFees1 = (feeGrowthDelta1 * liquidity) / Q128;

      let amount0Underlying: bigint | undefined;
      let amount1Underlying: bigint | undefined;
      let unclaimedFees0Underlying: bigint | undefined;
      let unclaimedFees1Underlying: bigint | undefined;

      if (poolData.token0IsStatAToken && poolData.token0ConversionRate) {
        // conversionRate is underlying per 1e18 shares.
        amount0Underlying = (tokenAmount0 * poolData.token0ConversionRate) / BigInt(10 ** 18);
        unclaimedFees0Underlying = (unclaimedFees0 * poolData.token0ConversionRate) / BigInt(10 ** 18);
      }

      if (poolData.token1IsStatAToken && poolData.token1ConversionRate) {
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

  /** The `liquidity` to pass to `executeSupplyLiquidity` / `executeIncreaseLiquidity` for the given amounts. */
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

  /** Token1 needed to pair with `amount0` at the current price (liquidity derived from `amount0` alone). */
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

    // Max uint128 for amount1 so only amount0 constrains the liquidity.
    const liquidity = maxLiquidityForAmounts(
      sqrtPriceX96,
      sqrtRatioX96Lower,
      sqrtRatioX96Upper,
      amount0,
      BigInt('0xffffffffffffffffffffffffffffffff'),
      true,
    );

    const amount1 = PositionMath.getToken1Amount(
      Number(currentTick),
      Number(tickLower),
      Number(tickUpper),
      sqrtPriceX96,
      liquidity,
    );

    return amount1;
  }

  /** Token0 needed to pair with `amount1` at the current price (liquidity derived from `amount1` alone). */
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

    // Max uint128 for amount0 so only amount1 constrains the liquidity.
    const liquidity = maxLiquidityForAmounts(
      sqrtPriceX96,
      sqrtRatioX96Lower,
      sqrtRatioX96Upper,
      BigInt('0xffffffffffffffffffffffffffffffff'),
      amount1,
      true,
    );

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
   * Worst-case `amount0Max`/`amount1Max`: a price drop raises the token0 need, a rise the token1 need.
   * `slippagePercent` is a percentage (`0.5` = 0.5%).
   */
  public static calculateMaxAmountsForSlippage(
    liquidity: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    currentTick: bigint,
    sqrtPriceX96: bigint,
    slippagePercent: number,
  ): { amount0Max: bigint; amount1Max: bigint } {
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

    // Integer math keeps all ~160 bits of sqrtPriceX96: sqrtP * sqrt(1 ± s) = sqrt(sqrtP² * (1 ± s)).
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

    const amount0Max = amount0AtPriceDrop > amount0AtCurrent ? amount0AtPriceDrop : amount0AtCurrent;
    const amount1Max = amount1AtPriceRise > amount1AtCurrent ? amount1AtPriceRise : amount1AtCurrent;

    return { amount0Max, amount1Max };
  }

  /** floor(sqrt(n)) via Newton's method. */
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

  /** `price` is token1 per token0; the tick is rounded to the nearest multiple of `tickSpacing`. */
  public static priceToTick(price: number, token0: Token, token1: Token, tickSpacing: number): bigint {
    const priceObj = new Price(
      token0,
      token1,
      BigInt(10 ** token0.decimals),
      BigInt(Math.floor(price * 10 ** token1.decimals)),
    );

    const sqrtRatioX96 =
      (BigInt(priceObj.numerator.toString()) * BigInt(2) ** BigInt(96)) / BigInt(priceObj.denominator.toString());

    const tick = Math.floor(Math.log(Number(sqrtRatioX96) / 2 ** 96) / Math.log(1.0001));

    const roundedTick = Math.round(tick / tickSpacing) * tickSpacing;

    return BigInt(roundedTick);
  }
}
