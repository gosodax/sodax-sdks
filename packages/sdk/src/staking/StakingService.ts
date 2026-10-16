// packages/sdk/src/services/staking/StakingService.ts
import { erc20Abi, type Address, type Hex } from 'viem';
import { StakingLogic } from './StakingLogic.js';
import { stakedSodaAbi } from '../shared/abis/index.js';
import type { IntentTxResult, TxHashPair } from '../shared/types/types.js';
import {
  encodeContractCalls,
  EvmVaultTokenService,
  relayTxAndWaitPacket,
  type SpokeService,
  type EvmHubProvider,
  encodeAddress,
  EvmAssetManagerService,
  type ConfigService,
  isHubChainKeyType,
  isStellarChainKeyType,
  Erc20Service,
  isEvmSpokeOnlyChainKeyType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  type SendMessageParams,
  type SpokeApproveParams,
} from '../shared/index.js';
import {
  type HttpUrl,
  type XToken,
  type SpokeChainKey,
  getIntentRelayChainId,
  type UserUnstakeInfo,
  type EvmContractCall,
  type TxReturnType,
  type GetAddressType,
  type Result,
  type GetWalletProviderType,
  type EvmChainKey,
  type HubChainKey,
  type GetTokenAddressType,
  type StellarChainKey,
  type SpokeExecActionParams,
  type EvmSpokeOnlyChainKey,
} from '@sodax/types';
import {
  lookupFailed,
  verifyFailed,
  intentCreationFailed,
  executionFailed,
  approveFailed,
  allowanceCheckFailed,
} from '../errors/wrappers.js';
import {
  type StakeOrchestrationError,
  type StakingAllowanceCheckError,
  type StakingApproveError,
  type StakingCreateIntentError,
  type StakingInfoFetchError,
  type StakingOrchestrationError,
  isStakeOrchestrationError,
  isStakingAllowanceCheckError,
  isStakingApproveError,
  isStakingCreateIntentError,
  isStakingInfoFetchError,
  isStakingOrchestrationError,
  stakingInvariant,
} from './errors.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';

export type StakeParams<K extends SpokeChainKey> = {
  srcChainKey: K; // chain key of the spoke chain to stake from
  srcAddress: Address; // account to stake from
  amount: bigint; // amount to stake
  minReceive: bigint; // minimum amount to receive
  action: 'stake';
};

export type StakeAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<K, Raw, StakeParams<K>>;

export type UnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K; // chain key of the spoke chain to unstake from
  srcAddress: Address; // account to unstake from
  amount: bigint; // amount of xSoda to unstake
  action: 'unstake';
};

export type UnstakeAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  UnstakeParams<K>
>;

export type ClaimParams<K extends SpokeChainKey> = {
  srcAddress: Address;
  srcChainKey: K; // chain key of the spoke chain to claim from
  requestId: bigint;
  amount: bigint; // claimable amount after penalty calculation
  action: 'claim';
};

export type ClaimAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<K, Raw, ClaimParams<K>>;

export type CancelUnstakeParams<K extends SpokeChainKey> = {
  srcAddress: Address;
  srcChainKey: K; // chain key of the spoke chain to cancel unstake from
  requestId: bigint;
  action: 'cancelUnstake';
};

export type CancelUnstakeAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  CancelUnstakeParams<K>
>;

export type InstantUnstakeParams<K extends SpokeChainKey> = {
  srcAddress: Address;
  srcChainKey: K; // chain key of the spoke chain to instant unstake from
  amount: bigint;
  minAmount: bigint;
  action: 'instantUnstake';
};

export type InstantUnstakeAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  InstantUnstakeParams<K>
>;

export type StakingActionUnion<K extends SpokeChainKey> =
  | StakeParams<K>
  | UnstakeParams<K>
  | ClaimParams<K>
  | CancelUnstakeParams<K>
  | InstantUnstakeParams<K>;

export type StakingParamsUnion<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  StakingActionUnion<K>
>;

export type StakingInfo = {
  totalStaked: bigint; // Total SODA staked (totalAssets from xSODA vault)
  totalUnderlying: bigint; // Total underlying SODA assets in the vault
  userXSodaBalance: bigint; // User's xSODA shares (raw balance)
  userXSodaValue: bigint; // User's xSODA value in SODA (converted)
  userUnderlying: bigint; // User's underlying SODA amount
};

export type UnstakingInfo = {
  userUnstakeSodaRequests: readonly UserUnstakeInfo[];
  totalUnstaking: bigint;
};

export type UnstakeRequestWithPenalty = UserUnstakeInfo & {
  penalty: bigint;
  penaltyPercentage: number;
  claimableAmount: bigint;
};

export type StakingConfig = {
  unstakingPeriod: bigint; // in seconds
  minUnstakingPeriod: bigint; // in seconds
  maxPenalty: bigint; // percentage (1-100)
};

export type StakingServiceConstructorParams = {
  hubProvider: EvmHubProvider;
  config: ConfigService;
  spoke: SpokeService;
};

/**
 * Orchestrates all SODA token staking operations on the SODAX hub-and-spoke network.
 *
 * Users stake SODA to receive xSoda shares (ERC-4626 vault). The full lifecycle is:
 * - **Stake**: deposit SODA on any spoke chain → receive xSoda on the hub (Sonic)
 * - **Unstake**: initiate a delayed withdrawal; a linear penalty applies until the full unstaking period elapses
 * - **Instant unstake**: bypass the waiting period by paying slippage through the StakingRouter
 * - **Claim**: redeem SODA after the unstaking period expires
 * - **Cancel unstake**: abort a pending unstake request and re-stake the underlying SODA as xSoda
 *
 * All mutating methods follow the intent pattern: a `create*Intent` method submits the spoke-chain
 * transaction and returns relay data, while the matching top-level method (`stake`, `unstake`, …)
 * additionally relays the intent to the hub and waits for the cross-chain packet to land.
 */
export class StakingService {
  private readonly hubProvider: EvmHubProvider;
  private readonly relayerApiEndpoint: HttpUrl;
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;

  constructor({ hubProvider, config, spoke }: StakingServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.config = config;
    this.spoke = spoke;
  }

  /**
   * Checks whether the current token allowance is sufficient for the requested staking action.
   *
   * Relevant only for `stake`, `unstake`, and `instantUnstake` actions:
   * - For EVM spoke chains: verifies the spoke asset-manager (or hub wallet for hub-chain ops) has enough allowance.
   * - For Stellar: delegates to the spoke's allowance check.
   * - For other non-EVM chains: no on-chain allowance is required; always resolves `true`.
   *
   * @param _params - Typed action params union including the action discriminant, source chain, address, and amount.
   * @returns `{ ok: true, value: true }` when allowance is sufficient; `{ ok: false, error }` on failure or unsupported action.
   */
  public async isAllowanceValid<K extends SpokeChainKey, Raw extends boolean>(
    _params: StakingParamsUnion<K, Raw>,
  ): Promise<Result<boolean, StakingAllowanceCheckError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: params.action };
    try {
      stakingInvariant(
        params.action === 'stake' || params.action === 'unstake' || params.action === 'instantUnstake',
        `Allowance check is not applicable for action: ${params.action}`,
        { ...baseCtx, field: 'action' },
      );
      stakingInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const targetToken =
        params.action === 'stake' || !isHubChainKeyType(params.srcChainKey)
          ? (this.config.sodaxConfig.chains[params.srcChainKey].supportedTokens['SODA'] as XToken).address
          : this.hubProvider.chainConfig.addresses.xSoda;
      stakingInvariant(targetToken, 'Target token not found', { ...baseCtx, field: 'targetToken' });

      // Compute the underlying Result<boolean> across chain-type paths, then wrap any
      // spoke-layer failure as STAKING_ALLOWANCE_CHECK_FAILED at the single return point below.
      let inner: Result<boolean> = { ok: true, value: true };

      if (isEvmSpokeOnlyChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey)) {
        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: targetToken,
          amount: params.amount,
          owner: params.srcAddress,
          spender: spender as GetAddressType<EvmChainKey | HubChainKey>,
        });
      } else if (isStellarChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: targetToken,
          amount: params.amount,
          owner: params.srcAddress,
        });
      }
      // For other non-EVM chains (Icon, Sui, NEAR, Bitcoin, etc.), no allowance check is
      // required — `inner` keeps its default `{ ok: true, value: true }` initialiser.

      if (inner.ok) return inner;
      return {
        ok: false,
        error: allowanceCheckFailed('staking', inner.error, baseCtx),
      };
    } catch (error) {
      if (isStakingAllowanceCheckError(error)) return { ok: false, error };
      return {
        ok: false,
        error: allowanceCheckFailed('staking', error, baseCtx),
      };
    }
  }

  /**
   * Submits a token-spending approval on the source chain for a `stake`, `unstake`, or `instantUnstake` action.
   *
   * The spender address is resolved automatically:
   * - Hub chain: the user's hub wallet (derived from spoke address)
   * - EVM spoke chain: the chain's asset-manager contract
   *
   * Must be called before executing the corresponding action whenever `isAllowanceValid` returns `false`.
   * Only EVM (spoke + hub) and Stellar chains support approvals; all other chains return an error.
   *
   * @param _params - Typed action params including `raw` flag and a chain-appropriate wallet provider.
   * @returns The approval transaction hash (or raw call data when `raw: true`), wrapped in `Result`.
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: StakingParamsUnion<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>, StakingApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: params.action };

    const wrapApproveFailure = (cause: unknown) => approveFailed('staking', cause, baseCtx);

    try {
      stakingInvariant(
        params.action === 'stake' || params.action === 'unstake' || params.action === 'instantUnstake',
        `Approve is not applicable for action: ${params.action}`,
        { ...baseCtx, field: 'action' },
      );
      stakingInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });

      const targetToken =
        params.action === 'stake' || !isHubChainKeyType(params.srcChainKey)
          ? (this.config.sodaxConfig.chains[params.srcChainKey].supportedTokens['SODA'] as XToken).address
          : this.hubProvider.chainConfig.addresses.xSoda;
      stakingInvariant(targetToken, 'Target token not found', { ...baseCtx, field: 'targetToken' });

      if (isEvmSpokeOnlyChainKeyType(params.srcChainKey) || isHubChainKeyType(params.srcChainKey)) {
        stakingInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );

        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: targetToken as GetTokenAddressType<EvmSpokeOnlyChainKey | HubChainKey>,
          amount: params.amount,
          owner: params.srcAddress,
          spender: spender,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        } as SpokeApproveParams<HubChainKey | EvmSpokeOnlyChainKey, Raw>);

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<HubChainKey | EvmSpokeOnlyChainKey, boolean> as TxReturnType<
            K,
            Raw
          >,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        stakingInvariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );
        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: targetToken,
          amount: params.amount,
          owner: params.srcAddress,
        } as const;

        const result = await this.spoke.approve<StellarChainKey, boolean>(
          _params.raw
            ? {
                ...coreParams,
                raw: true,
              }
            : {
                ...coreParams,
                raw: false,
                walletProvider: _params.walletProvider,
              },
        );

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<StellarChainKey, boolean> as TxReturnType<K, Raw>,
        };
      }

      // Reached only for chains that don't support approval (Solana, NEAR, Bitcoin, Icon, Sui, etc.).
      // Surface as a validation failure rather than a generic Error so consumers can discriminate.
      stakingInvariant(false, 'Approval only supported for EVM spoke chains and Stellar', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isStakingApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /**
   * Stakes SODA tokens from a spoke chain and relays the intent to the hub, waiting for confirmation.
   *
   * Internally calls `createStakeIntent` to submit on the spoke, then relays the cross-chain packet
   * and waits for the hub transaction to land. For hub-chain callers the spoke and hub hashes are identical.
   *
   * Prerequisite: call `isAllowanceValid` + `approve` before staking on EVM chains.
   *
   * @param _params - Stake action params: source chain/address, SODA amount, minReceive slippage guard, and wallet provider.
   * @returns `{ ok: true, value: { srcChainTxHash, dstChainTxHash } }` on success.
   */
  public async stake<K extends SpokeChainKey>(
    _params: StakeAction<K, false>,
  ): Promise<Result<TxHashPair, StakeOrchestrationError>> {
    return this.config.analytics.trackResult(
      'staking',
      'stake',
      async () => {
        const { params, timeout } = _params;
        const baseCtx = { srcChainKey: params.srcChainKey, action: 'stake' as const };
        try {
          const txResult = await this.createStakeIntent(_params);
          // CreateStakeIntentErrorCode ⊂ StakeErrorCode, so SodaxError narrows correctly.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          // verify the spoke tx hash exists on chain
          const verifyTxHashResult = await this.spoke.verifyTxHash({
            txHash: txResult.value.tx,
            chainKey: params.srcChainKey,
          });

          if (!verifyTxHashResult.ok) {
            return {
              ok: false,
              error: verifyFailed('staking', verifyTxHashResult.error, baseCtx),
            };
          }

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout,
            });
            if (!packetResult.ok) {
              return {
                ok: false,
                error: mapRelayFailure(packetResult.error, {
                  feature: 'staking',
                  action: baseCtx.action,
                  srcChainKey: baseCtx.srcChainKey,
                }),
              };
            }
            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isStakeOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('staking', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          amount: _params.params.amount,
          minReceive: _params.params.minReceive,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Submits the stake transaction on the spoke chain without relaying to the hub.
   *
   * Encodes the full stake call sequence via `buildStakeData` and invokes the spoke deposit.
   * Returns both the spoke transaction result and the relay data needed to forward the intent
   * to the hub in a subsequent step.
   *
   * Use this when you need fine-grained control over the relay step. For the complete end-to-end
   * flow (spoke + relay + hub confirmation), use `stake` instead.
   *
   * @param _params - Stake action params; set `raw: true` to receive ABI-encoded call data instead of broadcasting.
   * @returns `IntentTxResult` containing the spoke tx result and `relayData` (hub wallet address + encoded payload).
   */
  async createStakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: StakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'stake' as const };
    try {
      const sodaToken = this.config.getSodaToken(params.srcChainKey);
      stakingInvariant(sodaToken, 'SODA token not found', { ...baseCtx, field: 'sodaToken' });
      const sodaAsset = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, sodaToken.address);
      stakingInvariant(sodaAsset, 'SODA asset not found', { ...baseCtx, field: 'sodaAsset' });

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const data: Hex = this.buildStakeData(sodaAsset, hubWallet, params);

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        to: hubWallet,
        token: sodaToken.address as GetTokenAddressType<K>,
        amount: params.amount,
        data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreParams,
              raw: true,
            }
          : {
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        if (isStakingCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('staking', txResult.error, baseCtx),
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
      if (isStakingCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('staking', error, baseCtx),
      };
    }
  }

  /**
   * Encodes the multi-call hub payload for a stake operation via the StakingRouter.
   *
   * The encoded sequence is:
   * 1. ERC-20 approve of the hub SODA asset to the xSoda vault
   * 2. ERC-4626 deposit of SODA into the xSoda vault
   * 3. ERC-20 approve of xSoda to the StakingRouter
   * 4. StakingRouter.stake to deliver xSoda shares to the hub wallet
   *
   * @param sodaAsset - Full xToken descriptor for SODA on the spoke chain (provides vault and hub-asset addresses).
   * @param to - Hub wallet address that will receive the resulting xSoda shares.
   * @param params - Stake params carrying the SODA amount and minReceive slippage guard.
   * @returns ABI-encoded batch call payload to be forwarded to the hub.
   */
  public buildStakeData(sodaAsset: XToken, to: Address, params: StakeParams<SpokeChainKey>): Hex {
    const hubConfig = this.config.getHubChainConfig();
    const sodaVault = sodaAsset.vault;
    const stakingRouter = hubConfig.addresses.stakingRouter;

    const calls: EvmContractCall[] = [];
    calls.push(Erc20Service.encodeApprove(sodaAsset.hubAsset, sodaVault, params.amount));
    calls.push(EvmVaultTokenService.encodeDeposit(sodaVault, sodaAsset.hubAsset, params.amount));
    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(sodaAsset.decimals, params.amount);
    calls.push(Erc20Service.encodeApprove(sodaVault, stakingRouter, translatedAmount));
    calls.push(StakingLogic.encodeStakingRouterStake(stakingRouter, translatedAmount, to, params.minReceive));
    return encodeContractCalls(calls);
  }

  /**
   * Initiates an unstake request for xSoda shares and relays the intent to the hub.
   *
   * Unstaking begins a waiting period. The user receives SODA only after calling `claim` once
   * the period elapses. Early claims incur a penalty (see `getStakingConfig`). For immediate
   * redemption without a waiting period, use `instantUnstake` instead.
   *
   * Prerequisite: call `isAllowanceValid` + `approve` before unstaking on EVM chains.
   *
   * @param _params - Unstake action params: source chain/address, xSoda amount, and wallet provider.
   * @returns `{ ok: true, value: { srcChainTxHash, dstChainTxHash } }` on success.
   */
  public async unstake<K extends SpokeChainKey>(
    _params: UnstakeAction<K, false>,
  ): Promise<Result<TxHashPair, StakingOrchestrationError>> {
    return this.config.analytics.trackResult(
      'staking',
      'unstake',
      async () => {
        const { params, timeout } = _params;
        const baseCtx = { srcChainKey: params.srcChainKey, action: 'unstake' as const };
        try {
          const txResult = await this.createUnstakeIntent(_params);
          // CreateUnstakeIntentErrorCode ⊂ UnstakeErrorCode, so SodaxError narrows correctly.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout,
            });
            if (!packetResult.ok) {
              return {
                ok: false,
                error: mapRelayFailure(packetResult.error, {
                  feature: 'staking',
                  action: baseCtx.action,
                  srcChainKey: baseCtx.srcChainKey,
                }),
              };
            }
            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isStakingOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('staking', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          amount: _params.params.amount,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Submits the unstake transaction on the spoke chain without relaying to the hub.
   *
   * Converts the xSoda share amount to its underlying SODA value on-chain, then encodes and
   * sends the `sendMessage` spoke transaction carrying the hub payload built by `buildUnstakeData`.
   *
   * Use this when you need manual control over the relay step. For the full end-to-end flow use `unstake`.
   *
   * @param _params - Unstake action params; set `raw: true` to receive ABI-encoded call data instead of broadcasting.
   * @returns `IntentTxResult` containing the spoke tx result and `relayData` (hub wallet address + encoded payload).
   */
  async createUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: UnstakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'unstake' as const };
    try {
      const xSoda = this.hubProvider.chainConfig.addresses.xSoda;
      const [hubWallet, underlyingSodaAmount] = await Promise.all([
        this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey),
        StakingLogic.convertXSodaSharesToSoda(xSoda, params.amount, this.hubProvider.publicClient),
      ]);
      const data: Hex = this.buildUnstakeData(hubWallet, params, xSoda, underlyingSodaAmount);

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
      } as const;

      const txResult = await this.spoke.sendMessage(
        _params.raw
          ? ({
              ...coreParams,
              raw: true,
            } satisfies SendMessageParams<K, true>)
          : ({
              ...coreParams,
              raw: false,
              walletProvider: _params.walletProvider,
            } satisfies SendMessageParams<K, false>),
      );

      if (!txResult.ok) {
        if (isStakingCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('staking', txResult.error, baseCtx),
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
      if (isStakingCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('staking', error, baseCtx),
      };
    }
  }

  /**
   * Encodes the multi-call hub payload for an unstake operation.
   *
   * The encoded sequence is:
   * 1. xSoda ERC-4626 redeem — burns the xSoda shares and releases underlying SODA to the hub wallet
   * 2. StakedSoda.unstake — places the SODA into an unstake request with a waiting period
   *
   * @param hubWallet - Hub wallet address that owns the xSoda shares and will hold the unstake request.
   * @param params - Unstake params carrying the xSoda share amount.
   * @param xSoda - Address of the xSoda ERC-4626 vault contract.
   * @param underlyingSodaAmount - Pre-computed SODA equivalent of the xSoda shares (from `convertXSodaSharesToSoda`).
   * @returns ABI-encoded batch call payload to be forwarded to the hub.
   */
  public buildUnstakeData<K extends SpokeChainKey>(
    hubWallet: Address,
    params: UnstakeParams<K>,
    xSoda: Address,
    underlyingSodaAmount: bigint,
  ): Hex {
    const hubConfig = this.config.getHubChainConfig();
    const stakedSoda = hubConfig.addresses.stakedSoda;
    const calls: EvmContractCall[] = [];
    calls.push(StakingLogic.encodeXSodaRedeem(xSoda, params.amount, hubWallet, hubWallet));
    calls.push(StakingLogic.encodeUnstake(stakedSoda, hubWallet, underlyingSodaAmount));
    return encodeContractCalls(calls);
  }

  /**
   * Instantly redeems xSoda shares for SODA without a waiting period and relays the intent to the hub.
   *
   * Routes through the StakingRouter which provides immediate liquidity at the cost of slippage.
   * Use `getInstantUnstakeRatio` to preview the SODA output before calling this method. For a
   * delayed but penalty-free redemption, use `unstake` + `claim` instead.
   *
   * Prerequisite: call `isAllowanceValid` + `approve` before instant unstaking on EVM chains.
   *
   * @param _params - Instant unstake action params: source chain/address, xSoda amount, minAmount slippage guard, and wallet provider.
   * @returns `{ ok: true, value: { srcChainTxHash, dstChainTxHash } }` on success.
   */
  public async instantUnstake<K extends SpokeChainKey>(
    _params: InstantUnstakeAction<K, false>,
  ): Promise<Result<TxHashPair, StakingOrchestrationError>> {
    return this.config.analytics.trackResult(
      'staking',
      'instantUnstake',
      async () => {
        const { params, timeout } = _params;
        const baseCtx = { srcChainKey: params.srcChainKey, action: 'instantUnstake' as const };
        try {
          const txResult = await this.createInstantUnstakeIntent(_params);
          // CreateInstantUnstakeIntentErrorCode ⊂ InstantUnstakeErrorCode.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout,
            });
            if (!packetResult.ok) {
              return {
                ok: false,
                error: mapRelayFailure(packetResult.error, {
                  feature: 'staking',
                  action: baseCtx.action,
                  srcChainKey: baseCtx.srcChainKey,
                }),
              };
            }
            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isStakingOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('staking', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          amount: _params.params.amount,
          minAmount: _params.params.minAmount,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Submits the instant-unstake transaction on the spoke chain without relaying to the hub.
   *
   * Encodes and sends the `sendMessage` spoke transaction carrying the hub payload built by
   * `buildInstantUnstakeData`. The StakingRouter will swap xSoda for SODA immediately on the hub
   * and bridge the SODA back to the caller's source chain.
   *
   * Use this when you need manual control over the relay step. For the full end-to-end flow use `instantUnstake`.
   *
   * @param _params - Instant unstake action params; set `raw: true` to receive ABI-encoded call data instead of broadcasting.
   * @returns `IntentTxResult` containing the spoke tx result and `relayData` (hub wallet address + encoded payload).
   */
  async createInstantUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: InstantUnstakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'instantUnstake' as const };
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const sodaToken = this.config.getSodaToken(params.srcChainKey);
      stakingInvariant(sodaToken, 'SODA token not found', { ...baseCtx, field: 'sodaToken' });
      const sodaAsset = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, sodaToken.address);
      stakingInvariant(sodaAsset, 'SODA asset not found', { ...baseCtx, field: 'sodaAsset' });

      const data = this.buildInstantUnstakeData(
        sodaAsset,
        params.srcChainKey,
        encodeAddress(params.srcChainKey, params.srcAddress),
        params,
      );

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
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
        if (isStakingCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('staking', txResult.error, baseCtx),
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
      if (isStakingCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('staking', error, baseCtx),
      };
    }
  }

  /**
   * Encodes the multi-call hub payload for an instant-unstake operation via the StakingRouter.
   *
   * The encoded sequence is:
   * 1. ERC-20 approve of xSoda to the StakingRouter
   * 2. StakingRouter.unstake — swaps xSoda for SODA and bridges the proceeds to the destination chain/wallet
   *
   * @param sodaAsset - Full xToken descriptor for SODA (provides the hub asset address for the bridge leg).
   * @param dstChainKey - Spoke chain key where the redeemed SODA should be delivered.
   * @param dstWallet - ABI-encoded destination wallet address on the destination chain.
   * @param params - Instant-unstake params carrying the xSoda amount and minAmount slippage guard.
   * @returns ABI-encoded batch call payload to be forwarded to the hub.
   */
  public buildInstantUnstakeData<K extends SpokeChainKey>(
    sodaAsset: XToken,
    dstChainKey: SpokeChainKey,
    dstWallet: Hex,
    params: InstantUnstakeParams<K>,
  ): Hex {
    const hubConfig = this.config.getHubChainConfig();
    const stakingRouter = hubConfig.addresses.stakingRouter;
    const xSoda = hubConfig.addresses.xSoda;

    const calls: EvmContractCall[] = [];
    calls.push(Erc20Service.encodeApprove(xSoda, stakingRouter, params.amount));
    calls.push(
      StakingLogic.encodeStakingRouterUnstake(
        stakingRouter,
        params.amount,
        params.minAmount,
        sodaAsset.hubAsset,
        getIntentRelayChainId(dstChainKey),
        dstWallet,
      ),
    );

    return encodeContractCalls(calls);
  }

  /**
   * Claims SODA from a fully-elapsed unstake request and relays the intent to the hub.
   *
   * Requires the unstaking period to have passed. For early claims (where a penalty applies)
   * consider using `getUnstakingInfoWithPenalty` first to preview the claimable amount.
   *
   * @param _params - Claim action params: source chain/address, requestId, claimable SODA amount, and wallet provider.
   * @returns `{ ok: true, value: { srcChainTxHash, dstChainTxHash } }` on success.
   */
  public async claim<K extends SpokeChainKey>(
    _params: ClaimAction<K, false>,
  ): Promise<Result<TxHashPair, StakingOrchestrationError>> {
    return this.config.analytics.trackResult(
      'staking',
      'claim',
      async () => {
        const { params, timeout } = _params;
        const baseCtx = { srcChainKey: params.srcChainKey, action: 'claim' as const };
        try {
          const txResult = await this.createClaimIntent(_params);
          // CreateClaimIntentErrorCode ⊂ ClaimErrorCode.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout,
            });
            if (!packetResult.ok) {
              return {
                ok: false,
                error: mapRelayFailure(packetResult.error, {
                  feature: 'staking',
                  action: baseCtx.action,
                  srcChainKey: baseCtx.srcChainKey,
                }),
              };
            }
            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isStakingOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('staking', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          requestId: _params.params.requestId,
          amount: _params.params.amount,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Submits the claim transaction on the spoke chain without relaying to the hub.
   *
   * Encodes and sends the `sendMessage` spoke transaction carrying the hub payload built by
   * `buildClaimData`. The hub will release the SODA and bridge it back to the caller's chain.
   *
   * Use this when you need manual control over the relay step. For the full end-to-end flow use `claim`.
   *
   * @param _params - Claim action params; set `raw: true` to receive ABI-encoded call data instead of broadcasting.
   * @returns `IntentTxResult` containing the spoke tx result and `relayData` (hub wallet address + encoded payload).
   */
  async createClaimIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: ClaimAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'claim' as const };
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const sodaToken = this.config.getSodaToken(params.srcChainKey);
      stakingInvariant(sodaToken, 'SODA token not found', { ...baseCtx, field: 'sodaToken' });
      const sodaAsset = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, sodaToken.address);
      stakingInvariant(sodaAsset, 'SODA asset not found', { ...baseCtx, field: 'sodaAsset' });

      const data: Hex = this.buildClaimData(
        sodaAsset,
        params.srcChainKey,
        encodeAddress(params.srcChainKey, params.srcAddress),
        params,
      );

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
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
        if (isStakingCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('staking', txResult.error, baseCtx),
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
      if (isStakingCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('staking', error, baseCtx),
      };
    }
  }

  /**
   * Encodes the multi-call hub payload for a claim operation.
   *
   * The encoded sequence is:
   * 1. StakedSoda.claim — finalises the unstake request and releases underlying SODA
   * 2. SODA vault token withdraw — unwraps the SODA hub asset from its vault token wrapper
   * 3. Transfer of the claimable SODA to the destination wallet:
   *    - Same-chain (hub): plain ERC-20 transfer
   *    - Cross-chain (spoke): asset-manager bridge transfer
   *
   * @param sodaAsset - Full xToken descriptor for SODA (provides vault and hub-asset addresses).
   * @param dstChainKey - Spoke chain key where the claimed SODA should be delivered.
   * @param dstWallet - ABI-encoded destination wallet address on the destination chain.
   * @param params - Claim params carrying the requestId and the pre-computed claimable SODA amount.
   * @returns ABI-encoded batch call payload to be forwarded to the hub.
   */
  public buildClaimData<K extends SpokeChainKey>(
    sodaAsset: XToken,
    dstChainKey: SpokeChainKey,
    dstWallet: Hex,
    params: ClaimParams<K>,
  ): Hex {
    const hubConfig = this.config.getHubChainConfig();
    const stakedSoda = hubConfig.addresses.stakedSoda;
    const sodaVault = sodaAsset.vault;
    const calls: EvmContractCall[] = [];
    calls.push(StakingLogic.encodeClaim(stakedSoda, params.requestId));
    // Transfer the claimable amount to the destination wallet
    calls.push(EvmVaultTokenService.encodeWithdraw(sodaVault, sodaAsset.hubAsset, params.amount));
    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(sodaAsset.decimals, params.amount);

    if (dstChainKey === this.hubProvider.chainConfig.chain.key) {
      calls.push(Erc20Service.encodeTransfer(sodaAsset.hubAsset, dstWallet, translatedAmountOut));
    } else {
      calls.push(
        EvmAssetManagerService.encodeTransfer(
          sodaAsset.hubAsset,
          dstWallet,
          translatedAmountOut,
          this.hubProvider.chainConfig.addresses.assetManager,
        ),
      );
    }

    return encodeContractCalls(calls);
  }

  /**
   * Cancels a pending unstake request and re-stakes the underlying SODA as xSoda shares.
   *
   * Aborts the waiting period and redeposits the SODA back into the xSoda vault so the user
   * continues earning staking rewards. The re-staked xSoda is credited to the hub wallet.
   *
   * @param _params - Cancel-unstake action params: source chain/address, requestId, and wallet provider.
   * @returns `{ ok: true, value: { srcChainTxHash, dstChainTxHash } }` on success.
   */
  public async cancelUnstake<K extends SpokeChainKey>(
    _params: CancelUnstakeAction<K, false>,
  ): Promise<Result<TxHashPair, StakingOrchestrationError>> {
    return this.config.analytics.trackResult(
      'staking',
      'cancelUnstake',
      async () => {
        const { params, timeout } = _params;
        const baseCtx = { srcChainKey: params.srcChainKey, action: 'cancelUnstake' as const };
        try {
          const txResult = await this.createCancelUnstakeIntent(_params);
          // CreateCancelUnstakeIntentErrorCode ⊂ CancelUnstakeErrorCode.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          let hubTxHash: string;
          if (!isHubChainKeyType(params.srcChainKey)) {
            const packetResult = await relayTxAndWaitPacket({
              srcTxHash: txResult.value.tx,
              data: txResult.value.relayData,
              chainKey: params.srcChainKey,
              relayerApiEndpoint: this.relayerApiEndpoint,
              timeout,
            });
            if (!packetResult.ok) {
              return {
                ok: false,
                error: mapRelayFailure(packetResult.error, {
                  feature: 'staking',
                  action: baseCtx.action,
                  srcChainKey: baseCtx.srcChainKey,
                }),
              };
            }
            hubTxHash = packetResult.value.dst_tx_hash;
          } else {
            hubTxHash = txResult.value.tx;
          }

          return { ok: true, value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: hubTxHash } };
        } catch (error) {
          if (isStakingOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('staking', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          requestId: _params.params.requestId,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Submits the cancel-unstake transaction on the spoke chain without relaying to the hub.
   *
   * Encodes and sends the `sendMessage` spoke transaction carrying the hub payload built by
   * `buildCancelUnstakeData`. The hub will abort the unstake request and redeposit the SODA as xSoda.
   *
   * Use this when you need manual control over the relay step. For the full end-to-end flow use `cancelUnstake`.
   *
   * @param _params - Cancel-unstake action params; set `raw: true` to receive ABI-encoded call data instead of broadcasting.
   * @returns `IntentTxResult` containing the spoke tx result and `relayData` (hub wallet address + encoded payload).
   */
  async createCancelUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: CancelUnstakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'cancelUnstake' as const };
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey);

      const data = await this.buildCancelUnstakeData(params, hubWallet);

      const coreParams = {
        srcAddress: params.srcAddress as GetAddressType<K>,
        srcChainKey: params.srcChainKey,
        dstChainKey: this.hubProvider.chainConfig.chain.key,
        dstAddress: hubWallet,
        payload: data,
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
        if (isStakingCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('staking', txResult.error, baseCtx),
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
      if (isStakingCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('staking', error, baseCtx),
      };
    }
  }

  /**
   * Fetches the pending unstake request on-chain and encodes the hub payload to cancel it.
   *
   * The encoded sequence is:
   * 1. StakedSoda.cancelUnstakeRequest — removes the unstake request and returns the SODA
   * 2. ERC-20 approve of the returned SODA to the xSoda vault
   * 3. xSoda ERC-4626 deposit — re-stakes the SODA as xSoda shares for the hub wallet
   *
   * @param params - Cancel-unstake params carrying the requestId used to look up the on-chain request.
   * @param hubWallet - Hub wallet address that owns the unstake request and will receive the re-staked xSoda.
   * @returns ABI-encoded batch call payload to be forwarded to the hub.
   * @throws If no unstake request matching `params.requestId` exists for the hub wallet.
   */
  public async buildCancelUnstakeData<K extends SpokeChainKey>(
    params: CancelUnstakeParams<K>,
    hubWallet: Address,
  ): Promise<Hex> {
    const hubConfig = this.config.getHubChainConfig();
    const stakedSoda = hubConfig.addresses.stakedSoda;
    const xSoda = hubConfig.addresses.xSoda;

    // Fetch the unstake request to get the amount
    const unstakeRequests = await StakingLogic.getUnstakeSodaRequests(
      stakedSoda,
      hubWallet,
      this.hubProvider.publicClient,
    );

    const request = unstakeRequests.find(req => req.id === params.requestId);
    if (!request) {
      throw new Error(`Unstake request with ID ${params.requestId} not found`);
    }

    const amount = request.request.amount;

    const calls: EvmContractCall[] = [];
    calls.push(StakingLogic.encodeCancelUnstakeRequest(stakedSoda, params.requestId));
    calls.push(Erc20Service.encodeApprove(stakedSoda, xSoda, amount));
    calls.push(StakingLogic.encodeXSodaDeposit(xSoda, amount, hubWallet));
    return encodeContractCalls(calls);
  }

  /**
   * Fetches comprehensive staking information for a user identified by their spoke-chain address.
   *
   * Resolves the hub wallet address from the spoke address, then delegates to `getStakingInfo`.
   *
   * @param srcAddress - The user's wallet address on the source spoke chain.
   * @param srcChainKey - The spoke chain the user is operating from.
   * @returns `StakingInfo` containing total vault assets and the user's xSoda balance and SODA equivalent.
   */
  public async getStakingInfoFromSpoke<K extends SpokeChainKey>(
    srcAddress: Address,
    srcChainKey: K,
  ): Promise<Result<StakingInfo, StakingInfoFetchError>> {
    try {
      const hubWallet = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);

      return this.getStakingInfo(hubWallet);
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getStakingInfoFromSpoke', error, { srcChainKey }),
      };
    }
  }

  /**
   * Fetches comprehensive staking information for a hub wallet address.
   *
   * Makes two parallel on-chain reads against the xSoda vault:
   * - Total SODA assets held by the vault (`totalAssets`)
   * - The user's raw xSoda share balance
   *
   * Then converts the user's share balance to its underlying SODA value.
   *
   * @param userAddress - The user's hub wallet address (not the spoke address).
   * @returns `StakingInfo` with `totalStaked`, `totalUnderlying`, `userXSodaBalance`, `userXSodaValue`, and `userUnderlying`.
   */
  public async getStakingInfo(userAddress: Address): Promise<Result<StakingInfo, StakingInfoFetchError>> {
    try {
      stakingInvariant(userAddress, 'User address is required', { field: 'userAddress' });

      const hubConfig = this.config.getHubChainConfig();
      const xSoda = hubConfig.addresses.xSoda;

      const [totalUnderlying, userXSodaShares] = await Promise.all([
        StakingLogic.getXSodaTotalAssets(xSoda, this.hubProvider.publicClient), // Get total assets in xSoda vault (total underlying SODA)
        this.getXSodaBalance(xSoda, userAddress), // Get user's raw xSODA shares
      ]);

      // Convert user's xSODA shares to SODA value
      const userXSodaValue = await StakingLogic.convertXSodaSharesToSoda(
        xSoda,
        userXSodaShares,
        this.hubProvider.publicClient,
      );

      return {
        ok: true,
        value: {
          totalStaked: totalUnderlying, // Total SODA staked (same as total underlying)
          totalUnderlying, // Total underlying SODA assets
          userXSodaBalance: userXSodaShares, // User's raw xSODA shares
          userXSodaValue, // User's xSODA value in SODA
          userUnderlying: userXSodaValue, // User's underlying SODA amount
        },
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getStakingInfo', error),
      };
    }
  }

  /**
   * Fetches all pending unstake requests and the total SODA amount currently unstaking for a user.
   *
   * Resolves the hub wallet from the spoke address and reads all `UserUnstakeInfo` records from
   * the StakedSoda contract. Also sums the individual request amounts into `totalUnstaking`.
   *
   * @param srcAddress - The user's wallet address on the source spoke chain.
   * @param srcChainKey - The spoke chain the user is operating from.
   * @returns `UnstakingInfo` with the list of raw unstake requests and their aggregate SODA amount.
   */
  public async getUnstakingInfo<K extends SpokeChainKey>(
    srcAddress: Address,
    srcChainKey: K,
  ): Promise<Result<UnstakingInfo, StakingInfoFetchError>> {
    try {
      const userAddress = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);

      const hubConfig = this.config.getHubChainConfig();
      const stakedSoda = hubConfig.addresses.stakedSoda;

      // Get user's unstake requests
      const userUnstakeSodaRequests = await StakingLogic.getUnstakeSodaRequests(
        stakedSoda,
        userAddress,
        this.hubProvider.publicClient,
      );

      // Calculate total unstaking amount
      const totalUnstaking = userUnstakeSodaRequests.reduce((total, userInfo) => total + userInfo.request.amount, 0n);

      return {
        ok: true,
        value: {
          userUnstakeSodaRequests,
          totalUnstaking,
        },
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getUnstakingInfo', error, { srcChainKey }),
      };
    }
  }

  /**
   * Reads the current staking configuration from the StakedSoda contract.
   *
   * Returns the three parameters that govern the unstaking penalty model:
   * - `unstakingPeriod` — full wait duration in seconds; no penalty after this elapses
   * - `minUnstakingPeriod` — minimum wait in seconds; max penalty applies before this elapses
   * - `maxPenalty` — maximum penalty percentage (1–100)
   *
   * @returns `StakingConfig` with penalty-model parameters, all as `bigint` (seconds / percentage).
   */
  public async getStakingConfig(): Promise<Result<StakingConfig, StakingInfoFetchError>> {
    try {
      const hubConfig = this.config.getHubChainConfig();
      const stakedSoda = hubConfig.addresses.stakedSoda;

      // Read all configuration values in a single contract call
      const [unstakingPeriod, minUnstakingPeriod, maxPenalty] = await this.hubProvider.publicClient.readContract({
        address: stakedSoda,
        abi: stakedSodaAbi,
        functionName: 'getParameters',
      });

      return {
        ok: true,
        value: {
          unstakingPeriod: unstakingPeriod,
          minUnstakingPeriod: minUnstakingPeriod,
          maxPenalty: maxPenalty,
        },
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getStakingConfig', error),
      };
    }
  }

  /**
   * Calculate penalty for an unstake request based on the contract logic
   * @param startTime - The start time of the unstake request
   * @param config - The staking configuration
   * @returns The penalty amount and percentage
   */
  private calculatePenalty(startTime: bigint, config: StakingConfig): { penalty: bigint; penaltyPercentage: number } {
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const timeElapsed = currentTime - startTime;

    // Check if unstaking period is less than minimum
    if (timeElapsed < config.minUnstakingPeriod) {
      // Return max penalty if still in minimum period
      return {
        penalty: config.maxPenalty, // penalty stored as 0-100 percent; divided by 100 at usage sites
        penaltyPercentage: Number(config.maxPenalty),
      };
    }

    // If time elapsed is greater than or equal to unstaking period, no penalty
    if (timeElapsed >= config.unstakingPeriod) {
      return {
        penalty: 0n,
        penaltyPercentage: 0,
      };
    }

    // Calculate penalty based on time in reduction period
    const timeInReductionPeriod = timeElapsed - config.minUnstakingPeriod;
    const totalReductionPeriod = config.unstakingPeriod - config.minUnstakingPeriod;

    // Calculate penalty: (maxPenalty * (totalReductionPeriod - timeInReductionPeriod)) / totalReductionPeriod
    const penalty = (config.maxPenalty * (totalReductionPeriod - timeInReductionPeriod)) / totalReductionPeriod;

    return {
      penalty, // penalty stored as 0-100 percent; divided by 100 at usage sites
      penaltyPercentage: Number(penalty),
    };
  }

  /**
   * Fetches all pending unstake requests enriched with current penalty calculations.
   *
   * Fetches `getUnstakingInfo` and `getStakingConfig` in parallel, then applies the linear penalty
   * model to each request based on how much time has elapsed since the request started:
   * - Before `minUnstakingPeriod`: `maxPenalty` applies in full
   * - Between `minUnstakingPeriod` and `unstakingPeriod`: penalty decreases linearly to zero
   * - After `unstakingPeriod`: no penalty
   *
   * @param srcAddress - The user's wallet address on the source spoke chain.
   * @param srcChainKey - The spoke chain the user is operating from.
   * @returns `UnstakingInfo` extended with `requestsWithPenalty` — each request annotated with
   *   `penalty` (SODA withheld), `penaltyPercentage` (0–100), and `claimableAmount` (net SODA receivable).
   */
  public async getUnstakingInfoWithPenalty<K extends SpokeChainKey>(
    srcAddress: Address,
    srcChainKey: K,
  ): Promise<Result<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }, StakingInfoFetchError>> {
    try {
      const [unstakingResult, configResult] = await Promise.all([
        this.getUnstakingInfo(srcAddress, srcChainKey),
        this.getStakingConfig(),
      ]);

      if (!unstakingResult.ok) {
        return { ok: false, error: unstakingResult.error };
      }

      if (!configResult.ok) return { ok: false, error: configResult.error };

      const config = configResult.value;
      const requestsWithPenalty: UnstakeRequestWithPenalty[] = unstakingResult.value.userUnstakeSodaRequests.map(
        userInfo => {
          const penaltyInfo = this.calculatePenalty(userInfo.request.startTime, config);
          const penaltyAmount = (userInfo.request.amount * penaltyInfo.penalty) / 100n; // Convert from basis points
          const claimableAmount = userInfo.request.amount - penaltyAmount;

          return {
            ...userInfo,
            penalty: penaltyAmount,
            penaltyPercentage: penaltyInfo.penaltyPercentage,
            claimableAmount,
          };
        },
      );

      return {
        ok: true,
        value: {
          ...unstakingResult.value,
          requestsWithPenalty,
        },
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getUnstakingInfoWithPenalty', error, { srcChainKey }),
      };
    }
  }

  /**
   * Estimates the SODA amount receivable from instantly unstaking a given quantity of xSoda shares.
   *
   * Calls `StakingRouter.estimateInstantUnstake` on-chain. Use this before calling `instantUnstake`
   * to set an appropriate `minAmount` slippage guard.
   *
   * @param amount - The number of xSoda shares to estimate the instant unstake for.
   * @returns The estimated SODA output (before any transaction-level slippage), as a `bigint`.
   */
  public async getInstantUnstakeRatio(amount: bigint): Promise<Result<bigint, StakingInfoFetchError>> {
    try {
      const hubConfig = this.config.getHubChainConfig();
      const stakingRouter = hubConfig.addresses.stakingRouter;

      const ratio = await StakingLogic.estimateInstantUnstake(stakingRouter, amount, this.hubProvider.publicClient);

      return {
        ok: true,
        value: ratio,
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getInstantUnstakeRatio', error),
      };
    }
  }

  /**
   * Converts a quantity of xSoda shares to its current underlying SODA value.
   *
   * Delegates to the xSoda vault's `convertToAssets` view function. The result reflects the
   * current exchange rate and will increase over time as staking rewards accrue to the vault.
   *
   * @param amount - The number of xSoda shares to convert.
   * @returns The equivalent SODA asset amount at the current exchange rate.
   */
  public async getConvertedAssets(amount: bigint): Promise<Result<bigint, StakingInfoFetchError>> {
    try {
      const hubConfig = this.config.getHubChainConfig();
      const xSoda = hubConfig.addresses.xSoda;

      const convertedAmount = await StakingLogic.convertXSodaSharesToSoda(xSoda, amount, this.hubProvider.publicClient);

      return {
        ok: true,
        value: convertedAmount,
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getConvertedAssets', error),
      };
    }
  }

  /**
   * Estimates the xSoda shares and preview-deposit amount for a given SODA input.
   *
   * Calls `StakingRouter.estimateXSodaAmount` on-chain, which accounts for vault fees and the
   * current exchange rate. Use this to display expected output before a stake transaction.
   *
   * @param amount - The SODA amount the user intends to stake.
   * @returns A tuple `[xSodaAmount, previewDepositAmount]`:
   *   - `xSodaAmount`: estimated xSoda shares the user will receive
   *   - `previewDepositAmount`: SODA amount as seen by the vault's `previewDeposit` function
   */
  public async getStakeRatio(amount: bigint): Promise<Result<[bigint, bigint], StakingInfoFetchError>> {
    try {
      const hubConfig = this.config.getHubChainConfig();
      const stakingRouter = hubConfig.addresses.stakingRouter;

      const [xSodaAmount, previewDepositAmount] = await StakingLogic.estimateXSodaAmount(
        stakingRouter,
        amount,
        this.hubProvider.publicClient,
      );

      return {
        ok: true,
        value: [xSodaAmount, previewDepositAmount],
      };
    } catch (error) {
      if (isStakingInfoFetchError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('staking', 'getStakeRatio', error),
      };
    }
  }

  /**
   * Helper method to get xSoda balance for a user
   * @param xSoda - The xSoda token contract address
   * @param userAddress - The user's address
   * @returns Promise<bigint>
   */
  private async getXSodaBalance(xSoda: Address, userAddress: Address): Promise<bigint> {
    return this.hubProvider.publicClient.readContract({
      address: xSoda,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [userAddress],
    });
  }
}
