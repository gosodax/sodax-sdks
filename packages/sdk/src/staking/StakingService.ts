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
  type DepositReturnType,
  type SendMessageReturnType,
  isMpcRelayChainKey,
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

// Staking settles through the intent relay, which an MPC-relay chain does not use; SODA is not on one either.
const MPC_RELAY_UNSUPPORTED_MESSAGE =
  'Staking does not support MPC-relay source chains; use a supported spoke or the hub';

function refuseMpcRelaySource(ctx: {
  srcChainKey: SpokeChainKey;
  action: StakingActionUnion<SpokeChainKey>['action'];
}): void {
  stakingInvariant(!isMpcRelayChainKey(ctx.srcChainKey), MPC_RELAY_UNSUPPORTED_MESSAGE, {
    ...ctx,
    field: 'srcChainKey',
  });
}

export type StakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  amount: bigint;
  minReceive: bigint;
  action: 'stake';
};

export type StakeAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<K, Raw, StakeParams<K>>;

export type UnstakeParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: Address;
  amount: bigint; // xSoda amount
  action: 'unstake';
};

export type UnstakeAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  UnstakeParams<K>
>;

export type ClaimParams<K extends SpokeChainKey> = {
  srcAddress: Address;
  srcChainKey: K;
  requestId: bigint;
  amount: bigint; // claimable amount after penalty
  action: 'claim';
};

export type ClaimAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<K, Raw, ClaimParams<K>>;

export type CancelUnstakeParams<K extends SpokeChainKey> = {
  srcAddress: Address;
  srcChainKey: K;
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
  srcChainKey: K;
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
  totalStaked: bigint; // xSODA vault totalAssets
  totalUnderlying: bigint;
  userXSodaBalance: bigint; // raw xSODA shares
  userXSodaValue: bigint; // shares converted to SODA
  userUnderlying: bigint;
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
 * SODA staking into the hub xSoda ERC-4626 vault; unstake carries a linear penalty until the period elapses.
 * `create*Intent` methods submit the spoke tx only; the top-level methods also relay to the hub and wait for the packet.
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

  /** Allowance check for `stake`/`unstake`/`instantUnstake`; EVM and Stellar only, other chains always resolve `true`. */
  public async isAllowanceValid<K extends SpokeChainKey, Raw extends boolean>(
    _params: StakingParamsUnion<K, Raw>,
  ): Promise<Result<boolean, StakingAllowanceCheckError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: params.action };
    try {
      refuseMpcRelaySource(baseCtx);
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

  /** Approves the hub wallet (hub chain) or asset manager (EVM spoke); only EVM and Stellar support approvals. */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: StakingParamsUnion<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>, StakingApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: params.action };

    const wrapApproveFailure = (cause: unknown) => approveFailed('staking', cause, baseCtx);

    try {
      refuseMpcRelaySource(baseCtx);
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

      stakingInvariant(false, 'Approval only supported for EVM spoke chains and Stellar', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isStakingApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /** Stakes SODA and waits for the hub tx; for hub-chain callers both hashes are identical. */
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
          if (!txResult.ok) return { ok: false, error: txResult.error };

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

  async createStakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: StakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params, skipSimulation } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'stake' as const };
    try {
      refuseMpcRelaySource(baseCtx);
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
          tx: txResult.value satisfies DepositReturnType<K, Raw> as DepositReturnType<K, Raw>,
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

  /** Starts a delayed unstake request; SODA is received via `claim`, with a penalty if claimed early. */
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

  async createUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: UnstakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'unstake' as const };
    try {
      refuseMpcRelaySource(baseCtx);
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
          tx: txResult.value satisfies SendMessageReturnType<K, Raw> as SendMessageReturnType<K, Raw>,
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

  /** Redeems xSoda immediately via the StakingRouter at the cost of slippage (preview with `getInstantUnstakeRatio`). */
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

  async createInstantUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: InstantUnstakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'instantUnstake' as const };
    try {
      refuseMpcRelaySource(baseCtx);
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
          tx: txResult.value satisfies SendMessageReturnType<K, boolean> as SendMessageReturnType<K, Raw>,
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

  /** Claims SODA from an unstake request; preview the post-penalty amount with `getUnstakingInfoWithPenalty`. */
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

  async createClaimIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: ClaimAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'claim' as const };
    try {
      refuseMpcRelaySource(baseCtx);
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
          tx: txResult.value satisfies SendMessageReturnType<K, Raw> as SendMessageReturnType<K, Raw>,
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

  /** Cancels a pending unstake request and re-stakes the SODA as xSoda credited to the hub wallet. */
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

  async createCancelUnstakeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: CancelUnstakeAction<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, StakingCreateIntentError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: 'cancelUnstake' as const };
    try {
      refuseMpcRelaySource(baseCtx);
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
          tx: txResult.value satisfies SendMessageReturnType<K, Raw> as SendMessageReturnType<K, Raw>,
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

  /** Reads the on-chain unstake request to get its amount; throws if `requestId` is not found for the hub wallet. */
  public async buildCancelUnstakeData<K extends SpokeChainKey>(
    params: CancelUnstakeParams<K>,
    hubWallet: Address,
  ): Promise<Hex> {
    const hubConfig = this.config.getHubChainConfig();
    const stakedSoda = hubConfig.addresses.stakedSoda;
    const xSoda = hubConfig.addresses.xSoda;

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

  /** @param userAddress - hub wallet address, not the spoke address */
  public async getStakingInfo(userAddress: Address): Promise<Result<StakingInfo, StakingInfoFetchError>> {
    try {
      stakingInvariant(userAddress, 'User address is required', { field: 'userAddress' });

      const hubConfig = this.config.getHubChainConfig();
      const xSoda = hubConfig.addresses.xSoda;

      const [totalUnderlying, userXSodaShares] = await Promise.all([
        StakingLogic.getXSodaTotalAssets(xSoda, this.hubProvider.publicClient),
        this.getXSodaBalance(xSoda, userAddress),
      ]);

      const userXSodaValue = await StakingLogic.convertXSodaSharesToSoda(
        xSoda,
        userXSodaShares,
        this.hubProvider.publicClient,
      );

      return {
        ok: true,
        value: {
          totalStaked: totalUnderlying,
          totalUnderlying,
          userXSodaBalance: userXSodaShares,
          userXSodaValue,
          userUnderlying: userXSodaValue,
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

  public async getUnstakingInfo<K extends SpokeChainKey>(
    srcAddress: Address,
    srcChainKey: K,
  ): Promise<Result<UnstakingInfo, StakingInfoFetchError>> {
    try {
      const userAddress = await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey);

      const hubConfig = this.config.getHubChainConfig();
      const stakedSoda = hubConfig.addresses.stakedSoda;

      const userUnstakeSodaRequests = await StakingLogic.getUnstakeSodaRequests(
        stakedSoda,
        userAddress,
        this.hubProvider.publicClient,
      );

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

  public async getStakingConfig(): Promise<Result<StakingConfig, StakingInfoFetchError>> {
    try {
      const hubConfig = this.config.getHubChainConfig();
      const stakedSoda = hubConfig.addresses.stakedSoda;

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

  /** Mirrors the contract: max penalty before `minUnstakingPeriod`, linear decay to 0 at `unstakingPeriod`. */
  private calculatePenalty(startTime: bigint, config: StakingConfig): { penalty: bigint; penaltyPercentage: number } {
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const timeElapsed = currentTime - startTime;

    if (timeElapsed < config.minUnstakingPeriod) {
      return {
        penalty: config.maxPenalty, // penalty stored as 0-100 percent; divided by 100 at usage sites
        penaltyPercentage: Number(config.maxPenalty),
      };
    }

    if (timeElapsed >= config.unstakingPeriod) {
      return {
        penalty: 0n,
        penaltyPercentage: 0,
      };
    }

    const timeInReductionPeriod = timeElapsed - config.minUnstakingPeriod;
    const totalReductionPeriod = config.unstakingPeriod - config.minUnstakingPeriod;

    const penalty = (config.maxPenalty * (totalReductionPeriod - timeInReductionPeriod)) / totalReductionPeriod;

    return {
      penalty, // penalty stored as 0-100 percent; divided by 100 at usage sites
      penaltyPercentage: Number(penalty),
    };
  }

  /** Annotates each request with `penalty` (SODA withheld), `penaltyPercentage` (0–100) and net `claimableAmount`. */
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
          const penaltyAmount = (userInfo.request.amount * penaltyInfo.penalty) / 100n; // penalty is 0-100 percent
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

  /** Estimated SODA out for instantly unstaking `amount` xSoda shares; use it to set `minAmount`. */
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

  /** Returns `[xSodaAmount, previewDepositAmount]` for staking `amount` SODA. */
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

  private async getXSodaBalance(xSoda: Address, userAddress: Address): Promise<bigint> {
    return this.hubProvider.publicClient.readContract({
      address: xSoda,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [userAddress],
    });
  }
}
