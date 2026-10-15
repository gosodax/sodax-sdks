import { encodeFunctionData, isAddress } from 'viem';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
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
  relayTxAndWaitPacket,
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
import type { HubProvider, IntentTxResult, TxHashPair } from '../shared/types/types.js';
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
  DEFAULT_RELAY_TX_TIMEOUT,
  HUB_CHAIN_KEY,
  type SpokeExecActionParams,
} from '@sodax/types';
import { MoneyMarketDataService } from './MoneyMarketDataService.js';

export type MoneyMarketEncodeSupplyParams = {
  asset: Address; // The address of the asset to supply.
  amount: bigint; // The amount of the asset to supply.
  onBehalfOf: Address; // The address on whose behalf the asset is supplied.
  referralCode: number; // The referral code for the transaction.
};

export type MoneyMarketEncodeWithdrawParams = {
  asset: Address; // The address of the asset to withdraw.
  amount: bigint; // The amount of the asset to withdraw.
  to: Address; // The address that will receive the withdrawn assets.
};

export type MoneyMarketEncodeBorrowParams = {
  asset: Address; // The address of the asset to borrow.
  amount: bigint; // The amount of the asset to borrow.
  interestRateMode: bigint; // The interest rate mode (2 for Variable).
  referralCode: number; // The referral code for the borrow transaction.
  onBehalfOf: Address; // The address that will receive the borrowed assets.
};

export type MoneyMarketEncodeRepayParams = {
  asset: Address; // The address of the asset to repay.
  amount: bigint; // The amount of the asset to repay.
  interestRateMode: bigint; // The interest rate mode (2 for Variable).
  onBehalfOf: Address; // The address that will get their debt reduced/removed.
};

export type MoneyMarketEncodeRepayWithATokensParams = {
  asset: Address; // The address of the asset to repay.
  amount: bigint; // The amount of the asset to repay.
  interestRateMode: bigint; // The interest rate mode (2 for Variable).
};

/**
 * Parameters for a Money Market supply operation.
 *
 * `srcChainKey: K` drives chain-narrowing of the associated walletProvider.
 * `srcAddress` is the originating wallet on the source spoke chain.
 */
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

// Exec-mode wrappers (walletProvider required, K-narrowed)
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

// `isAllowanceValid` accepts any action (reads allowance/trustline state only).
export type MoneyMarketAllowanceParams<K extends SpokeChainKey> = {
  params: MoneyMarketParams<K>;
};

// `approve` accepts any action (but only supply/repay actually require approval on EVM).
export type MoneyMarketApproveActionParams<
  K extends SpokeChainKey,
  Raw extends boolean = false,
> = SpokeExecActionParams<K, Raw, MoneyMarketParams<K>>;

export type MoneyMarketServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
  hubProvider: HubProvider;
};

/**
 * Entry point for all SODAX money market operations: supply, borrow, withdraw, and repay.
 *
 * Operations are cross-chain: a user initiates on any supported spoke chain and the action
 * is relayed to the hub (Sonic) where the Aave-style lending pool lives. Hub-chain callers
 * skip the relay step entirely.
 *
 * The service mirrors the {@link SwapService} interface shape: public methods accept
 * `srcChainKey + srcAddress + walletProvider` instead of a pre-built `SpokeProvider`.
 * Pass `{ raw: true }` on any `create*Intent` or `approve` call to obtain unsigned
 * transaction data for external signing and broadcasting without touching the wallet.
 *
 * A `data` sub-service ({@link MoneyMarketDataService}) is available for read-only pool
 * and position queries.
 *
 * @namespace SodaxFeatures
 */
export class MoneyMarketService {
  // dependent services
  readonly hubProvider: HubProvider;
  readonly config: ConfigService;
  readonly spoke: SpokeService;

  // money market config (hoisted from config for ergonomics, mirrors SwapService)
  readonly relayerApiEndpoint: HttpUrl;

  // sub-service
  readonly data: MoneyMarketDataService;

  /**
   * Effective money-market partner fee (`moneyMarket.partnerFee`, else the global `fee`). Read live
   * off `ConfigService` rather than snapshotted in the constructor, so it cannot diverge from
   * `config.moneyMarketPartnerFee` if the config object is ever replaced. Mirrors
   * {@link SwapService.partnerFee}.
   *
   * Money market has no per-action override: unlike swap / bridge / leverage-yield, every flow here
   * charges this configured fee.
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

  /**
   * Estimate the gas cost of an already-encoded transaction on the given spoke chain.
   *
   * Delegates to {@link SpokeService.estimateGas} and returns the chain-specific gas estimate.
   *
   * @param params - Chain key, from/to addresses, and encoded calldata to simulate.
   * @returns The chain-specific gas estimate on success, or a wrapped error on failure.
   */
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
   * Check whether the current token allowance (or Stellar trustline) is sufficient to
   * execute the given money market action without a prior approval transaction.
   *
   * Rules per chain / action:
   * - Supply / repay on hub: checks ERC-20 allowance against the user's hub router.
   * - Supply / repay on EVM spoke: checks ERC-20 allowance against the spoke asset manager.
   * - Stellar source or destination: checks trustline sufficiency on both the sender and
   *   the recipient wallets.
   * - Withdraw / borrow: no on-chain approval required — always returns `true`.
   *
   * @param _params - The money market action params used solely for the allowance check (no wallet needed).
   * @returns `true` if the allowance is sufficient; `false` if an approval transaction is required first.
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

      // Compute the underlying Result<boolean> across the various chain-type paths, then wrap
      // any spoke-layer failure as MM_ALLOWANCE_CHECK_FAILED at the single return point below.
      let inner: Result<boolean> = { ok: true, value: true };

      // Target chain is Stellar with a specific recipient: both recipient and (if src is Stellar) sender
      // must have sufficient trustline for the token.
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
        // Allowance on EVM (hub or spoke) is required only for supply / repay.
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
   * Approve token spending for a supply or repay action, or establish a Stellar trustline.
   *
   * - EVM hub: approves the user's hub router as spender.
   * - EVM spoke: approves the spoke asset manager as spender.
   * - Stellar: creates/updates the required trustline.
   *
   * Borrow and withdraw do not require prior approval; calling this method with either of
   * those actions returns an error.
   *
   * Pass `{ raw: true }` to receive unsigned transaction data instead of broadcasting.
   *
   * @param _params - Action params including `srcChainKey`, `token`, `amount`, optional `walletProvider`, and `raw` flag.
   * @returns The broadcast transaction result on success (`raw: false`), or unsigned transaction
   *   data (`raw: true`), keyed to the source chain type.
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

      // Reached only for chains that don't support approval (Solana, NEAR, etc.). Surface as
      // a validation failure rather than a generic Error so consumers can discriminate.
      mmInvariant(false, 'Approve only supported for hub (Sonic), EVM spokes, and Stellar', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isMoneyMarketApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  // ==== supply ==========================================================================

  /**
   * Supply tokens to the money market lending pool and wait for the cross-chain relay to complete.
   *
   * Executes the spoke-side deposit, then relays the message to the hub where the Aave pool
   * records the supply position. Hub-chain callers skip the relay step.
   *
   * @param _params - Supply action params: `srcChainKey`, `srcAddress`, `token`, `amount`,
   *   `walletProvider`, and optional `dstChainKey`/`dstAddress` for cross-chain delivery.
   * @returns A pair of transaction hashes — `srcChainTxHash` (spoke) and `dstChainTxHash` (hub).
   */
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
          // CreateSupplyIntentErrorCode ⊂ SupplyErrorCode, so the SodaxError narrows correctly.
          if (!txResult.ok) return { ok: false, error: txResult.error };

          // Settlement is skipped only when the source chain is the hub.
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
          if (!settled.ok) return { ok: false, error: this.mapSettlementFailure(settled.error, baseCtx) };

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

  /**
   * Build and optionally broadcast the spoke-side supply transaction without waiting for the
   * cross-chain relay to settle on the hub.
   *
   * Use this when you need manual relay control or want to sign and broadcast the transaction
   * yourself. Pass `{ raw: true }` to receive unsigned calldata instead of executing.
   *
   * @param _params - Supply action params plus `raw` flag and optional `skipSimulation`.
   * @returns The spoke transaction result (hash or raw calldata) plus `relayData` required to
   *   trigger the hub-side execution via {@link relayTxAndWaitPacket}.
   */
  public async createSupplyIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketSupplyActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, MoneyMarketCreateIntentError>> {
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

      // Bitcoin (TRADING mode) pulls the deposit from the Bound Exchange trading wallet, so the
      // effective source address — and the hub wallet derived from it, where collateral lives — is the
      // trading wallet, not the personal one. getEffectiveWalletAddress + ensureRadfiAccessToken are the
      // Bitcoin spoke/Bound primitives (mirrors SwapService/BridgeService); non-Bitcoin chains pass through.
      const isBitcoinSrc = isBitcoinChainKeyType(srcChainKey);
      if (isBitcoinSrc && !_params.raw) {
        // Fail fast (mirrors SwapService/BridgeService): a non-raw Bitcoin deposit must sign via a
        // Bitcoin wallet provider. A missing/wrong provider here would otherwise silently skip the
        // Bound Exchange session and only surface as an opaque undefined error deep in spoke.deposit.
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

      // Same-chain self-deposit (the common case) reuses the source resolution; a distinct destination
      // resolves its own effective (Bitcoin trading) address before hub-wallet derivation.
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
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
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

  // ==== borrow ==========================================================================

  /**
   * Map a {@link SpokeService.settle} failure onto the money-market errors: a source tx that never
   * landed is a verification failure, anything later a relay failure.
   */
  private mapSettlementFailure(
    failure: SettlementFailure,
    ctx: { action: string; srcChainKey: SpokeChainKey; dstChainKey?: SpokeChainKey },
  ): MoneyMarketOrchestrationError {
    return failure.phase === 'verification'
      ? verifyFailed('moneyMarket', failure.cause, ctx)
      : mapRelayFailure(failure.cause, { feature: 'moneyMarket', ...ctx });
  }

  /**
   * Borrow tokens from the money market lending pool and wait for the cross-chain relay to
   * deliver the funds to the destination address.
   *
   * The relay step is skipped when both the source and destination are the hub chain.
   * Borrowed tokens can be sent to a different spoke chain by supplying `dstChainKey`
   * and `dstAddress`.
   *
   * @param _params - Borrow action params: `srcChainKey`, `srcAddress`, `token`, `amount`,
   *   `walletProvider`, and optional `dstChainKey`/`dstAddress`.
   * @returns A pair of transaction hashes — `srcChainTxHash` (spoke/hub trigger) and
   *   `dstChainTxHash` (hub delivery or relay destination).
   */
  public async borrow<K extends SpokeChainKey>(
    _params: MoneyMarketBorrowActionParams<K, false>,
  ): Promise<Result<TxHashPair, MoneyMarketOrchestrationError>> {
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

          // Settlement is not required when the borrow is executed on hub AND the target is also hub.
          // (Borrow from hub to a different target chain still needs the relay to deliver tokens.)
          const needsSettlement =
            srcChainKey !== hubChainId ||
            (params.dstChainKey != null && params.dstAddress != null && params.dstChainKey !== hubChainId);

          if (!needsSettlement) {
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
            direction: 'outbound',
            relayData: txResult.value.relayData,
            timeout,
          });
          if (!settled.ok) return { ok: false, error: this.mapSettlementFailure(settled.error, baseCtx) };

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

  /**
   * Build and optionally broadcast the spoke-side borrow message without waiting for the
   * cross-chain relay to deliver funds.
   *
   * Use this when you need manual relay control or want to sign and broadcast the transaction
   * yourself. Pass `{ raw: true }` to receive unsigned calldata instead of executing.
   *
   * @param _params - Borrow action params plus `raw` flag and optional `skipSimulation`.
   * @returns The spoke transaction result (hash or raw calldata) plus `relayData` required to
   *   trigger the hub-side borrow execution via {@link relayTxAndWaitPacket}.
   */
  public async createBorrowIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketBorrowActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, MoneyMarketCreateIntentError>> {
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
      // Only the hub wallet needs the effective (Bitcoin trading) address — that's where the
      // collateral/debt lives. srcAddress stays the personal address because `SpokeService.sendMessage`
      // resolves the effective address itself (unlike the deposit path used by supply/repay, which
      // does not). Passing the already-resolved trading address here would double-resolve it
      // (getTradingWallet(tradingAddress) → "Trading wallet not found").
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
          error: intentCreationFailed('moneyMarket', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
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

  // ==== withdraw ========================================================================

  /**
   * Withdraw previously supplied tokens from the money market lending pool and wait for the
   * cross-chain relay to deliver the funds to the destination address.
   *
   * The relay step is skipped when the source is the hub chain and the destination is either
   * unspecified, the hub chain itself, or the hub wallet router address. A cross-chain
   * destination (different chain, non-walletRouter address) always triggers the relay.
   *
   * @param _params - Withdraw action params: `srcChainKey`, `srcAddress`, `token`, `amount`,
   *   `walletProvider`, and optional `dstChainKey`/`dstAddress`.
   * @returns A pair of transaction hashes — `srcChainTxHash` (initiating chain) and
   *   `dstChainTxHash` (hub or relay destination).
   */
  public async withdraw<K extends SpokeChainKey>(
    _params: MoneyMarketWithdrawActionParams<K, false>,
  ): Promise<Result<TxHashPair, MoneyMarketOrchestrationError>> {
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

          // Settlement is not required only when: source is hub AND target is hub AND target is not the walletRouter.
          const needsSettlement =
            srcChainKey !== hubChainId ||
            (params.dstChainKey != null &&
              params.dstAddress != null &&
              params.dstChainKey !== hubChainId &&
              params.dstAddress !== walletRouter);

          if (!needsSettlement) {
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
            direction: 'outbound',
            relayData: txResult.value.relayData,
            timeout,
          });
          if (!settled.ok) return { ok: false, error: this.mapSettlementFailure(settled.error, baseCtx) };

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

  /**
   * Build and optionally broadcast the spoke-side withdraw message without waiting for the
   * cross-chain relay to deliver funds.
   *
   * Use this when you need manual relay control or want to sign and broadcast the transaction
   * yourself. Pass `{ raw: true }` to receive unsigned calldata instead of executing.
   *
   * @param _params - Withdraw action params plus `raw` flag and optional `skipSimulation`.
   * @returns The spoke transaction result (hash or raw calldata) plus `relayData` required to
   *   trigger the hub-side withdrawal via {@link relayTxAndWaitPacket}.
   */
  public async createWithdrawIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketWithdrawActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, MoneyMarketCreateIntentError>> {
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

      const encodedDstAddress = encodeRecipient(dstChainKey, dstAddress);
      // Only the hub wallet needs the effective (Bitcoin trading) address — that's where the
      // collateral/debt lives. srcAddress stays the personal address because `SpokeService.sendMessage`
      // resolves the effective address itself (unlike the deposit path used by supply/repay, which
      // does not). Passing the already-resolved trading address here would double-resolve it
      // (getTradingWallet(tradingAddress) → "Trading wallet not found").
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
          error: intentCreationFailed('moneyMarket', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
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

  // ==== repay ===========================================================================

  /**
   * Repay a borrowed position in the money market lending pool and wait for the cross-chain
   * relay to settle on the hub.
   *
   * Hub-chain callers skip the relay step. The repayment is credited to `dstAddress` on
   * `dstChainKey` (defaulting to the source address and chain when omitted).
   *
   * @param _params - Repay action params: `srcChainKey`, `srcAddress`, `token`, `amount`,
   *   `walletProvider`, and optional `dstChainKey`/`dstAddress`.
   * @returns A pair of transaction hashes — `srcChainTxHash` (spoke) and `dstChainTxHash` (hub).
   */
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

          // Settlement is skipped only when the source chain is the hub.
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
          if (!settled.ok) return { ok: false, error: this.mapSettlementFailure(settled.error, baseCtx) };

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

  /**
   * Build and optionally broadcast the spoke-side repay transaction without waiting for the
   * cross-chain relay to settle on the hub.
   *
   * Use this when you need manual relay control or want to sign and broadcast the transaction
   * yourself. Pass `{ raw: true }` to receive unsigned calldata instead of executing.
   *
   * @param _params - Repay action params plus `raw` flag and optional `skipSimulation`.
   * @returns The spoke transaction result (hash or raw calldata) plus `relayData` required to
   *   trigger the hub-side repayment via {@link relayTxAndWaitPacket}.
   */
  public async createRepayIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: MoneyMarketRepayActionParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, MoneyMarketCreateIntentError>> {
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

      // Bitcoin (TRADING mode) pulls the deposit from the Bound Exchange trading wallet, so the
      // effective source address — and the hub wallet derived from it, where collateral lives — is the
      // trading wallet, not the personal one. getEffectiveWalletAddress + ensureRadfiAccessToken are the
      // Bitcoin spoke/Bound primitives (mirrors SwapService/BridgeService); non-Bitcoin chains pass through.
      const isBitcoinSrc = isBitcoinChainKeyType(srcChainKey);
      if (isBitcoinSrc && !_params.raw) {
        // Fail fast (mirrors SwapService/BridgeService): a non-raw Bitcoin deposit must sign via a
        // Bitcoin wallet provider. A missing/wrong provider here would otherwise silently skip the
        // Bound Exchange session and only surface as an opaque undefined error deep in spoke.deposit.
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

      // Same-chain self-deposit (the common case) reuses the source resolution; a distinct destination
      // resolves its own effective (Bitcoin trading) address before hub-wallet derivation.
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
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
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

  // ==== build helpers (hub-side call encoding) ==========================================

  /**
   * Encode the hub-side calldata for a supply operation.
   *
   * For non-vault tokens the encoded sequence is: ERC-20 approve → vault deposit → vault
   * approve → pool `supply`. Amounts are decimal-translated to hub (vault) precision before
   * encoding so the pool always receives vault-denominated values.
   *
   * @param srcChainKey - The source spoke chain that the tokens originate from.
   * @param fromToken - The token address on `srcChainKey` being supplied.
   * @param amount - The amount in the spoke token's native decimals.
   * @param toHubAddress - The hub wallet address that will receive the aTokens.
   * @returns ABI-encoded multicall data ready to be sent to the hub wallet router.
   */
  public buildSupplyData(srcChainKey: SpokeChainKey, fromToken: string, amount: bigint, toHubAddress: Address): Hex {
    const calls: EvmContractCall[] = [];

    const fromHubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(srcChainKey, fromToken);
    mmInvariant(fromHubAsset, `hub asset not found for source chain token (token): ${fromToken}`, {
      srcChainKey,
      field: 'token',
    });

    const lendingPool = this.config.moneyMarket.lendingPool;

    if (!this.config.isSodaVaultHubAsset(fromHubAsset.hubAsset)) {
      // deposit non-vault token into the vault
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

  /**
   * Encode the hub-side calldata for a borrow operation.
   *
   * The encoded sequence handles two cases:
   * - bnUSD vault: borrow bnUSD debt token → deposit into vault → optional partner fee transfer.
   * - Other vault: borrow vault token directly → optional partner fee transfer → vault withdraw
   *   (if the destination token is not the vault token itself).
   *
   * Funds are then routed to the destination: native S (wrapped Sonic unwrap) on the hub, plain
   * ERC-20 transfer on the hub for non-native, or an asset manager cross-chain transfer for
   * spoke destinations.
   *
   * @param fromHubAddress - The hub wallet address that owns the collateral and will take on the debt.
   * @param dstAddress - The ABI-encoded destination address on the target chain.
   * @param toToken - The token address on `dstChainKey` that the borrower wants to receive.
   * @param amount - The borrow amount in the destination token's native decimals.
   * @param dstChainKey - The chain where borrowed tokens should be delivered.
   * @returns ABI-encoded multicall data ready to be sent to the hub wallet router.
   */
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

    const translatedInAmount = EvmVaultTokenService.translateIncomingDecimals(toHubAsset.decimals, amount);
    const feeAmount = calculateFeeAmount(translatedInAmount, this.partnerFee);
    const calls: EvmContractCall[] = [];

    if (bnUSDVault.toLowerCase() === vaultAddress.toLowerCase()) {
      calls.push(
        MoneyMarketService.encodeBorrow(
          {
            asset: bnUSD,
            amount: translatedInAmount,
            interestRateMode: 2n,
            referralCode: 0,
            onBehalfOf: fromHubAddress,
          },
          lendingPool,
        ),
      );
      calls.push(Erc20Service.encodeApprove(bnUSD, bnUSDVault, translatedInAmount));
      calls.push(EvmVaultTokenService.encodeDeposit(bnUSDVault, bnUSD, translatedInAmount));

      if (this.partnerFee && feeAmount) {
        calls.push(Erc20Service.encodeTransfer(bnUSDVault, this.partnerFee.address, feeAmount));
      }
    } else {
      calls.push(
        MoneyMarketService.encodeBorrow(
          {
            asset: vaultAddress,
            amount: translatedInAmount,
            interestRateMode: 2n,
            referralCode: 0,
            onBehalfOf: fromHubAddress,
          },
          lendingPool,
        ),
      );

      if (this.partnerFee && feeAmount) {
        calls.push(Erc20Service.encodeTransfer(vaultAddress, this.partnerFee.address, feeAmount));
      }
    }

    if (!this.config.isSodaVaultHubAsset(assetAddress)) {
      // if the target token is not the vault token, we need to withdraw the tokens from the vault
      calls.push(EvmVaultTokenService.encodeWithdraw(vaultAddress, assetAddress, translatedInAmount - feeAmount));
    }

    let translatedAmountOut: bigint;
    if (this.config.isSodaVaultHubAsset(assetAddress)) {
      translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
        toHubAsset.decimals,
        translatedInAmount - feeAmount,
      );
    } else {
      translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
        dstToken.decimals,
        translatedInAmount - feeAmount,
      );
    }

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
   * Encode the hub-side calldata for a withdraw operation.
   *
   * Calls pool `withdraw` (which burns aTokens and returns vault tokens), then optionally
   * redeems underlying from the vault when the destination token is not the vault token itself.
   * Funds are then forwarded to the destination: native S unwrap on the hub, ERC-20 transfer
   * on the hub for non-native, or an asset manager cross-chain transfer for spoke destinations.
   *
   * @param fromHubAddress - The hub wallet address that holds the aTokens to burn.
   * @param dstAddress - The ABI-encoded destination address on the target chain.
   * @param toToken - The token address on `dstChainKey` that the caller wants to receive.
   * @param amount - The withdrawal amount in the destination token's native decimals.
   * @param dstChainKey - The chain where withdrawn tokens should be delivered.
   * @returns ABI-encoded multicall data ready to be sent to the hub wallet router.
   */
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
      // if the target token is not the vault token, we need to withdraw the tokens from the vault
      calls.push(EvmVaultTokenService.encodeWithdraw(vaultAddress, assetAddress, translatedInAmount));
    }

    let translatedAmountOut: bigint;
    if (this.config.isSodaVaultHubAsset(assetAddress)) {
      translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(toHubAsset.decimals, translatedInAmount);
    } else {
      translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(dstToken.decimals, translatedInAmount);
    }

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
   * Encode the hub-side calldata for a repay operation.
   *
   * Two paths based on the vault type:
   * - bnUSD vault: if the incoming asset is not already the vault, approve and deposit into it
   *   (using the raw spoke-native `amount`); then withdraw the bnUSD debt token from the vault
   *   and call pool `repay` with the bnUSD token.
   * - Other vault: if the incoming asset is not already a vault token, approve and deposit first
   *   (using the raw spoke-native `amount`); then call pool `repay` directly with the vault token.
   *
   * Decimal handling — two scales are intentionally used in the same call sequence:
   * - Vault `deposit` / ERC-20 `approve` for the vault receive the raw spoke-native `amount`
   *   because the vault contract expects amounts in the underlying token's native decimals.
   * - Vault `withdraw`, ERC-20 `approve` for the lending pool, and pool `repay` receive
   *   `translatedAmountIn` (decimal-scaled to 18-decimal hub/vault precision via
   *   {@link EvmVaultTokenService.translateIncomingDecimals}) because the Aave pool operates
   *   exclusively in vault-token (18-decimal) units.
   *
   * @param srcChainKey - The source spoke chain that the repayment tokens originate from.
   * @param fromToken - The token address on `srcChainKey` being used to repay.
   * @param amount - The repay amount in the source token's native decimals.
   * @param toHubAddress - The hub wallet address whose debt position will be reduced.
   * @returns ABI-encoded multicall data ready to be sent to the hub wallet router.
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
      // when repaying bnUSD using vault token, bnUSD debt token gets repaid
      repayToken = bnUSD;

      if (assetAddress.toLowerCase() !== bnUSDVault.toLowerCase()) {
        // if asset address is not bnUSD vault, we need to approve and deposit the asset into the vault
        calls.push(Erc20Service.encodeApprove(assetAddress, vaultAddress, amount));
        calls.push(EvmVaultTokenService.encodeDeposit(vaultAddress, assetAddress, amount));
      }

      // withdraw the bnUSD debt token from the vault
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

  // ==== static encoders (unchanged) =====================================================

  /**
   * Convert a token amount to its scaled aToken equivalent using the reserve's current
   * liquidity index (RAY precision, 27 decimals).
   *
   * The result is rounded up by 1 to avoid rounding-down dust that would make the
   * `withdraw` call revert due to insufficient aToken balance.
   *
   * @param amount - Token amount in the reserve's native decimals.
   * @param normalizedIncome - The reserve's current `liquidityIndex` in RAY (1e27) precision.
   * @returns The scaled aToken amount required to represent `amount` of the underlying.
   */
  static calculateATokenAmount(amount: bigint, normalizedIncome: bigint): bigint {
    return (amount * 10n ** 27n) / normalizedIncome + 1n;
  }

  /**
   * Encode a pool `supply` call as a raw {@link EvmContractCall} for use inside a multicall batch.
   *
   * @param params - Asset address, amount, beneficiary, and referral code.
   * @param lendingPool - Address of the Aave-style lending pool contract.
   * @returns An `EvmContractCall` with the ABI-encoded `supply` calldata.
   */
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

  /**
   * Encode a pool `withdraw` call as a raw {@link EvmContractCall} for use inside a multicall batch.
   *
   * @param params - Asset address, amount to withdraw, and recipient address.
   * @param lendingPool - Address of the Aave-style lending pool contract.
   * @returns An `EvmContractCall` with the ABI-encoded `withdraw` calldata.
   */
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

  /**
   * Encode a pool `borrow` call as a raw {@link EvmContractCall} for use inside a multicall batch.
   *
   * @param params - Asset address, borrow amount, interest rate mode (2 = variable), referral code,
   *   and the address that will carry the debt.
   * @param lendingPool - Address of the Aave-style lending pool contract.
   * @returns An `EvmContractCall` with the ABI-encoded `borrow` calldata.
   */
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

  /**
   * Encode a pool `repay` call as a raw {@link EvmContractCall} for use inside a multicall batch.
   *
   * @param params - Asset address, repay amount, interest rate mode (2 = variable), and the
   *   address whose debt will be reduced.
   * @param lendingPool - Address of the Aave-style lending pool contract.
   * @returns An `EvmContractCall` with the ABI-encoded `repay` calldata.
   */
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

  /**
   * Encode a pool `repayWithATokens` call as a raw {@link EvmContractCall} for use inside a
   * multicall batch.
   *
   * Repays debt by burning the caller's aTokens directly instead of transferring the underlying
   * asset. Useful when the caller holds aTokens and wants to close a position atomically.
   *
   * @param params - Asset address, repay amount, and interest rate mode (2 = variable).
   * @param lendingPool - Address of the Aave-style lending pool contract.
   * @returns An `EvmContractCall` with the ABI-encoded `repayWithATokens` calldata.
   */
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

  /**
   * Encode a pool `setUserUseReserveAsCollateral` call as a raw {@link EvmContractCall} for use
   * inside a multicall batch.
   *
   * Toggles whether a supplied asset is used as collateral for the caller's borrowing capacity.
   * Disabling collateral reduces the caller's available borrow power.
   *
   * @param asset - Address of the reserve asset whose collateral flag will be updated.
   * @param useAsCollateral - `true` to enable as collateral; `false` to disable.
   * @param lendingPool - Address of the Aave-style lending pool contract.
   * @returns An `EvmContractCall` with the ABI-encoded `setUserUseReserveAsCollateral` calldata.
   */
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

  // ==== info getters =====================================================================

  /**
   * Return the list of money market tokens supported on the given spoke chain.
   *
   * @param chainId - The spoke chain to query.
   * @returns Immutable array of supported {@link XToken} definitions for that chain.
   */
  public getSupportedTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.config.getSupportedMoneyMarketTokensByChainId(chainId);
  }

  /**
   * Return all supported money market tokens grouped by spoke chain.
   *
   * @returns A {@link GetMoneyMarketTokensApiResponse} map of chain key → token list.
   */
  public getSupportedTokens(): GetMoneyMarketTokensApiResponse {
    return this.config.getSupportedMoneyMarketTokens();
  }

  /**
   * Return the list of hub-side reserve asset addresses registered in the lending pool.
   *
   * @returns Immutable array of reserve asset addresses (vault tokens on the hub chain).
   */
  public getSupportedReserves(): readonly Address[] {
    return this.config.getMoneyMarketReserveAssets();
  }
}
