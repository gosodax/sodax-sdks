import { encodeFunctionData, isAddress } from 'viem';
import { mapRelayFailure, type MapRelayFailureCtx } from '../errors/relay-error-mapping.js';
import {
  verifyFailed,
  intentCreationFailed,
  executionFailed,
  approveFailed,
  allowanceCheckFailed,
  gasEstimationFailed,
} from '../errors/wrappers.js';
import {
  type MoneyMarketAllowanceCheckError,
  type MoneyMarketApproveError,
  type MoneyMarketCreateIntentError,
  type MoneyMarketGasEstimationError,
  type MoneyMarketOrchestrationError,
  isMoneyMarketAllowanceCheckError,
  isMoneyMarketApproveError,
  isMoneyMarketCreateIntentError,
  isMoneyMarketGasEstimationError,
  isMoneyMarketOrchestrationError,
  mmInvariant,
} from './errors.js';
import { poolAbi } from '../shared/abis/pool.abi.js';
import {
  type SpokeService,
  type ConfigService,
  type SendMessageParams,
  type EstimateGasParams,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsStellar,
  Erc20Service,
  EvmAssetManagerService,
  EvmVaultTokenService,
  encodeContractCalls,
  assertMpcPayoutAboveMinimum,
  encodeRecipient,
  calculateFeeAmount,
  wrappedSonicAbi,
  isHubChainKeyType,
  isEvmSpokeOnlyChainKeyType,
  isStellarChainKeyType,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  isUndefinedOrValidWalletProviderForChainKey,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
} from '../shared/index.js';
import type { HubProvider, IntentTxResult, OutboundSettlement, TxHashPair } from '../shared/types/types.js';
import type { SettlementFailure } from '../shared/types/spoke-types.js';
import {
  type SpokeChainKey,
  type XToken,
  type Address,
  type Hex,
  type HttpUrl,
  type EvmContractCall,
  type Result,
  type TxReturnType,
  type GetAddressType,
  type GetTokenAddressType,
  type GetWalletProviderType,
  type GetEstimateGasReturnType,
  type PartnerFee,
  type HubChainKey,
  type EvmSpokeOnlyChainKey,
  type StellarChainKey,
  type GetMoneyMarketTokensApiResponse,
  isMpcRelayChainKey,
  DEFAULT_RELAY_TX_TIMEOUT,
  HUB_CHAIN_KEY,
  type SpokeExecActionParams,
  type DepositReturnType,
  type SendMessageReturnType,
} from '@sodax/types';
import { MoneyMarketDataService } from './MoneyMarketDataService.js';

export type MoneyMarketEncodeSupplyParams = {
  asset: Address;
  amount: bigint;
  onBehalfOf: Address;
  referralCode: number;
};

export type MoneyMarketEncodeWithdrawParams = {
  asset: Address;
  amount: bigint;
  to: Address;
};

export type MoneyMarketEncodeBorrowParams = {
  asset: Address;
  amount: bigint;
  interestRateMode: bigint; // 2 = variable
  referralCode: number;
  onBehalfOf: Address;
};

export type MoneyMarketEncodeRepayParams = {
  asset: Address;
  amount: bigint;
  interestRateMode: bigint; // 2 = variable
  onBehalfOf: Address; // account whose debt is reduced
};

export type MoneyMarketEncodeRepayWithATokensParams = {
  asset: Address;
  amount: bigint;
  interestRateMode: bigint; // 2 = variable
};

/** `srcChainKey: K` drives chain-narrowing of the associated walletProvider. */
export type MoneyMarketSupplyParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  token: string;
  amount: bigint;
  action: 'supply';
  dstChainKey?: SpokeChainKey;
  dstAddress?: string;
};

export type MoneyMarketBorrowParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  token: string;
  amount: bigint;
  action: 'borrow';
  dstChainKey?: SpokeChainKey;
  dstAddress?: string;
};

export type MoneyMarketWithdrawParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  token: string;
  amount: bigint;
  action: 'withdraw';
  dstChainKey?: SpokeChainKey;
  dstAddress?: string;
};

export type MoneyMarketRepayParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcChainKey: K;
  srcAddress: string;
  token: string;
  amount: bigint;
  action: 'repay';
  dstChainKey?: SpokeChainKey;
  dstAddress?: string;
};

export type MoneyMarketParams<K extends SpokeChainKey = SpokeChainKey> =
  | MoneyMarketSupplyParams<K>
  | MoneyMarketBorrowParams<K>
  | MoneyMarketWithdrawParams<K>
  | MoneyMarketRepayParams<K>;

export type MoneyMarketSupplyActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  MoneyMarketSupplyParams<K>
>;

export type MoneyMarketBorrowActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  MoneyMarketBorrowParams<K>
>;

export type MoneyMarketWithdrawActionParams<
  K extends SpokeChainKey,
  Raw extends boolean = false,
> = SpokeExecActionParams<K, Raw, MoneyMarketWithdrawParams<K>>;

export type MoneyMarketRepayActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  MoneyMarketRepayParams<K>
>;

export type MoneyMarketAllowanceParams<K extends SpokeChainKey> = {
  params: MoneyMarketParams<K>;
};

// Accepts any action, but only supply/repay actually require approval on EVM.
export type MoneyMarketApproveActionParams<
  K extends SpokeChainKey,
  Raw extends boolean = false,
> = SpokeExecActionParams<K, Raw, MoneyMarketParams<K>>;

export type MoneyMarketServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
  hubProvider: HubProvider;
};

// Aave v3 `ReserveConfiguration` flags the pool checks before a borrow.
const RESERVE_ACTIVE = 1n << 56n;
const RESERVE_FROZEN = 1n << 57n;
const RESERVE_BORROWING_ENABLED = 1n << 58n;
const RESERVE_PAUSED = 1n << 60n;

const isReserveBorrowable = (configuration: bigint): boolean =>
  (configuration & (RESERVE_ACTIVE | RESERVE_FROZEN | RESERVE_BORROWING_ENABLED | RESERVE_PAUSED)) ===
  (RESERVE_ACTIVE | RESERVE_BORROWING_ENABLED);

/**
 * Money market supply/borrow/withdraw/repay, relayed from any spoke to the Aave-style pool on the hub.
 * @namespace SodaxFeatures
 */
export class MoneyMarketService {
  readonly hubProvider: HubProvider;
  readonly config: ConfigService;
  readonly spoke: SpokeService;

  readonly relayerApiEndpoint: HttpUrl;
  readonly data: MoneyMarketDataService;

  /**
   * Effective partner fee (`moneyMarket.partnerFee`, else global `fee`), read live so it tracks config replacement.
   * Money market has no per-action override.
   */
  get partnerFee(): PartnerFee | undefined {
    return this.config.moneyMarketPartnerFee;
  }

  public constructor({ config, hubProvider, spoke }: MoneyMarketServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.data = new MoneyMarketDataService({ hubProvider, config: config });
  }

  public async estimateGas<K extends SpokeChainKey>(
    params: EstimateGasParams<K>,
  ): Promise<Result<GetEstimateGasReturnType<K>, MoneyMarketGasEstimationError>> {
    try {
      const result = (await this.spoke.estimateGas(params)) as Result<GetEstimateGasReturnType<K>>;
      if (result.ok) return result;
      return {
        ok: false,
        error: gasEstimationFailed('moneyMarket', result.error),
      };
    } catch (error) {
      if (isMoneyMarketGasEstimationError(error)) return { ok: false, error };
      return {
        ok: false,
        error: gasEstimationFailed('moneyMarket', error),
      };
    }
  }

  /**
   * Checks ERC-20 allowance (hub router / spoke asset manager) or Stellar trustlines on sender and recipient.
   * Withdraw/borrow on EVM need no approval and always return `true`.
   */
  public async isAllowanceValid<K extends SpokeChainKey>(
    _params: MoneyMarketAllowanceParams<K>,
  ): Promise<Result<boolean, MoneyMarketAllowanceCheckError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: params.action };

    try {
      mmInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      mmInvariant(params.token.length > 0, 'Token is required', { ...baseCtx, field: 'token' });

      if (params.action === 'withdraw' || params.action === 'borrow') {
        const dstChainKey = params.dstChainKey ?? srcChainKey;
        mmInvariant(
          this.config.isMoneyMarketSupportedToken(dstChainKey, params.token),
          `Unsupported spoke chain (${dstChainKey}) token: ${params.token}`,
          { ...baseCtx, field: 'token' },
        );
      } else {
        mmInvariant(
          this.config.isMoneyMarketSupportedToken(srcChainKey, params.token),
          `Unsupported spoke chain (${srcChainKey}) token: ${params.token}`,
          { ...baseCtx, field: 'token' },
        );
      }

      let inner: Result<boolean> = { ok: true, value: true };

      // Stellar recipient (and Stellar sender, if any) must both hold a trustline for the token.
      if (params.dstChainKey && isStellarChainKeyType(params.dstChainKey) && params.dstAddress) {
        const targetResult = await this.spoke.isAllowanceValid({
          srcChainKey: params.dstChainKey,
          token: params.token,
          amount: params.amount,
          owner: params.dstAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);

        if (!targetResult.ok) {
          inner = targetResult;
        } else {
          let srcHasTrustline = true;
          if (isStellarChainKeyType(srcChainKey)) {
            const allowanceResult = await this.spoke.isAllowanceValid({
              srcChainKey,
              token: params.token,
              amount: params.amount,
              owner: params.srcAddress,
            } satisfies SpokeIsAllowanceValidParamsStellar);

            if (!allowanceResult.ok) {
              inner = allowanceResult;
            } else {
              srcHasTrustline = allowanceResult.value;
              inner = { ok: true, value: targetResult.value && srcHasTrustline };
            }
          } else {
            inner = { ok: true, value: targetResult.value };
          }
        }
      } else if (isStellarChainKeyType(srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.token,
          amount: params.amount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);
      } else if (params.action === 'supply' || params.action === 'repay') {
        if (isHubChainKeyType(srcChainKey)) {
          const spender = await this.hubProvider.getUserRouter(params.srcAddress as Address);
          inner = await this.spoke.isAllowanceValid({
            srcChainKey,
            token: params.token,
            amount: params.amount,
            owner: params.srcAddress,
            spender,
          } satisfies SpokeIsAllowanceValidParamsHub);
        } else if (isEvmSpokeOnlyChainKeyType(srcChainKey)) {
          inner = await this.spoke.isAllowanceValid({
            srcChainKey,
            token: params.token,
            amount: params.amount,
            owner: params.srcAddress,
            spender: this.config.getChainConfig(srcChainKey).addresses.assetManager,
          } satisfies SpokeIsAllowanceValidParamsEvmSpoke);
        }
      }

      if (inner.ok) return inner;
      return {
        ok: false,
        error: allowanceCheckFailed('moneyMarket', inner.error, baseCtx),
      };
    } catch (error) {
      if (isMoneyMarketAllowanceCheckError(error)) return { ok: false, error };
      return {
        ok: false,
        error: allowanceCheckFailed('moneyMarket', error, baseCtx),
      };
    }
  }

  /**
   * Approves the hub router (hub) or asset manager (EVM spoke), or sets a Stellar trustline.
   * Borrow/withdraw on EVM return an error since they need no approval.
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketApproveActionParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>, MoneyMarketApproveError>> {
    const { params, walletProvider } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, action: params.action };

    const wrapApproveFailure = (cause: unknown) => approveFailed('moneyMarket', cause, baseCtx);

    try {
      mmInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      mmInvariant(params.token.length > 0, 'Token is required', { ...baseCtx, field: 'token' });
      mmInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}, walletProvider.chainType: ${walletProvider?.chainType}`,
        { ...baseCtx, field: 'walletProvider' },
      );

      if (isStellarChainKeyType(params.srcChainKey)) {
        mmInvariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );

        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.token,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
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

      mmInvariant(
        params.action === 'supply' || params.action === 'repay',
        'Invalid action (only supply and repay require approval on EVM)',
        { ...baseCtx, field: 'action' },
      );

      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        mmInvariant(isAddress(params.token), 'Invalid token address', { ...baseCtx, field: 'token' });

        mmInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );

        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserRouter(params.srcAddress as Address)
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.token as GetTokenAddressType<HubChainKey>,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<HubChainKey>,
          spender,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        });

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
        };
      }

      // Chains without approval support (Solana, NEAR, ...) fail as a validation error, not a generic Error.
      mmInvariant(false, 'Approve only supported for hub (Sonic), EVM spokes, and Stellar', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isMoneyMarketApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  public async supply<K extends SpokeChainKey>(
    _params: MoneyMarketSupplyActionParams<K, false>,
  ): Promise<Result<TxHashPair, MoneyMarketOrchestrationError>> {
    return this.config.analytics.trackResult(
      'moneyMarket',
      'supply',
      async () => {
        const { params, timeout = DEFAULT_RELAY_TX_TIMEOUT } = _params;
        const srcChainKey = params.srcChainKey;
        const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'supply' as const };

        try {
          const txResult = await this.createSupplyIntent(_params);
          if (!txResult.ok) return { ok: false, error: txResult.error };

          if (isHubChainKeyType(srcChainKey)) {
            const verify = await this.spoke.verifyTxHash({ txHash: txResult.value.tx, chainKey: srcChainKey });
            if (!verify.ok) return { ok: false, error: verifyFailed('moneyMarket', verify.error, baseCtx) };
            return {
              ok: true,
              value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: txResult.value.tx },
            };
          }

          const settled = await this.spoke.settle({
            chainKey: srcChainKey,
            tx: txResult.value.tx,
            direction: 'inbound',
            relayData: txResult.value.relayData,
            timeout,
          });
          if (!settled.ok) {
            return {
              ok: false,
              error: this.mapSettlementFailure(settled.error, { ...baseCtx, srcTxHash: txResult.value.tx }),
            };
          }

          return settled;
        } catch (error) {
          if (isMoneyMarketOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('moneyMarket', error, { ...baseCtx, phase: 'intentCreation' }),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstChainKey: _params.params.dstChainKey,
          dstAddress: _params.params.dstAddress,
          token: _params.params.token,
          amount: _params.params.amount,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Executes (or returns raw) the spoke-side supply tx plus `relayData`, without waiting for hub settlement. */
  public async createSupplyIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketSupplyActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'deposit'>, MoneyMarketCreateIntentError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    const skipSimulation = _params.skipSimulation ?? false;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'supply' as const };

    try {
      mmInvariant(params.action === 'supply', 'Invalid action', { ...baseCtx, field: 'action' });
      mmInvariant(params.token.length > 0, 'Token is required', { ...baseCtx, field: 'token' });
      mmInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      mmInvariant(
        isUndefinedOrValidWalletProviderForChainKey(srcChainKey, walletProvider),
        `Invalid wallet provider for chain key: ${srcChainKey}, walletProvider.chainType: ${walletProvider?.chainType}`,
        { ...baseCtx, field: 'walletProvider' },
      );
      mmInvariant(
        this.config.isMoneyMarketSupportedToken(srcChainKey, params.token),
        `Unsupported spoke chain (${srcChainKey}) token: ${params.token}`,
        { ...baseCtx, field: 'token' },
      );

      const dstChainKey = params.dstChainKey ?? srcChainKey;
      const dstAddress = params.dstAddress ?? params.srcAddress;

      // Bitcoin TRADING mode deposits from the Bound Exchange trading wallet, so the hub wallet derives from it.
      const isBitcoinSrc = isBitcoinChainKeyType(srcChainKey);
      if (isBitcoinSrc && !_params.raw) {
        // A wrong provider would silently skip the Bound session and fail opaquely deep in spoke.deposit.
        mmInvariant(
          walletProvider !== undefined && isBitcoinWalletProviderType(walletProvider),
          `Invalid wallet provider for chain key: ${srcChainKey}. Expected bitcoin wallet provider.`,
          { ...baseCtx, field: 'walletProvider' },
        );
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(walletProvider);
      }
      const srcEffectiveAddress = isBitcoinSrc
        ? await this.spoke.bitcoin.getEffectiveWalletAddress(params.srcAddress)
        : params.srcAddress;
      const fromHubWallet = await this.hubProvider.getUserHubWalletAddress(srcEffectiveAddress, srcChainKey);

      const toHubWallet =
        dstChainKey === srcChainKey && dstAddress === params.srcAddress
          ? fromHubWallet
          : await this.hubProvider.getUserHubWalletAddress(
              isBitcoinChainKeyType(dstChainKey)
                ? await this.spoke.bitcoin.getEffectiveWalletAddress(dstAddress)
                : dstAddress,
              dstChainKey,
            );

      const data: Hex = this.buildSupplyData(srcChainKey, params.token, params.amount, toHubWallet);

      const coreParams = {
        srcChainKey,
        srcAddress: srcEffectiveAddress as GetAddressType<K>,
        to: fromHubWallet,
        token: params.token as GetTokenAddressType<K>,
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
        if (isMoneyMarketCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('moneyMarket', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies DepositReturnType<K, Raw> as DepositReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isMoneyMarketCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('moneyMarket', error, baseCtx),
      };
    }
  }

  /**
   * Map a {@link SpokeService.settle} failure onto the money-market errors: a source tx that never
   * landed is a verification failure, anything later a relay failure.
   */
  private mapSettlementFailure(
    failure: SettlementFailure,
    ctx: Omit<MapRelayFailureCtx, 'feature'>,
  ): MoneyMarketOrchestrationError {
    return failure.phase === 'verification'
      ? verifyFailed('moneyMarket', failure.cause, ctx)
      : mapRelayFailure(failure.cause, { feature: 'moneyMarket', ...ctx });
  }

  /** From an MPC-relay chain, `srcChainTxHash` is replaced by the relay's `trackingId` ({@link OutboundSettlement}). */
  public async borrow<K extends SpokeChainKey>(
    _params: MoneyMarketBorrowActionParams<K, false>,
  ): Promise<Result<OutboundSettlement<K>, MoneyMarketOrchestrationError>> {
    return this.config.analytics.trackResult(
      'moneyMarket',
      'borrow',
      async () => {
        const { params, timeout = DEFAULT_RELAY_TX_TIMEOUT } = _params;
        const srcChainKey = params.srcChainKey;
        const hubChainId = this.hubProvider.chainConfig.chain.key;
        const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'borrow' as const };

        try {
          const txResult = await this.createBorrowIntent(_params);
          if (!txResult.ok) return { ok: false, error: txResult.error };

          // Hub-to-hub borrow needs no settlement; hub to another chain still needs the relay to deliver.
          const needsSettlement =
            srcChainKey !== hubChainId ||
            (params.dstChainKey != null && params.dstAddress != null && params.dstChainKey !== hubChainId);

          if (!needsSettlement) {
            const verify = await this.spoke.verifyTxHash({ txHash: txResult.value.tx, chainKey: srcChainKey });
            if (!verify.ok) return { ok: false, error: verifyFailed('moneyMarket', verify.error, baseCtx) };
            const onHub = { srcChainTxHash: txResult.value.tx, dstChainTxHash: txResult.value.tx };
            return { ok: true, value: onHub satisfies TxHashPair as OutboundSettlement<K> };
          }

          const settled = await this.spoke.settle({
            chainKey: srcChainKey,
            tx: txResult.value.tx,
            direction: 'outbound',
            relayData: txResult.value.relayData,
            timeout,
            dstChainKey: params.dstChainKey ?? srcChainKey,
          });
          if (!settled.ok) {
            return {
              ok: false,
              error: this.mapSettlementFailure(settled.error, {
                ...baseCtx,
                dstChainKey: params.dstChainKey ?? srcChainKey,
                relayData: txResult.value.relayData,
                ...(isMpcRelayChainKey(srcChainKey)
                  ? { trackingId: txResult.value.tx }
                  : {
                      srcTxHash: isBitcoinChainKeyType(srcChainKey)
                        ? this.spoke.bitcoin.getOnDemandRelayIdentity(txResult.value.tx).pollTxHash
                        : txResult.value.tx,
                    }),
              }),
            };
          }

          return settled;
        } catch (error) {
          if (isMoneyMarketOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('moneyMarket', error, { ...baseCtx, phase: 'intentCreation' }),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstChainKey: _params.params.dstChainKey,
          dstAddress: _params.params.dstAddress,
          token: _params.params.token,
          amount: _params.params.amount,
        }),
        success: value => ({ ...value }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Sends (or returns raw) the spoke-side borrow message plus `relayData`, without waiting for delivery. */
  public async createBorrowIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketBorrowActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'sendMessage'>, MoneyMarketCreateIntentError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    const skipSimulation = _params.skipSimulation ?? false;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'borrow' as const };

    try {
      mmInvariant(params.action === 'borrow', 'Invalid action', { ...baseCtx, field: 'action' });
      mmInvariant(params.token.length > 0, 'Token is required', { ...baseCtx, field: 'token' });
      mmInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      mmInvariant(
        isUndefinedOrValidWalletProviderForChainKey(srcChainKey, walletProvider),
        `Invalid wallet provider for chain key: ${srcChainKey}, walletProvider.chainType: ${walletProvider?.chainType}`,
        { ...baseCtx, field: 'walletProvider' },
      );

      const dstChainKey = params.dstChainKey ?? srcChainKey;
      const dstAddress = params.dstAddress ?? params.srcAddress;
      const dstToken = this.config.getMoneyMarketToken(dstChainKey, params.token);

      mmInvariant(dstToken, `Money market token not found for spoke chain (${dstChainKey}) token: ${params.token}`, {
        ...baseCtx,
        field: 'token',
      });
      const encodedDstAddress = encodeRecipient(dstChainKey, dstAddress);
      // What arrives is the amount after the partner fee, which must still clear an account-creating reserve.
      const toHubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(dstChainKey, dstToken.address);
      await this.spoke.assertReleaseRecipientReady({
        feature: 'moneyMarket',
        chainKey: dstChainKey,
        recipient: encodedDstAddress,
        token: dstToken.address,
        amount: toHubAsset ? this.borrowPayout(toHubAsset, dstToken, params.amount).translatedAmountOut : params.amount,
        context: { ...baseCtx, field: 'dstAddress' },
      });

      const { configuration } = await this.data.getReserveData(this.getBorrowReserve(dstToken.vault));
      mmInvariant(
        isReserveBorrowable(configuration),
        `${dstToken.symbol} cannot be borrowed: its money-market reserve is inactive, frozen, paused or has borrowing disabled`,
        { ...baseCtx, field: 'token' },
      );

      // Only the hub wallet uses the Bitcoin trading address: sendMessage resolves srcAddress itself,
      // so passing the trading address would double-resolve it ("Trading wallet not found").
      const srcEffectiveAddress = isBitcoinChainKeyType(srcChainKey)
        ? await this.spoke.bitcoin.getEffectiveWalletAddress(params.srcAddress)
        : params.srcAddress;
      const fromHubWallet = await this.hubProvider.getUserHubWalletAddress(srcEffectiveAddress, srcChainKey);

      const payload: Hex = this.buildBorrowData(
        fromHubWallet,
        encodedDstAddress,
        dstToken.address,
        params.amount,
        dstChainKey,
      );

      const coreParams = {
        srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        dstChainKey: HUB_CHAIN_KEY,
        dstAddress: fromHubWallet,
        payload,
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
            walletProvider: _params.walletProvider as GetWalletProviderType<K>,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        if (isMoneyMarketCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('moneyMarket', txResult.error, {
            ...baseCtx,
            dstChainKey,
            relayData: { address: fromHubWallet, payload },
          }),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies SendMessageReturnType<K, boolean> as SendMessageReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload },
        },
      };
    } catch (error) {
      if (isMoneyMarketCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('moneyMarket', error, baseCtx),
      };
    }
  }

  /** From an MPC-relay chain, `srcChainTxHash` is replaced by the relay's `trackingId` ({@link OutboundSettlement}). */
  public async withdraw<K extends SpokeChainKey>(
    _params: MoneyMarketWithdrawActionParams<K, false>,
  ): Promise<Result<OutboundSettlement<K>, MoneyMarketOrchestrationError>> {
    return this.config.analytics.trackResult(
      'moneyMarket',
      'withdraw',
      async () => {
        const { params, timeout = DEFAULT_RELAY_TX_TIMEOUT } = _params;
        const srcChainKey = params.srcChainKey;
        const hubChainId = this.hubProvider.chainConfig.chain.key;
        const walletRouter = this.hubProvider.chainConfig.addresses.walletRouter;
        const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'withdraw' as const };

        try {
          const txResult = await this.createWithdrawIntent(_params);
          if (!txResult.ok) return { ok: false, error: txResult.error };

          // No settlement only when source and target are hub and the target is not the walletRouter.
          const needsSettlement =
            srcChainKey !== hubChainId ||
            (params.dstChainKey != null &&
              params.dstAddress != null &&
              params.dstChainKey !== hubChainId &&
              params.dstAddress !== walletRouter);

          if (!needsSettlement) {
            const verify = await this.spoke.verifyTxHash({ txHash: txResult.value.tx, chainKey: srcChainKey });
            if (!verify.ok) return { ok: false, error: verifyFailed('moneyMarket', verify.error, baseCtx) };
            const onHub = { srcChainTxHash: txResult.value.tx, dstChainTxHash: txResult.value.tx };
            return { ok: true, value: onHub satisfies TxHashPair as OutboundSettlement<K> };
          }

          const settled = await this.spoke.settle({
            chainKey: srcChainKey,
            tx: txResult.value.tx,
            direction: 'outbound',
            relayData: txResult.value.relayData,
            timeout,
            dstChainKey: params.dstChainKey ?? srcChainKey,
          });
          if (!settled.ok) {
            return {
              ok: false,
              error: this.mapSettlementFailure(settled.error, {
                ...baseCtx,
                dstChainKey: params.dstChainKey ?? srcChainKey,
                relayData: txResult.value.relayData,
                ...(isMpcRelayChainKey(srcChainKey)
                  ? { trackingId: txResult.value.tx }
                  : {
                      srcTxHash: isBitcoinChainKeyType(srcChainKey)
                        ? this.spoke.bitcoin.getOnDemandRelayIdentity(txResult.value.tx).pollTxHash
                        : txResult.value.tx,
                    }),
              }),
            };
          }

          return settled;
        } catch (error) {
          if (isMoneyMarketOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('moneyMarket', error, { ...baseCtx, phase: 'intentCreation' }),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstChainKey: _params.params.dstChainKey,
          dstAddress: _params.params.dstAddress,
          token: _params.params.token,
          amount: _params.params.amount,
        }),
        success: value => ({ ...value }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Sends (or returns raw) the spoke-side withdraw message plus `relayData`, without waiting for delivery. */
  public async createWithdrawIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketWithdrawActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'sendMessage'>, MoneyMarketCreateIntentError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    const skipSimulation = _params.skipSimulation ?? false;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'withdraw' as const };

    try {
      mmInvariant(params.action === 'withdraw', 'Invalid action', { ...baseCtx, field: 'action' });
      mmInvariant(params.token.length > 0, 'Token is required', { ...baseCtx, field: 'token' });
      mmInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      mmInvariant(
        isUndefinedOrValidWalletProviderForChainKey(srcChainKey, walletProvider),
        `Invalid wallet provider for chain key: ${srcChainKey}, walletProvider.chainType: ${walletProvider?.chainType}`,
        { ...baseCtx, field: 'walletProvider' },
      );

      const dstChainKey = params.dstChainKey ?? srcChainKey;
      const dstAddress = params.dstAddress ?? params.srcAddress;

      mmInvariant(
        this.config.isMoneyMarketSupportedToken(dstChainKey, params.token),
        `Unsupported spoke chain (${dstChainKey}) token: ${params.token}`,
        { ...baseCtx, field: 'token' },
      );
      const dstToken = this.config.getMoneyMarketToken(dstChainKey, params.token);
      if (dstToken) {
        assertMpcPayoutAboveMinimum({
          feature: 'moneyMarket',
          dstChainKey: dstChainKey,
          token: dstToken,
          amount: params.amount,
          context: { ...baseCtx, field: 'amount' },
        });
      }

      const encodedDstAddress = encodeRecipient(dstChainKey, dstAddress);
      await this.spoke.assertReleaseRecipientReady({
        feature: 'moneyMarket',
        chainKey: dstChainKey,
        recipient: encodedDstAddress,
        token: params.token,
        amount: params.amount,
        context: { ...baseCtx, field: 'dstAddress' },
      });
      // Only the hub wallet uses the Bitcoin trading address: sendMessage resolves srcAddress itself,
      // so passing the trading address would double-resolve it ("Trading wallet not found").
      const srcEffectiveAddress = isBitcoinChainKeyType(srcChainKey)
        ? await this.spoke.bitcoin.getEffectiveWalletAddress(params.srcAddress)
        : params.srcAddress;
      const fromHubWallet = await this.hubProvider.getUserHubWalletAddress(srcEffectiveAddress, srcChainKey);

      const payload: Hex = this.buildWithdrawData(
        fromHubWallet,
        encodedDstAddress,
        params.token,
        params.amount,
        dstChainKey,
      );

      const coreParams = {
        srcChainKey,
        srcAddress: params.srcAddress as GetAddressType<K>,
        dstChainKey: HUB_CHAIN_KEY,
        dstAddress: fromHubWallet,
        payload,
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
            walletProvider: _params.walletProvider as GetWalletProviderType<K>,
          } satisfies SendMessageParams<K, false>);

      const txResult = await this.spoke.sendMessage(sendMessageParams);

      if (!txResult.ok) {
        if (isMoneyMarketCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('moneyMarket', txResult.error, {
            ...baseCtx,
            dstChainKey,
            relayData: { address: fromHubWallet, payload },
          }),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies SendMessageReturnType<K, boolean> as SendMessageReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload },
        },
      };
    } catch (error) {
      if (isMoneyMarketCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('moneyMarket', error, baseCtx),
      };
    }
  }

  public async repay<K extends SpokeChainKey>(
    _params: MoneyMarketRepayActionParams<K, false>,
  ): Promise<Result<TxHashPair, MoneyMarketOrchestrationError>> {
    return this.config.analytics.trackResult(
      'moneyMarket',
      'repay',
      async () => {
        const { params, timeout = DEFAULT_RELAY_TX_TIMEOUT } = _params;
        const srcChainKey = params.srcChainKey;
        const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'repay' as const };

        try {
          const txResult = await this.createRepayIntent(_params);
          if (!txResult.ok) return { ok: false, error: txResult.error };

          if (isHubChainKeyType(srcChainKey)) {
            const verify = await this.spoke.verifyTxHash({ txHash: txResult.value.tx, chainKey: srcChainKey });
            if (!verify.ok) return { ok: false, error: verifyFailed('moneyMarket', verify.error, baseCtx) };
            return {
              ok: true,
              value: { srcChainTxHash: txResult.value.tx, dstChainTxHash: txResult.value.tx },
            };
          }

          const settled = await this.spoke.settle({
            chainKey: srcChainKey,
            tx: txResult.value.tx,
            direction: 'inbound',
            relayData: txResult.value.relayData,
            timeout,
          });
          if (!settled.ok) {
            return {
              ok: false,
              error: this.mapSettlementFailure(settled.error, { ...baseCtx, srcTxHash: txResult.value.tx }),
            };
          }

          return settled;
        } catch (error) {
          if (isMoneyMarketOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('moneyMarket', error, { ...baseCtx, phase: 'intentCreation' }),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          srcAddress: _params.params.srcAddress,
          dstChainKey: _params.params.dstChainKey,
          dstAddress: _params.params.dstAddress,
          token: _params.params.token,
          amount: _params.params.amount,
        }),
        success: value => ({ srcChainTxHash: value.srcChainTxHash, dstChainTxHash: value.dstChainTxHash }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Executes (or returns raw) the spoke-side repay tx plus `relayData`, without waiting for hub settlement. */
  public async createRepayIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketRepayActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'deposit'>, MoneyMarketCreateIntentError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    const skipSimulation = _params.skipSimulation ?? false;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'repay' as const };

    try {
      mmInvariant(params.action === 'repay', 'Invalid action', { ...baseCtx, field: 'action' });
      mmInvariant(params.token.length > 0, 'Token is required', { ...baseCtx, field: 'token' });
      mmInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      mmInvariant(
        isUndefinedOrValidWalletProviderForChainKey(srcChainKey, walletProvider),
        `Invalid wallet provider for chain key: ${srcChainKey}, walletProvider.chainType: ${walletProvider?.chainType}`,
        { ...baseCtx, field: 'walletProvider' },
      );
      mmInvariant(
        this.config.isMoneyMarketSupportedToken(srcChainKey, params.token),
        `Unsupported spoke chain (${srcChainKey}) token: ${params.token}`,
        { ...baseCtx, field: 'token' },
      );

      const dstChainKey = params.dstChainKey ?? srcChainKey;
      const dstAddress = params.dstAddress ?? params.srcAddress;

      // Bitcoin TRADING mode deposits from the Bound Exchange trading wallet, so the hub wallet derives from it.
      const isBitcoinSrc = isBitcoinChainKeyType(srcChainKey);
      if (isBitcoinSrc && !_params.raw) {
        // A wrong provider would silently skip the Bound session and fail opaquely deep in spoke.deposit.
        mmInvariant(
          walletProvider !== undefined && isBitcoinWalletProviderType(walletProvider),
          `Invalid wallet provider for chain key: ${srcChainKey}. Expected bitcoin wallet provider.`,
          { ...baseCtx, field: 'walletProvider' },
        );
        await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(walletProvider);
      }
      const srcEffectiveAddress = isBitcoinSrc
        ? await this.spoke.bitcoin.getEffectiveWalletAddress(params.srcAddress)
        : params.srcAddress;
      const fromHubWallet = await this.hubProvider.getUserHubWalletAddress(srcEffectiveAddress, srcChainKey);

      const toHubWallet =
        dstChainKey === srcChainKey && dstAddress === params.srcAddress
          ? fromHubWallet
          : await this.hubProvider.getUserHubWalletAddress(
              isBitcoinChainKeyType(dstChainKey)
                ? await this.spoke.bitcoin.getEffectiveWalletAddress(dstAddress)
                : dstAddress,
              dstChainKey,
            );

      const data: Hex = this.buildRepayData(srcChainKey, params.token, params.amount, toHubWallet);

      const coreParams = {
        srcChainKey,
        srcAddress: srcEffectiveAddress as GetAddressType<K>,
        to: fromHubWallet,
        token: params.token as GetTokenAddressType<K>,
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
        if (isMoneyMarketCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('moneyMarket', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies DepositReturnType<K, Raw> as DepositReturnType<K, Raw>,
          relayData: { address: fromHubWallet, payload: data },
        },
      };
    } catch (error) {
      if (isMoneyMarketCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('moneyMarket', error, baseCtx),
      };
    }
  }

  /** Hub multicall for supply; `amount` is in spoke-token decimals and is translated to vault precision. */
  public buildSupplyData(srcChainKey: SpokeChainKey, fromToken: string, amount: bigint, toHubAddress: Address): Hex {
    const calls: EvmContractCall[] = [];

    const fromHubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(srcChainKey, fromToken);
    mmInvariant(fromHubAsset, `hub asset not found for source chain token (token): ${fromToken}`, {
      srcChainKey,
      field: 'token',
    });

    const lendingPool = this.config.moneyMarket.lendingPool;

    if (!this.config.isSodaVaultHubAsset(fromHubAsset.hubAsset)) {
      calls.push(Erc20Service.encodeApprove(fromHubAsset.hubAsset, fromHubAsset.vault, amount));
      calls.push(EvmVaultTokenService.encodeDeposit(fromHubAsset.vault, fromHubAsset.hubAsset, amount));
    }

    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(fromHubAsset.decimals, amount);
    calls.push(Erc20Service.encodeApprove(fromHubAsset.vault, lendingPool, translatedAmount));
    calls.push(
      MoneyMarketService.encodeSupply(
        { asset: fromHubAsset.vault, amount: translatedAmount, onBehalfOf: toHubAddress, referralCode: 0 },
        lendingPool,
      ),
    );

    return encodeContractCalls(calls);
  }

  /** What a borrow of `amount` pays out once the partner fee is taken, and the decimals it is paid in. */
  private borrowPayout(toHubAsset: XToken, dstToken: XToken, amount: bigint) {
    const translatedInAmount = EvmVaultTokenService.translateIncomingDecimals(toHubAsset.decimals, amount);
    const feeAmount = calculateFeeAmount(translatedInAmount, this.partnerFee);
    const amountOutDecimals = this.config.isSodaVaultHubAsset(toHubAsset.hubAsset)
      ? toHubAsset.decimals
      : dstToken.decimals;
    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
      amountOutDecimals,
      translatedInAmount - feeAmount,
    );
    return { translatedInAmount, feeAmount, amountOutDecimals, translatedAmountOut };
  }

  /** The pool reserve a borrow of `vault` draws on: bnUSD is borrowed from its debt reserve, then wrapped into the vault. */
  private getBorrowReserve(vault: Address): Address {
    const { bnUSD, bnUSDVault } = this.config.moneyMarket;
    return vault.toLowerCase() === bnUSDVault.toLowerCase() ? bnUSD : vault;
  }

  /** Hub multicall for borrow; `amount` is in the destination token's native decimals. */
  public buildBorrowData(
    fromHubAddress: Address,
    dstAddress: Address,
    toToken: string,
    amount: bigint,
    dstChainKey: SpokeChainKey,
  ): Hex {
    const toHubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(dstChainKey, toToken);
    const dstToken = this.config.getMoneyMarketToken(dstChainKey, toToken);
    mmInvariant(toHubAsset, `hub asset not found for target chain token (toToken): ${toToken}`, {
      dstChainKey,
      field: 'token',
    });
    mmInvariant(dstToken, `Money market token not found for spoke chain (${dstChainKey}) token: ${toToken}`, {
      dstChainKey,
      field: 'token',
    });

    const assetAddress = toHubAsset.hubAsset;
    const vaultAddress = toHubAsset.vault;
    const bnUSDVault = this.config.moneyMarket.bnUSDVault;
    const bnUSD = this.config.moneyMarket.bnUSD;
    const lendingPool = this.config.moneyMarket.lendingPool;

    const { translatedInAmount, feeAmount, amountOutDecimals, translatedAmountOut } = this.borrowPayout(
      toHubAsset,
      dstToken,
      amount,
    );
    const calls: EvmContractCall[] = [
      MoneyMarketService.encodeBorrow(
        {
          asset: this.getBorrowReserve(vaultAddress),
          amount: translatedInAmount,
          interestRateMode: 2n,
          referralCode: 0,
          onBehalfOf: fromHubAddress,
        },
        lendingPool,
      ),
    ];

    if (bnUSDVault.toLowerCase() === vaultAddress.toLowerCase()) {
      calls.push(Erc20Service.encodeApprove(bnUSD, bnUSDVault, translatedInAmount));
      calls.push(EvmVaultTokenService.encodeDeposit(bnUSDVault, bnUSD, translatedInAmount));

      if (this.partnerFee && feeAmount) {
        calls.push(Erc20Service.encodeTransfer(bnUSDVault, this.partnerFee.address, feeAmount));
      }
    } else if (this.partnerFee && feeAmount) {
      calls.push(Erc20Service.encodeTransfer(vaultAddress, this.partnerFee.address, feeAmount));
    }

    if (!this.config.isSodaVaultHubAsset(assetAddress)) {
      calls.push(EvmVaultTokenService.encodeWithdraw(vaultAddress, assetAddress, translatedInAmount - feeAmount));
    }

    // Checked on what is paid out, after the partner fee.
    assertMpcPayoutAboveMinimum({
      feature: 'moneyMarket',
      dstChainKey: dstChainKey,
      token: dstToken,
      amount: translatedAmountOut,
      amountDecimals: amountOutDecimals,
      context: { dstChainKey, action: 'borrow', field: 'amount' },
    });

    if (dstChainKey === this.hubProvider.chainConfig.chain.key) {
      if (
        assetAddress.toLowerCase() === this.config.spokeChainConfig[dstChainKey].addresses.wrappedSonic.toLowerCase()
      ) {
        const withdrawToCall = {
          address: assetAddress,
          value: 0n,
          data: encodeFunctionData({
            abi: wrappedSonicAbi,
            functionName: 'withdrawTo',
            args: [dstAddress, translatedAmountOut],
          }),
        };

        calls.push(withdrawToCall);
      } else {
        calls.push(Erc20Service.encodeTransfer(assetAddress, dstAddress, translatedAmountOut));
      }
    } else {
      calls.push(
        EvmAssetManagerService.encodeTransfer(
          assetAddress,
          dstAddress,
          translatedAmountOut,
          this.hubProvider.chainConfig.addresses.assetManager,
        ),
      );
    }

    return encodeContractCalls(calls);
  }

  /** Hub multicall for withdraw; `amount` is in the destination token's native decimals. */
  public buildWithdrawData(
    fromHubAddress: Address,
    dstAddress: Address,
    toToken: string,
    amount: bigint,
    dstChainKey: SpokeChainKey,
  ): Hex {
    const calls: EvmContractCall[] = [];

    const toHubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(dstChainKey, toToken);
    const dstToken = this.config.getMoneyMarketToken(dstChainKey, toToken);
    mmInvariant(toHubAsset, `hub asset not found for target chain token (toToken): ${toToken}`, {
      dstChainKey,
      field: 'token',
    });
    mmInvariant(dstToken, `Money market token not found for spoke chain (${dstChainKey}) token: ${toToken}`, {
      dstChainKey,
      field: 'token',
    });

    const assetAddress = toHubAsset.hubAsset;
    const vaultAddress = toHubAsset.vault;
    const lendingPool = this.config.moneyMarket.lendingPool;

    const translatedInAmount = EvmVaultTokenService.translateIncomingDecimals(toHubAsset.decimals, amount);

    calls.push(
      MoneyMarketService.encodeWithdraw(
        { asset: vaultAddress, amount: translatedInAmount, to: fromHubAddress },
        lendingPool,
      ),
    );

    if (!this.config.isSodaVaultHubAsset(assetAddress)) {
      calls.push(EvmVaultTokenService.encodeWithdraw(vaultAddress, assetAddress, translatedInAmount));
    }

    const amountOutDecimals = this.config.isSodaVaultHubAsset(assetAddress) ? toHubAsset.decimals : dstToken.decimals;
    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(amountOutDecimals, translatedInAmount);
    assertMpcPayoutAboveMinimum({
      feature: 'moneyMarket',
      dstChainKey: dstChainKey,
      token: dstToken,
      amount: translatedAmountOut,
      amountDecimals: amountOutDecimals,
      context: { dstChainKey, action: 'withdraw', field: 'amount' },
    });

    if (dstChainKey === this.hubProvider.chainConfig.chain.key) {
      if (
        assetAddress.toLowerCase() === this.config.spokeChainConfig[dstChainKey].addresses.wrappedSonic.toLowerCase()
      ) {
        const withdrawToCall = {
          address: assetAddress,
          value: 0n,
          data: encodeFunctionData({
            abi: wrappedSonicAbi,
            functionName: 'withdrawTo',
            args: [dstAddress, translatedAmountOut],
          }),
        };
        calls.push(withdrawToCall);
      } else {
        calls.push(Erc20Service.encodeTransfer(assetAddress, dstAddress, translatedAmountOut));
      }
    } else {
      calls.push(
        EvmAssetManagerService.encodeTransfer(
          assetAddress,
          dstAddress,
          translatedAmountOut,
          this.hubProvider.chainConfig.addresses.assetManager,
        ),
      );
    }

    return encodeContractCalls(calls);
  }

  /**
   * Hub multicall for repay. Vault deposit/approve take the raw spoke-native `amount`; pool approve/repay
   * and vault withdraw take the 18-decimal `translatedAmountIn`, since the pool only works in vault units.
   */
  public buildRepayData(srcChainKey: SpokeChainKey, fromToken: string, amount: bigint, toHubAddress: Address): Hex {
    const calls: EvmContractCall[] = [];

    const fromHubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(srcChainKey, fromToken);
    mmInvariant(fromHubAsset, `hub asset not found for source chain token (fromToken): ${fromToken}`, {
      srcChainKey,
      field: 'token',
    });

    const assetAddress = fromHubAsset.hubAsset;
    const vaultAddress = fromHubAsset.vault;
    const bnUSDVault = this.config.moneyMarket.bnUSDVault;
    const bnUSD = this.config.moneyMarket.bnUSD;
    const lendingPool = this.config.moneyMarket.lendingPool;

    const translatedAmountIn = EvmVaultTokenService.translateIncomingDecimals(fromHubAsset.decimals, amount);

    let repayToken = vaultAddress;
    if (bnUSDVault.toLowerCase() === vaultAddress.toLowerCase()) {
      // Repaying the bnUSD vault repays the bnUSD debt token.
      repayToken = bnUSD;

      if (assetAddress.toLowerCase() !== bnUSDVault.toLowerCase()) {
        calls.push(Erc20Service.encodeApprove(assetAddress, vaultAddress, amount));
        calls.push(EvmVaultTokenService.encodeDeposit(vaultAddress, assetAddress, amount));
      }

      calls.push(EvmVaultTokenService.encodeWithdraw(bnUSDVault, bnUSD, translatedAmountIn));
    } else {
      if (!this.config.isSodaVaultHubAsset(fromHubAsset.hubAsset)) {
        calls.push(Erc20Service.encodeApprove(assetAddress, vaultAddress, amount));
        calls.push(EvmVaultTokenService.encodeDeposit(vaultAddress, assetAddress, amount));
      }
    }

    calls.push(Erc20Service.encodeApprove(repayToken, lendingPool, translatedAmountIn));
    calls.push(
      MoneyMarketService.encodeRepay(
        { asset: repayToken, amount: translatedAmountIn, interestRateMode: 2n, onBehalfOf: toHubAddress },
        lendingPool,
      ),
    );
    return encodeContractCalls(calls);
  }

  /** Scaled aToken amount for `amount` at the RAY (1e27) `normalizedIncome`, +1 so withdraw never reverts on dust. */
  static calculateATokenAmount(amount: bigint, normalizedIncome: bigint): bigint {
    return (amount * 10n ** 27n) / normalizedIncome + 1n;
  }

  public static encodeSupply(params: MoneyMarketEncodeSupplyParams, lendingPool: Address): EvmContractCall {
    return {
      address: lendingPool,
      value: 0n,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: 'supply',
        args: [params.asset, params.amount, params.onBehalfOf, params.referralCode],
      }),
    };
  }

  public static encodeWithdraw(params: MoneyMarketEncodeWithdrawParams, lendingPool: Address): EvmContractCall {
    return {
      address: lendingPool,
      value: 0n,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: 'withdraw',
        args: [params.asset, params.amount, params.to],
      }),
    };
  }

  public static encodeBorrow(params: MoneyMarketEncodeBorrowParams, lendingPool: Address): EvmContractCall {
    return {
      address: lendingPool,
      value: 0n,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: 'borrow',
        args: [params.asset, params.amount, params.interestRateMode, params.referralCode, params.onBehalfOf],
      }),
    };
  }

  public static encodeRepay(params: MoneyMarketEncodeRepayParams, lendingPool: Address): EvmContractCall {
    return {
      address: lendingPool,
      value: 0n,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: 'repay',
        args: [params.asset, params.amount, params.interestRateMode, params.onBehalfOf],
      }),
    };
  }

  /** Repays debt by burning the caller's aTokens instead of transferring the underlying. */
  public static encodeRepayWithATokens(
    params: MoneyMarketEncodeRepayWithATokensParams,
    lendingPool: Address,
  ): EvmContractCall {
    return {
      address: lendingPool,
      value: 0n,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: 'repayWithATokens',
        args: [params.asset, params.amount, params.interestRateMode],
      }),
    };
  }

  public static encodeSetUserUseReserveAsCollateral(
    asset: Address,
    useAsCollateral: boolean,
    lendingPool: Address,
  ): EvmContractCall {
    return {
      address: lendingPool,
      value: 0n,
      data: encodeFunctionData({
        abi: poolAbi,
        functionName: 'setUserUseReserveAsCollateral',
        args: [asset, useAsCollateral],
      }),
    };
  }

  public getSupportedTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.config.getSupportedMoneyMarketTokensByChainId(chainId);
  }

  public getSupportedTokens(): GetMoneyMarketTokensApiResponse {
    return this.config.getSupportedMoneyMarketTokens();
  }

  /** Hub reserve assets (vault tokens) registered in the lending pool. */
  public getSupportedReserves(): readonly Address[] {
    return this.config.getMoneyMarketReserveAssets();
  }
}
