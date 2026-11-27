import {
  type SpokeService,
  Erc20Service,
  type HubProvider,
  relayTxAndWaitPacket,
  RELAY_FALLBACK_FLOOR_MS,
  EvmVaultTokenService,
  EvmAssetManagerService,
  encodeContractCalls,
  assertMpcPayoutAboveMinimum,
  calculateFeeAmount,
  isNativeBitcoinTransfer,
  encodeRecipient,
  wrappedSonicAbi,
  isHubChainKeyType,
  isStacksChainKeyType,
  isStellarChainKeyType,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsStellar,
  isEvmSpokeOnlyChainKeyType,
  isBitcoinChainKeyType,
  isBitcoinWalletProviderType,
  isUndefinedOrValidWalletProviderForChainKey,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  isEvmWalletProviderType,
  type SpokeApproveParams,
  type BitcoinBoundExtras,
} from '../shared/index.js';
import type { IntentTxResult, TxHashPair } from '../shared/types/types.js';
import type { ApprovalTxs } from '../shared/types/spoke-types.js';
import type { BackendApiService, RequestOverrideConfig } from '../backendApi/index.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
import {
  DETAILED_STATUS_NOT_DELIVERED,
  isBackendSubmitTxAbandoned,
  resolveDeliveredPacket,
  resolveMintedMpcDeposit,
  resolvePaidHubRelease,
} from '../backendApi/detailedStatusRouting.js';
import { isAuthFailure, isSodaxError } from '../errors/guards.js';
import type { DetailedBridgeStatus, DetailedBridgeStatusKey } from './detailedStatus.js';
import { createSubmitTxAttempt, type SubmitTxAttempt } from '../backendApi/submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';
import { canSendAtomicBatch } from '../shared/utils/evmAtomicBatch.js';
import {
  approvalBatchWaitMs,
  confirmApproval,
  confirmApprovalBatch,
  resolveApprovalStrategy,
  runWithApproval,
  sendApprovalBatch,
  type ApprovalOptions,
  type ApprovalStrategy,
} from '../shared/utils/approvalBatch.js';
import {
  type SpokeChainKey,
  type XToken,
  type Hex,
  type BridgeLimit,
  type GetAddressType,
  type Result,
  type HubChainKey,
  type TxReturnType,
  type EvmContractCall,
  type PartnerFee,
  type VaultReserves,
  type StellarChainKey,
  isHubChainKey,
  isMpcRelayChainKey,
  type GetWalletProviderType,
  type EvmSpokeOnlyChainKey,
  type GetTokenAddressType,
  type SpokeExecActionParams,
  type GetChainType,
  type EvmRawTransaction,
  DEFAULT_RELAY_TX_TIMEOUT,
  BITCOIN_DUST_SATS,
  type DepositReturnType,
} from '@sodax/types';
import { encodeFunctionData } from 'viem';
import type { ConfigService } from '../shared/config/ConfigService.js';
import BigNumber from 'bignumber.js';
import {
  lookupFailed,
  verifyFailed,
  intentCreationFailed,
  executionFailed,
  approveFailed,
  allowanceCheckFailed,
  unknownFailed,
  withErrorContext,
} from '../errors/wrappers.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  type BridgeAllowanceCheckError,
  type BridgeApproveError,
  type BridgeCreateIntentError,
  type BridgeDetailedStatusError,
  type BridgeLookupError,
  type BridgeOrchestrationError,
  type BridgeWithApprovalError,
  bridgeInvariant,
  isBridgeAllowanceCheckError,
  isBridgeApproveError,
  isBridgeCreateIntentError,
  isBridgeLookupError,
  isBridgeOrchestrationError,
  isBridgeWithApprovalError,
} from './errors.js';

export type CreateBridgeIntentParams<K extends SpokeChainKey = SpokeChainKey> = {
  srcAddress: string;
  srcChainKey: K;
  srcToken: string;
  amount: bigint;
  dstChainKey: SpokeChainKey;
  dstToken: string;
  recipient: string; // non-encoded recipient address
};

/**
 * Per-action bridge extras. `srcPublicKey` is Stacks-only (the address can't yield the signer key at raw-tx
 * build time); `bound` is Bound Exchange (Radfi) input for raw Bitcoin TRADING-mode sources.
 */
export type BridgeExtras<K extends SpokeChainKey = SpokeChainKey> = (GetChainType<K> extends 'STACKS'
  ? { srcPublicKey?: string }
  : { srcPublicKey?: never }) &
  (GetChainType<K> extends 'BITCOIN' ? { bound?: BitcoinBoundExtras } : { bound?: never }) & {
    /** Per-action partner fee; takes precedence over the config-level `bridgePartnerFee`. */
    partnerFee?: PartnerFee;
    /** Overrides the configured backend API key (`x-api-key`) for this action's submit-tx leg. */
    apiKey?: string;
  };

export type BridgeParams<ChainKey extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  ChainKey,
  Raw,
  CreateBridgeIntentParams<ChainKey>,
  BridgeExtras<ChainKey>
>;

/** Params for `bridgeWithApproval` / `getApprovalStrategy`: `bridge()`'s, plus the account-upgrade choice. */
export type BridgeWithApprovalParams<K extends SpokeChainKey> = BridgeParams<K, false> &
  ApprovalOptions & {
    /**
     * `context.batchId` of an earlier {@link ATOMIC_BATCH_UNCONFIRMED} error (same params and wallet): waits for
     * that batch instead of sending anything, then completes the bridge through the client-side relay.
     */
    resumeBatchId?: string;
    /** With `resumeBatchId`: that error's `context.callCount`; without it a per-call-tx batch can't be matched. */
    resumeBatchCallCount?: number;
  };

export type BridgeWithApprovalResponse = TxHashPair & { approvalStrategy: ApprovalStrategy };

export type BridgeServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
  backendApi: BackendApiService;
};

/** Backend submit-tx relays only via the intent relay (no MPC-relay end); submit and status both key off this. */
function backendRelaysBridge(srcChainKey: SpokeChainKey, dstChainKey: SpokeChainKey | undefined): boolean {
  return !isMpcRelayChainKey(srcChainKey) && !(dstChainKey !== undefined && isMpcRelayChainKey(dstChainKey));
}

export class BridgeService {
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  public readonly backendApi: BackendApiService;

  /** Read live off `ConfigService` so config and behavior can never disagree. */
  get useBackendSubmitTx(): boolean {
    return this.config.bridgeUseBackendSubmitTx;
  }

  constructor({ hubProvider, config, spoke, backendApi }: BridgeServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
    this.backendApi = backendApi;
  }

  /**
   * Partner fee for a bridge input. `inputAmount` must be in 18-dp hub/vault units (not spoke base units),
   * since a fixed `PartnerFee.amount` is 18-dp; a percentage fee is unit-agnostic.
   */
  public getFee(inputAmount: bigint, partnerFee: PartnerFee | undefined = this.config.bridgePartnerFee): bigint {
    if (!partnerFee) {
      return 0n;
    }

    return calculateFeeAmount(inputAmount, partnerFee);
  }

  /** Spender: hub wallet router on the hub, asset manager on EVM spokes; chains without approvals return `true`. */
  public async isAllowanceValid<S extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<S, Raw>,
  ): Promise<Result<boolean, BridgeAllowanceCheckError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };
    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      bridgeInvariant(params.srcToken.length > 0, 'Source asset is required', { ...baseCtx, field: 'srcToken' });

      let inner: Result<boolean> = { ok: true, value: true };

      if (isHubChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress,
          spender: await this.hubProvider.service.getUserRouter({
            address: params.srcAddress as GetAddressType<HubChainKey>,
            chainId: params.srcChainKey,
          }),
        } satisfies SpokeIsAllowanceValidParamsHub);
      } else if (isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress,
          spender: this.config.getChainConfig(params.srcChainKey).addresses.assetManager,
        } satisfies SpokeIsAllowanceValidParamsEvmSpoke);
      } else if (isStellarChainKeyType(params.srcChainKey)) {
        inner = await this.spoke.isAllowanceValid({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);
      }

      if (inner.ok) return inner;
      return {
        ok: false,
        error: allowanceCheckFailed('bridge', inner.error, baseCtx),
      };
    } catch (error) {
      if (isBridgeAllowanceCheckError(error)) return { ok: false, error };
      return {
        ok: false,
        error: allowanceCheckFailed('bridge', error, baseCtx),
      };
    }
  }

  /**
   * Approves the bridge spender (EVM and Stellar only). Returns a SINGLE transaction; for the unsigned
   * reset-then-approve case use {@link BridgeService.buildApproveTxs}.
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>, BridgeApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };

    const wrapApproveFailure = (cause: unknown) => approveFailed('bridge', cause, baseCtx);

    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      bridgeInvariant(params.srcToken.length > 0, 'Source asset is required', { ...baseCtx, field: 'srcToken' });

      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        bridgeInvariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );
        const spender = await this.resolveEvmApprovalSpender(params.srcChainKey, params.srcAddress);

        const coreParams = {
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.srcToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.amount,
          spender,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        } as SpokeApproveParams<HubChainKey | EvmSpokeOnlyChainKey, Raw>);

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        bridgeInvariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
          { ...baseCtx, field: 'walletProvider' },
        );
        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
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

      bridgeInvariant(false, 'Approval only supported for EVM spoke chains and Stellar', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isBridgeApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /** Bridge EVM spender (NOT the swaps spender): per-caller hub wallet router on the hub, asset manager on a spoke. */
  private async resolveEvmApprovalSpender(
    srcChainKey: HubChainKey | EvmSpokeOnlyChainKey,
    srcAddress: string,
  ): Promise<GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>> {
    return isHubChainKeyType(srcChainKey)
      ? await this.hubProvider.getUserHubWalletAddress(srcAddress, srcChainKey)
      : this.config.getChainConfig(srcChainKey).addresses.assetManager;
  }

  /**
   * Unsigned approval txs: `approveTx`, preceded by `resetTx` when a stale allowance must be zeroed first.
   * Wait for `resetTx` to be mined — `approveTx` is not valid until it lands.
   */
  public async buildApproveTxs<K extends SpokeChainKey>(
    _params: BridgeParams<K, true>,
  ): Promise<Result<ApprovalTxs<K>, BridgeApproveError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };

    const wrapApproveFailure = (cause: unknown) => approveFailed('bridge', cause, baseCtx);

    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      bridgeInvariant(params.srcToken.length > 0, 'Source asset is required', { ...baseCtx, field: 'srcToken' });

      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        const spender = await this.resolveEvmApprovalSpender(params.srcChainKey, params.srcAddress);

        const result = await this.spoke.buildApproveTxs<HubChainKey | EvmSpokeOnlyChainKey>({
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.srcToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.amount,
          spender,
          raw: true,
        });

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies ApprovalTxs<HubChainKey | EvmSpokeOnlyChainKey> as ApprovalTxs<K>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        const result = await this.spoke.buildApproveTxs<StellarChainKey>({
          srcChainKey: params.srcChainKey,
          token: params.srcToken,
          amount: params.amount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
          raw: true,
        });

        if (!result.ok) return { ok: false, error: wrapApproveFailure(result.error) };

        return {
          ok: true,
          value: result.value satisfies ApprovalTxs<StellarChainKey> as ApprovalTxs<K>,
        };
      }

      bridgeInvariant(false, 'Approval only supported for EVM spoke chains and Stellar', {
        ...baseCtx,
        field: 'srcChainKey',
      });
    } catch (error) {
      if (isBridgeApproveError(error)) return { ok: false, error };
      return { ok: false, error: wrapApproveFailure(error) };
    }
  }

  /**
   * Deposit, then relay via the backend submit-tx (default; falls back to client-side relay on any non-success,
   * re-relaying is idempotent). `timeout` is PER-ATTEMPT, not end-to-end — see `docs/BRIDGE.md`.
   */
  public async bridge<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
  ): Promise<Result<TxHashPair, BridgeOrchestrationError>> {
    return this.config.analytics.trackResult(
      'bridge',
      'bridge',
      async () => {
        const { params } = _params;
        const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };
        try {
          const created = await this.createBridgeIntent(_params);
          if (!created.ok) return { ok: false, error: created.error };

          return await this.completeBridge(_params, created.value);
        } catch (error) {
          if (isBridgeOrchestrationError(error)) return { ok: false, error };
          return {
            ok: false,
            error: executionFailed('bridge', error, baseCtx),
          };
        }
      },
      {
        start: () => ({
          srcChainKey: _params.params.srcChainKey,
          dstChainKey: _params.params.dstChainKey,
          srcToken: _params.params.srcToken,
          dstToken: _params.params.dstToken,
          amount: _params.params.amount,
          srcAddress: _params.params.srcAddress,
          recipient: _params.params.recipient,
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
   * Read-only: which approval path {@link bridgeWithApproval} would take. `'atomic-batch'` needs an EVM spoke
   * source and EIP-5792 atomic support (`'ready'` counts unless `allowAccountUpgrade: false`).
   */
  public async getApprovalStrategy<K extends SpokeChainKey>(
    _params: BridgeWithApprovalParams<K>,
  ): Promise<Result<ApprovalStrategy, BridgeAllowanceCheckError>> {
    const { params, walletProvider, allowAccountUpgrade = true } = _params;

    const allowance = await this.isAllowanceValid(_params);
    if (!allowance.ok) {
      return {
        ok: false,
        error: withErrorContext(allowance.error, {
          srcChainKey: params.srcChainKey,
          dstChainKey: params.dstChainKey,
          action: 'bridgeWithApproval',
        }),
      };
    }
    if (allowance.value) return { ok: true, value: 'not-required' };
    return {
      ok: true,
      value: await resolveApprovalStrategy({ srcChainKey: params.srcChainKey, walletProvider, allowAccountUpgrade }),
    };
  }

  /**
   * {@link bridge} with approval folded in (one atomic EIP-5792 batch when possible). A batch the user saw is never
   * retried as separate txs; on {@link ATOMIC_BATCH_UNCONFIRMED} don't resend — call again with `resumeBatchId`.
   */
  public async bridgeWithApproval<K extends SpokeChainKey>(
    _params: BridgeWithApprovalParams<K>,
  ): Promise<Result<BridgeWithApprovalResponse, BridgeWithApprovalError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey, action: 'bridgeWithApproval' };
    return this.config.analytics.trackResult(
      'bridge',
      'bridgeWithApproval',
      async () => {
        try {
          if (_params.resumeBatchId !== undefined) return await this.resumeAtomicBatch(_params, _params.resumeBatchId);

          const strategy = await this.getApprovalStrategy(_params);
          if (!strategy.ok) return strategy;

          const { result: created, approvalStrategy } = await runWithApproval<
            IntentTxResult<K, false>,
            BridgeWithApprovalError
          >({
            strategy: strategy.value,
            notRequired: () => this.createBridgeIntent(_params),
            atomicBatch: () => this.createBridgeIntentInAtomicBatch(_params),
            sequential: afterRefusedBatch => this.approveThenCreateBridgeIntent(_params, afterRefusedBatch),
            onBatchRefused: error =>
              this.config.logger.warn('[bridgeWithApproval] wallet refused the atomic batch; approving separately', {
                error,
              }),
          });
          if (!created.ok) return created;
          const completed = await this.completeBridge(_params, created.value);
          if (!completed.ok) return completed;
          return { ok: true, value: { ...completed.value, approvalStrategy } };
        } catch (error) {
          if (isBridgeWithApprovalError(error)) return { ok: false, error };
          return { ok: false, error: executionFailed('bridge', error, baseCtx) };
        }
      },
      {
        start: () => ({
          srcChainKey: params.srcChainKey,
          dstChainKey: params.dstChainKey,
          srcToken: params.srcToken,
          dstToken: params.dstToken,
          amount: params.amount,
          srcAddress: params.srcAddress,
          recipient: params.recipient,
        }),
        success: value => ({
          srcChainTxHash: value.srcChainTxHash,
          dstChainTxHash: value.dstChainTxHash,
          approvalStrategy: value.approvalStrategy,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /** Sends `[reset?, approve, deposit]` as one EIP-5792 atomic batch; the batch tx hash stands in as the deposit tx. */
  private async createBridgeIntentInAtomicBatch<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
  ): Promise<Result<IntentTxResult<K, false>, BridgeWithApprovalError>> {
    const { params, walletProvider, extras, skipSimulation } = _params;
    const srcChainKey = params.srcChainKey;
    bridgeInvariant(
      isEvmSpokeOnlyChainKeyType(srcChainKey) && isEvmWalletProviderType(walletProvider),
      'Atomic batches need an EVM spoke source and an EVM wallet provider',
    );
    const ctx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'bridgeWithApproval',
      approvalStrategy: 'atomic-batch',
    };

    const [approval, created] = await Promise.all([
      this.buildApproveTxs<K>({ params, raw: true }),
      this.createBridgeIntent<K, true>({ params, extras, skipSimulation, raw: true }),
    ]);
    if (!approval.ok) return { ok: false, error: withErrorContext(approval.error, ctx) };
    if (!created.ok) return { ok: false, error: withErrorContext(created.error, ctx) };

    // An EVM spoke source makes every unsigned leg an EvmRawTransaction.
    const { resetTx, approveTx } = approval.value as ApprovalTxs<EvmSpokeOnlyChainKey>;
    const depositTx = created.value.tx as EvmRawTransaction;
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs: resetTx ? [resetTx, approveTx, depositTx] : [approveTx, depositTx],
      timeoutMs: approvalBatchWaitMs(_params.timeout),
      feature: 'bridge',
      context: ctx,
    });
    if (!sent.ok) return sent;
    return {
      ok: true,
      value: {
        tx: sent.value.txHash satisfies TxReturnType<EvmSpokeOnlyChainKey, false> as TxReturnType<K, false>,
        relayData: created.value.relayData,
      },
    };
  }

  /** Finishes an {@link ATOMIC_BATCH_UNCONFIRMED} batch without sending anything, relaying its deposit client-side. */
  private async resumeAtomicBatch<K extends SpokeChainKey>(
    _params: BridgeWithApprovalParams<K>,
    batchId: string,
  ): Promise<Result<BridgeWithApprovalResponse, BridgeWithApprovalError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    bridgeInvariant(
      isEvmSpokeOnlyChainKeyType(srcChainKey) &&
        isEvmWalletProviderType(walletProvider) &&
        canSendAtomicBatch(walletProvider),
      'Resuming an atomic batch needs an EVM spoke source and an EIP-5792 wallet provider',
    );
    const ctx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'bridgeWithApproval',
      approvalStrategy: 'atomic-batch',
    };
    const timeoutMs = approvalBatchWaitMs(_params.timeout);

    const deposit = await confirmApprovalBatch({
      walletProvider,
      batchId,
      callCount: _params.resumeBatchCallCount,
      timeoutMs,
      feature: 'bridge',
      context: ctx,
    });
    if (!deposit.ok) return deposit;
    const srcTxHash = deposit.value.txHash;
    const txCtx = { ...ctx, srcTxHash };

    // An EVM spoke tx is relayed by its hash alone, so the lost `relayData` is not needed.
    const relayTimeout = Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS);
    const packet = await relayTxAndWaitPacket({
      srcTxHash,
      chainKey: srcChainKey,
      relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
      timeout: relayTimeout,
    });
    if (!packet.ok) return { ok: false, error: mapRelayFailure(packet.error, { feature: 'bridge', ...txCtx }) };

    // The intent relay stops at the hub; an MPC-relay chain pays out only once the hub tx is notified.
    let dstChainTxHash = packet.value.dst_tx_hash;
    if (isMpcRelayChainKey(params.dstChainKey)) {
      const released = await this.spoke.settleHubRelease(dstChainTxHash, params.dstChainKey, relayTimeout);
      if (!released.ok) {
        const { phase, cause } = released.error;
        const error =
          phase === 'verification'
            ? verifyFailed('bridge', cause, txCtx)
            : mapRelayFailure(cause, { feature: 'bridge', ...txCtx });
        return { ok: false, error };
      }
      dstChainTxHash = released.value.dstChainTxHash;
    }

    return { ok: true, value: { srcChainTxHash: srcTxHash, dstChainTxHash, approvalStrategy: 'atomic-batch' } };
  }

  private async approveThenCreateBridgeIntent<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
    validated = false,
  ): Promise<Result<IntentTxResult<K, false>, BridgeWithApprovalError>> {
    const { params, extras, skipSimulation } = _params;
    const ctx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'bridgeWithApproval',
      approvalStrategy: 'sequential',
    };

    // Build the deposit unsigned first, so params that can never bridge fail before the user pays for an approval.
    if (!validated) {
      const preflight = await this.createBridgeIntent<K, true>({ params, extras, skipSimulation, raw: true });
      if (!preflight.ok) return { ok: false, error: withErrorContext(preflight.error, ctx) };
    }

    const approved = await this.approve(_params);
    if (!approved.ok) return { ok: false, error: withErrorContext(approved.error, ctx) };

    const confirmed = await confirmApproval({
      waitForTxReceipt: receiptParams => this.spoke.waitForTxReceipt(receiptParams),
      txHash: approved.value,
      chainKey: params.srcChainKey,
      feature: 'bridge',
      context: ctx,
    });
    if (!confirmed.ok) return confirmed;

    return this.createBridgeIntent(_params);
  }

  /** Backend submit-tx attempt when enabled, falling back to {@link fallbackBridgeSteps} on any non-success. */
  private async completeBridge<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
    created: IntentTxResult<K, false>,
  ): Promise<Result<TxHashPair, BridgeOrchestrationError>> {
    // PER-ATTEMPT budget: the fallback gets a fresh one, else a slow relay would hit RELAY_TIMEOUT on leftovers.
    const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

    // Falling back on ANY non-success is safe because re-relay is idempotent.
    const { srcChainKey, dstChainKey } = _params.params;
    if (this.useBackendSubmitTx && backendRelaysBridge(srcChainKey, dstChainKey)) {
      const submitted = await this.submitTx(_params, created, createSubmitTxAttempt(timeoutMs));
      if (submitted.ok) return submitted;
      this.config.logger.warn('[bridge] backend submit-tx did not complete; falling back to the client-side relay', {
        error: submitted.error,
      });
    }

    return this.fallbackBridgeSteps(_params, created, timeoutMs);
  }

  /**
   * Client-side completion: verify the deposit, relay it, wait for the packet. Verification lives only here —
   * the backend verifies itself, and pre-verifying would delay every backend success. No hub-source short-circuit.
   */
  private async fallbackBridgeSteps<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
    created: IntentTxResult<K, false>,
    timeoutMs: number,
  ): Promise<Result<TxHashPair, BridgeOrchestrationError>> {
    const { params } = _params;
    // Every failure from here on is post-broadcast: carry the tx so the caller can keep reading its status.
    const txCtx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'bridge',
      srcTxHash: created.tx,
      relayData: created.relayData,
    };

    const settled = await this.spoke.settle({
      chainKey: params.srcChainKey,
      tx: created.tx,
      direction: 'inbound',
      relayData: created.relayData,
      dstChainKey: params.dstChainKey,
      // Full budget starting after verification (Stacks may poll 120s); floored so a landed deposit isn't stranded.
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
    });

    if (!settled.ok) {
      return {
        ok: false,
        error:
          settled.error.phase === 'verification'
            ? verifyFailed('bridge', settled.error.cause, txCtx)
            : mapRelayFailure(settled.error.cause, { feature: 'bridge', ...txCtx }),
      };
    }

    return settled;
  }

  /**
   * Backend submit-tx attempt; never throws, so any non-success falls back to the client relay. The backend keeps
   * going after we give up, so the fallback's relay can race it — safe because the relay dedups.
   */
  private async submitTx<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
    created: IntentTxResult<K, false>,
    attempt: SubmitTxAttempt,
  ): Promise<Result<TxHashPair, BridgeOrchestrationError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey };
    const { tx: spokeTxHash, relayData } = created;

    try {
      const outcome = await runBackendSubmitTx({
        attempt,
        api: this.backendApi.bridge,
        // The configured key is already in the BridgeApiService headers; only the override travels per call.
        overrideConfig: { apiKey: _params.extras?.apiKey },
        body: {
          txHash: spokeTxHash,
          srcChainKey,
          walletAddress: params.srcAddress,
          // FULL envelope: bridge has no intent.creator to rebuild the relay address from (split-tx-chain relay).
          relayData,
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        terminalStatus: 'executed',
        onExecuted: (result): TxHashPair | undefined =>
          result?.dstIntentTxHash ? { srcChainTxHash: spokeTxHash, dstChainTxHash: result.dstIntentTxHash } : undefined,
      });
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('bridge', outcome.cause, { ...baseCtx, action: 'bridge' }) };
    } catch (error) {
      return { ok: false, error: unknownFailed('bridge', error, { ...baseCtx, action: 'bridge' }) };
    }
  }

  /**
   * Spoke deposit only; the caller relays (`spoke.settle` inbound when either end is an MPC-relay chain).
   * Bitcoin supports only `raw: false` (Bound trading-wallet derivation flow).
   */
  async createBridgeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw, 'deposit'>, BridgeCreateIntentError>> {
    const { params, skipSimulation, extras } = _params;
    // Resolved once so the dust guard below and `buildBridgeData` price the same fee.
    const partnerFee = extras?.partnerFee ?? this.config.bridgePartnerFee;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };
    try {
      bridgeInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        baseCtx,
      );
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      const srcToken = this.resolveBridgeEndpointToken(params.srcChainKey, params.srcToken);
      const dstToken = this.resolveBridgeEndpointToken(params.dstChainKey, params.dstToken);

      bridgeInvariant(srcToken, `Unsupported spoke chain (${params.srcChainKey}) token: ${params.srcToken}`, {
        ...baseCtx,
        field: 'srcToken',
      });
      bridgeInvariant(dstToken, `Unsupported spoke chain (${params.dstChainKey}) token: ${params.dstToken}`, {
        ...baseCtx,
        field: 'dstToken',
      });
      // Mostly redundant with token resolution, but gives JS/cast consumers a field-tagged VALIDATION_FAILED.
      bridgeInvariant(
        this.config.isValidSpokeChainKey(params.srcChainKey),
        `Invalid spoke chain (srcChainKey): ${params.srcChainKey}`,
        { ...baseCtx, field: 'srcChainKey' },
      );
      bridgeInvariant(
        this.config.isValidSpokeChainKey(params.dstChainKey),
        `Invalid spoke chain (dstChainKey): ${params.dstChainKey}`,
        { ...baseCtx, field: 'dstChainKey' },
      );

      // Vault-1:1 across 8-dp BTC-family tokens, so `amount` is the satoshi value on both sides.
      if (isNativeBitcoinTransfer(this.config, params.srcChainKey, srcToken)) {
        bridgeInvariant(
          params.amount >= BITCOIN_DUST_SATS,
          `Invalid amount (${params.amount}): below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'amount' },
        );
      }
      if (isNativeBitcoinTransfer(this.config, params.dstChainKey, dstToken)) {
        // Post-fee sats must clear dust; the fee is deducted in 18-dp vault units, so reuse buildBridgeData's math.
        const { delivered } = this.computeBridgeAmounts(params.amount, srcToken, dstToken, partnerFee);
        bridgeInvariant(
          delivered >= BITCOIN_DUST_SATS,
          `Post-fee BTC delivery (${delivered}) is below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'amount' },
        );
      }
      if (isMpcRelayChainKey(params.dstChainKey)) {
        const { delivered } = this.computeBridgeAmounts(params.amount, srcToken, dstToken, partnerFee);
        assertMpcPayoutAboveMinimum({
          feature: 'bridge',
          dstChainKey: params.dstChainKey,
          token: dstToken,
          amount: delivered,
          context: { ...baseCtx, field: 'amount' },
        });
        await this.spoke.assertReleaseRecipientReady({
          feature: 'bridge',
          chainKey: params.dstChainKey,
          recipient: encodeRecipient(params.dstChainKey, params.recipient),
          token: dstToken.address,
          amount: delivered,
          context: { ...baseCtx, field: 'recipient' },
        });
      }

      // Stacks addresses can't yield the signer public key at raw-tx build time; fail early, not deep in deposit.
      if (isStacksChainKeyType(params.srcChainKey) && _params.raw === true) {
        bridgeInvariant(
          extras?.srcPublicKey !== undefined,
          'srcPublicKey is required for Stacks createBridgeIntent (raw) — the source tx is built unsigned and needs the signer public key',
          { ...baseCtx, field: 'srcPublicKey' },
        );
      }

      const personalAddress = params.srcAddress;
      // Bound trading-wallet derivation is a public GET, so raw too; Radfi auth stays non-raw only.
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey)) {
        if (_params.raw === false) {
          bridgeInvariant(
            isBitcoinWalletProviderType(_params.walletProvider),
            `Invalid wallet provider for chain key: ${params.srcChainKey}. Expected bitcoin wallet provider.`,
            { ...baseCtx, field: 'walletProvider' },
          );
          if (this.spoke.bitcoin.walletMode === 'TRADING') {
            await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
          }
        }
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
      }

      const hubWallet = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);
      const effectiveSkipSimulation =
        skipSimulation || (isBitcoinChainKeyType(params.srcChainKey) && this.spoke.bitcoin.walletMode === 'USER');

      const data: Hex = this.buildBridgeData(params, srcToken, dstToken, partnerFee);

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
        srcPublicKey: extras?.srcPublicKey,
        // Undefined falls back to the RadfiProvider instance token.
        accessToken: extras?.bound?.accessToken,
        to: hubWallet,
        token: params.srcToken as GetTokenAddressType<K>,
        amount: params.amount,
        data,
        skipSimulation: effectiveSkipSimulation,
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
        this.config.logger.error('createBridgeIntent failed', txResult.error);
        if (isBridgeCreateIntentError(txResult.error)) return { ok: false, error: txResult.error };
        return {
          ok: false,
          error: intentCreationFailed('bridge', txResult.error, baseCtx),
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
      this.config.logger.error('createBridgeIntent failed', error);
      if (isBridgeCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('bridge', error, baseCtx),
      };
    }
  }

  /**
   * Resolves by original asset address, falling back on the hub to the hub-asset address — a hub asset may have
   * no hub spoke-token entry (e.g. a partner BTC fee held as the BTC hub asset).
   */
  private resolveBridgeEndpointToken(chainKey: SpokeChainKey, token: string): XToken | undefined {
    const spokeToken = this.config.getSpokeTokenFromOriginalAssetAddress(chainKey, token);
    if (spokeToken) return spokeToken;
    if (!isHubChainKeyType(chainKey)) return undefined;
    const hubToken = this.config.getXTokenFromHubAsset(token);
    // The hub-asset index can store a spoke descriptor for the same asset.
    return hubToken && { ...hubToken, chainKey, address: hubToken.hubAsset };
  }

  /**
   * Single source for the fee + vault-decimal pipeline. `feeAmount`/`withdrawAmount` are in 18-dp vault units;
   * `delivered` is in the destination token's own units.
   */
  private computeBridgeAmounts(
    amount: bigint,
    srcToken: XToken,
    dstToken: XToken,
    partnerFee: PartnerFee | undefined,
  ): { feeAmount: bigint; withdrawAmount: bigint; delivered: bigint } {
    const translatedAmount = this.config.isSodaVaultHubAsset(srcToken.hubAsset)
      ? amount
      : EvmVaultTokenService.translateIncomingDecimals(srcToken.decimals, amount);
    const feeAmount = calculateFeeAmount(translatedAmount, partnerFee);
    const withdrawAmount = translatedAmount - feeAmount;
    const delivered = this.config.isSodaVaultHubAsset(dstToken.hubAsset)
      ? withdrawAmount
      : EvmVaultTokenService.translateOutgoingDecimals(dstToken.decimals, withdrawAmount);
    return { feeAmount, withdrawAmount, delivered };
  }

  /** Hub router call batch: vault deposit → partner-fee transfer → vault withdraw → payout. */
  buildBridgeData(
    params: CreateBridgeIntentParams,
    srcToken: XToken,
    dstToken: XToken,
    partnerFee: PartnerFee | undefined,
  ): Hex {
    bridgeInvariant(dstToken.chainKey === params.dstChainKey, 'Payout token chain must match the destination chain', {
      dstChainKey: params.dstChainKey,
      field: 'dstToken',
    });
    const calls: EvmContractCall[] = [];
    const { feeAmount, withdrawAmount, delivered } = this.computeBridgeAmounts(
      params.amount,
      srcToken,
      dstToken,
      partnerFee,
    );
    // Fee asset on the hub; never `params.srcToken`, which for spoke sources is a spoke-chain address.
    let srcVault: `0x${string}` = srcToken.hubAsset;
    if (!this.config.isSodaVaultHubAsset(srcToken.hubAsset)) {
      calls.push(Erc20Service.encodeApprove(srcToken.hubAsset, srcToken.vault, params.amount));
      calls.push(EvmVaultTokenService.encodeDeposit(srcToken.vault, srcToken.hubAsset, params.amount));
      srcVault = srcToken.vault;
    }

    if (partnerFee && feeAmount > 0n) {
      calls.push(Erc20Service.encodeTransfer(srcVault, partnerFee.address, feeAmount));
    }

    if (!this.config.isSodaVaultHubAsset(dstToken.hubAsset)) {
      calls.push(EvmVaultTokenService.encodeWithdraw(dstToken.vault, dstToken.hubAsset, withdrawAmount));
    }

    const encodedRecipientAddress = encodeRecipient(params.dstChainKey, params.recipient);
    if (isHubChainKey(params.dstChainKey)) {
      if (params.dstToken.toLowerCase() === this.hubProvider.chainConfig.nativeToken.toLowerCase()) {
        calls.push({
          address: dstToken.hubAsset,
          value: 0n,
          data: encodeFunctionData({
            abi: wrappedSonicAbi,
            functionName: 'withdrawTo',
            args: [encodedRecipientAddress, delivered],
          }),
        });
      } else {
        calls.push(Erc20Service.encodeTransfer(dstToken.hubAsset, encodedRecipientAddress, delivered));
      }
    } else {
      bridgeInvariant(dstToken, `Unsupported hub chain (${params.dstChainKey}) token: ${params.dstToken}`, {
        dstChainKey: params.dstChainKey,
        field: 'dstToken',
      });
      if (isMpcRelayChainKey(params.dstChainKey)) {
        assertMpcPayoutAboveMinimum({
          feature: 'bridge',
          dstChainKey: params.dstChainKey,
          token: dstToken,
          amount: delivered,
          context: { dstChainKey: params.dstChainKey, field: 'amount' },
        });
      }
      calls.push(
        EvmAssetManagerService.encodeTransfer(
          dstToken.hubAsset,
          encodedRecipientAddress,
          delivered,
          this.hubProvider.chainConfig.addresses.assetManager,
        ),
      );
    }
    return encodeContractCalls(calls);
  }

  /**
   * Bridge status from the source-chain tx, routed to the backend record, relay packet or MPC release record.
   * A rejected API key surfaces as-is; `DETAILED_STATUS_NOT_DELIVERED` is the miss to bound with a retry budget.
   */
  public async getDetailedStatus(
    params: DetailedBridgeStatusKey,
    config?: RequestOverrideConfig,
  ): Promise<Result<DetailedBridgeStatus, BridgeDetailedStatusError>> {
    try {
      // The backend rejects MPC-relay chain keys outright; skipping it counts as a definitive answer below.
      const { srcChainKey, dstChainKey } = params;
      const hasMpcRelayEnd = !backendRelaysBridge(srcChainKey, dstChainKey);
      const record = hasMpcRelayEnd
        ? undefined
        : await this.backendApi.bridge.getSubmitTxStatus({ txHash: params.srcTxHash, srcChainKey }, config);

      // `success: false` means "no record found" whatever `data` carries; `ok` only proves request + schema.
      if (record?.ok && record.value.success && !isBackendSubmitTxAbandoned(record.value.data)) {
        return { ok: true, value: { source: 'backend', data: record.value.data } };
      }

      if (record && !record.ok && isSodaxError(record.error) && isAuthFailure(record.error)) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(record.error, params, {
            status: record.error.context?.status,
          }),
        };
      }

      // Any record or a 404 is a definitive answer; a 5xx/transport failure can't tell dead from live bridges.
      const backendAnswered =
        !record || record.ok || (isSodaxError(record.error) && record.error.context?.status === 404);

      const minted = await resolveMintedMpcDeposit({
        srcChainKey: params.srcChainKey,
        srcTxHash: params.srcTxHash,
        backendAnswered,
        spoke: this.spoke,
      });
      if (minted) {
        if (!minted.ok) {
          return {
            ok: false,
            error: this.detailedStatusLookupFailed(minted.cause, params, {
              reason: minted.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
            }),
          };
        }
        const dst = params.dstChainKey;
        if (dst && isMpcRelayChainKey(dst)) {
          const release = await resolvePaidHubRelease({
            hubTxHash: minted.hubTxHash,
            backendAnswered,
            spoke: this.spoke,
          });
          if (release?.ok) return { ok: true, value: { source: 'mpcRelay', data: release.release } };
          return {
            ok: false,
            error: this.detailedStatusLookupFailed(
              release?.cause ?? new Error(`hub tx ${minted.hubTxHash} sends no MPC relay release`),
              params,
              {
                reason: (release?.budgetable ?? backendAnswered) ? DETAILED_STATUS_NOT_DELIVERED : undefined,
                hubTxHash: minted.hubTxHash,
                mpcRelay: true,
              },
            ),
          };
        }
        if (!dst) {
          return {
            ok: false,
            error: this.detailedStatusLookupFailed(new Error('MPC relay bridge status requires dstChainKey'), params, {
              reason: DETAILED_STATUS_NOT_DELIVERED,
              hubTxHash: minted.hubTxHash,
              mpcRelay: true,
            }),
          };
        }
        if (isHubChainKey(dst)) {
          return { ok: true, value: { source: 'mpcRelay', data: minted.deposit } };
        }
        // The MPC relay produced the hub mint, so its leg to the spoke lands only once someone relays it.
        const onward = await resolveDeliveredPacket({
          srcChainKey: this.hubProvider.chainConfig.chain.key,
          srcTxHash: minted.hubTxHash,
          relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
          backendAnswered,
        });
        if (onward.ok) return { ok: true, value: { source: 'relay', data: onward.packet } };
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(onward.cause, params, {
            reason: onward.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
            hubTxHash: minted.hubTxHash,
          }),
        };
      }

      const delivered = await resolveDeliveredPacket({
        srcChainKey: params.srcChainKey,
        srcTxHash: params.srcTxHash,
        relayerApiEndpoint: this.config.relay.relayerApiEndpoint,
        backendAnswered,
      });

      // A hub source's packet is the final answer, so only its miss can mean an MPC-relay payout. A
      // spoke source's packet stops at the hub, whose tx may still have that payout ahead of it.
      const isHubSource = isHubChainKeyType(params.srcChainKey);
      const hubTxHash = delivered.ok
        ? isHubSource
          ? undefined
          : delivered.packet.dst_tx_hash
        : isHubSource
          ? params.srcTxHash
          : undefined;
      const release = hubTxHash
        ? await resolvePaidHubRelease({ hubTxHash, backendAnswered, spoke: this.spoke })
        : undefined;
      if (release?.ok) return { ok: true, value: { source: 'mpcRelay', data: release.release } };
      // A release the read cannot confirm is retried while the bridge may still pay out on the MPC relay:
      // always when dstChainKey names one, and past the hub when dstChainKey is missing.
      const dstOnMpcRelay = dstChainKey !== undefined && isMpcRelayChainKey(dstChainKey);
      if (release && (release.budgetable || dstOnMpcRelay || (delivered.ok && dstChainKey === undefined))) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(release.cause, params, {
            reason: release.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
            // Past the hub, the release leg gets a budget of its own.
            hubTxHash: delivered.ok ? hubTxHash : undefined,
            mpcRelay: release.budgetable || hasMpcRelayEnd,
          }),
        };
      }
      // The packet reached the hub, but a hub tx with no release to the named MPC-relay chain is not a payout.
      if (!release && delivered.ok && hubTxHash && dstOnMpcRelay) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(new Error(`hub tx ${hubTxHash} sends no MPC relay release`), params, {
            reason: backendAnswered ? DETAILED_STATUS_NOT_DELIVERED : undefined,
            hubTxHash,
            mpcRelay: true,
          }),
        };
      }

      if (!delivered.ok) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(delivered.cause, params, {
            reason: delivered.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
          }),
        };
      }
      return { ok: true, value: { source: 'relay', data: delivered.packet } };
    } catch (error) {
      // The relay client asserts on empty identifiers rather than returning a Result.
      return { ok: false, error: this.detailedStatusLookupFailed(error, params) };
    }
  }

  /**
   * `status` is lifted because `isAuthFailure` reads `context.status`, not the cause chain. `mpcRelay` marks a
   * bridge settling in minutes rather than seconds, so callers can give it a longer budget.
   */
  private detailedStatusLookupFailed(
    cause: unknown,
    { srcChainKey, dstChainKey }: DetailedBridgeStatusKey,
    extra?: { reason?: string; status?: number; hubTxHash?: string; mpcRelay?: boolean },
  ): BridgeDetailedStatusError {
    const mpcRelay = !backendRelaysBridge(srcChainKey, dstChainKey);
    return lookupFailed('bridge', 'getDetailedStatus', cause, { srcChainKey, action: 'bridge', mpcRelay, ...extra });
  }

  /** Max bridgeable amount: vault deposit capacity on the source vs asset-manager liquidity on the destination. */
  public async getBridgeableAmount(from: XToken, to: XToken): Promise<Result<BridgeLimit, BridgeLookupError>> {
    const baseCtx = { srcChainKey: from.chainKey, dstChainKey: to.chainKey };
    try {
      const fromToken = this.resolveBridgeEndpointToken(from.chainKey, from.address);
      const toToken = this.resolveBridgeEndpointToken(to.chainKey, to.address);

      bridgeInvariant(fromToken, `Token not found for token ${from.address} on chain ${from.chainKey}`, {
        ...baseCtx,
        field: 'from',
      });
      bridgeInvariant(toToken, `Token not found for token ${to.address} on chain ${to.chainKey}`, {
        ...baseCtx,
        field: 'to',
      });
      bridgeInvariant(this.isBridgeable({ from, to }), `Tokens ${from.address} and ${to.address} are not bridgeable`, {
        ...baseCtx,
      });

      if (
        (isMpcRelayChainKey(from.chainKey) || isMpcRelayChainKey(to.chainKey)) &&
        toToken.vault.toLowerCase() === toToken.hubAsset.toLowerCase() &&
        fromToken.vault.toLowerCase() === fromToken.hubAsset.toLowerCase()
      ) {
        return {
          ok: false,
          error: lookupFailed(
            'bridge',
            'getBridgeableAmount',
            new Error(`No vault limit is available for the native ${fromToken.symbol} route`),
            baseCtx,
          ),
        };
      }

      const [tokenInfos, reserves] = await Promise.all([
        EvmVaultTokenService.getTokenInfos(
          fromToken.vault,
          [fromToken.hubAsset, toToken.hubAsset],
          this.hubProvider.publicClient,
        ),
        EvmVaultTokenService.getVaultReserves(toToken.vault, this.hubProvider.publicClient),
      ]);

      bridgeInvariant(tokenInfos.length === 2, `Expected 2 token infos, got ${tokenInfos.length}`, baseCtx);
      const [fromTokenInfo, toTokenInfo] = tokenInfos;
      bridgeInvariant(fromTokenInfo, 'From token info not found', { ...baseCtx, field: 'from' });
      bridgeInvariant(toTokenInfo, 'To token info not found', { ...baseCtx, field: 'to' });

      if (from.chainKey !== this.hubProvider.chainConfig.chain.key && !fromTokenInfo.isSupported) {
        return {
          ok: true,
          value: {
            amount: 0n,
            decimals: fromTokenInfo.decimals,
            type: 'DEPOSIT_LIMIT',
          },
        };
      }

      if (!isHubChainKey(from.chainKey) && isHubChainKey(to.chainKey)) {
        const fromTokenDepositedAmount = this.findTokenBalanceInReserves(reserves, from);
        const availableDeposit = fromTokenInfo.maxDeposit - fromTokenDepositedAmount;

        return {
          ok: true,
          value: {
            amount: availableDeposit,
            decimals: fromTokenInfo.decimals,
            type: 'DEPOSIT_LIMIT',
          },
        };
      }

      if (isHubChainKey(from.chainKey) && !isHubChainKey(to.chainKey)) {
        return {
          ok: true,
          value: {
            amount: this.findTokenBalanceInReserves(reserves, to),
            decimals: toTokenInfo.decimals,
            type: 'WITHDRAWAL_LIMIT',
          },
        };
      }

      const fromTokenDepositedAmount = this.findTokenBalanceInReserves(reserves, from);
      const availableDeposit = fromTokenInfo.maxDeposit - fromTokenDepositedAmount;
      const assetManagerBalance = this.findTokenBalanceInReserves(reserves, to);
      const availableDepositNormalised = BigNumber(availableDeposit).shiftedBy(-fromTokenInfo.decimals);
      const assetManagerBalanceNormalised = BigNumber(assetManagerBalance).shiftedBy(-toTokenInfo.decimals);

      // Compared in normalised units since the two sides can have different decimals.
      return {
        ok: true,
        value: availableDepositNormalised.isLessThan(assetManagerBalanceNormalised)
          ? { amount: availableDeposit, decimals: fromTokenInfo.decimals, type: 'DEPOSIT_LIMIT' }
          : { amount: assetManagerBalance, decimals: toTokenInfo.decimals, type: 'WITHDRAWAL_LIMIT' },
      };
    } catch (error) {
      this.config.logger.error('getBridgeableAmount failed', error);
      if (isBridgeLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('bridge', 'getBridgeableAmount', error, baseCtx),
      };
    }
  }

  /** Bridgeable when both tokens share a hub vault; never throws. `unchecked` skips the configured-chain guard. */
  public isBridgeable({ from, to, unchecked = false }: { from: XToken; to: XToken; unchecked?: boolean }): boolean {
    try {
      if (!unchecked) {
        bridgeInvariant(this.config.isValidSpokeChainKey(from.chainKey), `Invalid spoke chain (${from.chainKey})`, {
          srcChainKey: from.chainKey,
          field: 'from',
        });
        bridgeInvariant(this.config.isValidSpokeChainKey(to.chainKey), `Invalid spoke chain (${to.chainKey})`, {
          dstChainKey: to.chainKey,
          field: 'to',
        });
      }

      const srcToken = this.resolveBridgeEndpointToken(from.chainKey, from.address);
      const dstToken = this.resolveBridgeEndpointToken(to.chainKey, to.address);

      bridgeInvariant(srcToken, `Token not found for token ${from.address} on chain ${from.chainKey}`, {
        srcChainKey: from.chainKey,
        field: 'from',
      });
      bridgeInvariant(dstToken, `Token not found for token ${to.address} on chain ${to.chainKey}`, {
        dstChainKey: to.chainKey,
        field: 'to',
      });

      return srcToken.vault.toLowerCase() === dstToken.vault.toLowerCase();
    } catch (error) {
      this.config.logger.error('isBridgeable check failed', error);
      return false;
    }
  }

  /** Destination-chain tokens sharing the source token's hub vault. */
  public getBridgeableTokens(
    from: SpokeChainKey,
    to: SpokeChainKey,
    token: string,
  ): Result<XToken[], BridgeLookupError> {
    const baseCtx = { srcChainKey: from, dstChainKey: to };
    try {
      const srcToken = this.resolveBridgeEndpointToken(from, token);
      bridgeInvariant(srcToken, `Token not found for token ${token} on chain ${from}`, { ...baseCtx, field: 'token' });

      const destinations = this.filterTokensWithSameVault(
        this.config.spokeChainConfig[to].supportedTokens,
        to,
        srcToken,
      );
      if (
        isHubChainKeyType(to) &&
        isMpcRelayChainKey(from) &&
        srcToken.vault.toLowerCase() === srcToken.hubAsset.toLowerCase() &&
        !destinations.some(candidate => candidate.address.toLowerCase() === srcToken.hubAsset.toLowerCase())
      ) {
        destinations.push({ ...srcToken, address: srcToken.hubAsset, chainKey: to });
      }
      return { ok: true, value: destinations };
    } catch (error) {
      if (isBridgeLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('bridge', 'getBridgeableTokens', error, baseCtx),
      };
    }
  }

  public filterTokensWithSameVault(
    tokens: Record<string, XToken>,
    to: SpokeChainKey,
    srcToken: XToken | undefined,
  ): XToken[] {
    const bridgeableTokens: XToken[] = [];

    for (const token of Object.values(tokens)) {
      const dstToken = this.resolveBridgeEndpointToken(to, token.address);

      if (dstToken && srcToken && dstToken.vault.toLowerCase() === srcToken.vault.toLowerCase()) {
        bridgeableTokens.push({
          ...token,
          chainKey: to,
        });
      }
    }

    return bridgeableTokens;
  }

  /** Throws when the token is not in config or not present in the reserves snapshot. */
  public findTokenBalanceInReserves(reserves: VaultReserves, token: XToken): bigint {
    const hubAsset = this.config.getSpokeTokenFromOriginalAssetAddress(token.chainKey, token.address);
    bridgeInvariant(hubAsset, `Token not found for token ${token.address} on chain ${token.chainKey}`, {
      srcChainKey: token.chainKey,
      field: 'token',
    });
    const tokenIndex = reserves.tokens.findIndex(t => t.toLowerCase() === hubAsset.hubAsset.toLowerCase());
    bridgeInvariant(
      tokenIndex !== -1,
      `Token ${hubAsset.hubAsset} not found in the vault reserves for chain ${token.chainKey}`,
      { srcChainKey: token.chainKey, field: 'token' },
    );
    return reserves.balances[tokenIndex] ?? 0n;
  }
}
