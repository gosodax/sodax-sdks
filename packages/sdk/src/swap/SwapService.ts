import { SOLVED_PAYOUT_HEADROOM_FACTOR } from '../shared/utils/solved-payout.js';
import { isHex } from 'viem';
import { invariant } from '../shared/utils/tiny-invariant.js';
import {
  submitTransaction,
  waitUntilIntentExecuted,
  SonicSpokeService,
  type SpokeService,
  adjustAmountByFee,
  calculateFeeAmount,
  calculatePercentageFeeAmount,
  encodeContractCalls,
  isSonicChainKeyType,
  type EstimateGasParams,
  type ConfigService,
  type HubProvider,
  type GetRelayResponse,
  type IntentDeliveryInfo,
  type IntentRelayRequest,
  type PacketData,
  isBitcoinChainKeyType,
  isHubChainKeyType,
  reverseEncodeAddress,
  type SendMessageParams,
  type SpokeIsAllowanceValidParamsEvmSpoke,
  type SpokeIsAllowanceValidParamsHub,
  type SpokeIsAllowanceValidParamsStellar,
  isEvmSpokeOnlyChainKeyType,
  isStellarChainKeyType,
  isUndefinedOrValidWalletProviderForChainKey,
  relayTxAndWaitPacket,
  isOptionalEvmWalletProviderType,
  isOptionalStellarWalletProviderType,
  isBitcoinWalletProviderType,
  isEvmWalletProviderType,
  type RelayExtraData,
  type TxHashPair,
  isStacksChainKeyType,
  isXrpChainKeyType,
  isNativeBitcoinTransfer,
  assertMpcPayoutAboveMinimum,
  encodeRecipient,
  assertMpcSwapRoute,
  assertProductionSwapRoute,
  isMpcRelayChainKeyType,
  RELAY_FALLBACK_FLOOR_MS,
} from '../shared/index.js';
import { readIntentJournalOutcome, resolveDeliveredHubTxHash } from '../backendApi/detailedStatusRouting.js';
import { SolverApiService } from './SolverApiService.js';
import { EvmSolverService } from './EvmSolverService.js';
import type { BackendApiService } from '../backendApi/index.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
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
  type ApprovalStrategyError,
} from '../shared/utils/approvalBatch.js';
import type { ApprovalTxs } from '../shared/types/spoke-types.js';
import { selectSolvedIntentPacket } from './selectSolvedIntentPacket.js';
import type { HubRelease } from '../shared/services/mpcRelay/MpcRelayApiService.js';
import { intentDepositSpender } from './intentDepositSpender.js';
import { estimateSwapSpeedTier, type SwapSpeedTierParams, type SwapSpeedTierResult } from './speed-tier.js';
import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { isAuthFailure } from '../errors/guards.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  verifyFailed,
  intentCreationFailed,
  executionFailed,
  unknownFailed,
  approveFailed,
  allowanceCheckFailed,
  lookupFailed,
  withErrorContext,
} from '../errors/wrappers.js';
import {
  DETAILED_STATUS_NOT_DELIVERED,
  isBackendSubmitTxAbandoned,
  type DetailedSwapStatus,
  type DetailedSwapStatusKey,
} from './detailedStatus.js';
import {
  type SwapCreateIntentError,
  type PostExecutionError,
  type SwapError,
  type DetailedStatusError,
  type SwapWithApprovalError,
  isSwapCreateIntentError,
  isPostExecutionError,
  isSwapError,
  isSwapWithApprovalError,
  swapInvariant,
} from './errors.js';
export type {
  CreateIntentParams,
  CreateLimitOrderParams,
  Intent,
  FeeData,
  IntentData,
  IntentState,
  SwapExtras,
  BitcoinBoundExtras,
} from '../shared/types/intent-types.js';
export { IntentDataType } from '../shared/types/intent-types.js';
import type {
  CreateIntentParams,
  CreateLimitOrderParams,
  Intent,
  IntentState,
  SwapExtras,
} from '../shared/types/intent-types.js';
import {
  type SpokeChainKey,
  type Hex,
  type Hash,
  type HttpUrl,
  getIntentRelayChainId,
  isMpcRelayChainKey,
  type FeeAmount,
  type GetWalletProviderType,
  type PartnerFee,
  type SolverErrorResponse,
  type SolverExecutionRequest,
  type SolverExecutionResponse,
  type SolverIntentQuoteRequest,
  type SolverIntentQuoteResponse,
  type SolverIntentStatusRequest,
  type SolverIntentStatusResponse,
  SolverIntentErrorCode,
  SolverIntentStatusCode,
  type Result,
  type TxReturnType,
  type GetEstimateGasReturnType,
  type SolverConfig,
  type XToken,
  HUB_CHAIN_KEY,
  isHubChainKey,
  isRealWorldAsset,
  DEFAULT_RELAY_TX_TIMEOUT,
  DEFAULT_DEADLINE_OFFSET,
  type GetAddressType,
  type GetTokenAddressType,
  type HubChainKey,
  type EvmSpokeOnlyChainKey,
  type StellarChainKey,
  type SpokeExecActionParams,
  type SonicChainKey,
  type EvmRawTransaction,
  BITCOIN_DUST_SATS,
  type DepositReturnType,
  type SendMessageReturnType,
} from '@sodax/types';

export type GetIntentSubmitTxExtraDataParams = { txHash: Hash } | { intent: Intent };

export type SwapResponse = {
  solverExecutionResponse: SolverExecutionResponse;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
};

/** Where a solved intent's output landed; `dstTxHash` is the transaction that pays the destination. */
export type IntentDelivery =
  | { source: 'hub'; dstTxHash: string }
  | { source: 'relay'; dstTxHash: string; packet: PacketData }
  | { source: 'mpcRelay'; dstTxHash: string; release: HubRelease };

export type SwapApprovalStrategy = ApprovalStrategy;

export type SwapWithApprovalResponse = SwapResponse & { approvalStrategy: SwapApprovalStrategy };

export type SwapWithApprovalParams<K extends SpokeChainKey> = SwapActionParams<K, false> &
  ApprovalOptions & {
    /** `context.batchId` of an earlier {@link ATOMIC_BATCH_UNCONFIRMED} error (same params/wallet): re-waits that batch instead of resending. */
    resumeBatchId?: string;
    /** That error's `context.callCount`; without it a batch confirmed as one tx per call cannot be matched to its deposit. */
    resumeBatchCallCount?: number;
  };

export type CreateIntentResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: DepositReturnType<K, Raw>;
  intent: Intent & FeeAmount;
  relayData: RelayExtraData;
};

export type SwapActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateIntentParams<K>,
  SwapExtras<K>
>;

export type LimitOrderActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CreateLimitOrderParams<K>,
  SwapExtras<K>
>;

/** `srcChainKey` is explicit because `intent.srcChain` (bigint) cannot narrow K; it is asserted to match at runtime. */
export type CancelIntentParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  intent: Intent;
  /** Defaults to `intent.srcAddress`. Bitcoin TRADING mode cancels from the personal wallet, so raw cancels must pass it. */
  srcAddress?: GetAddressType<K>;
  skipSimulation?: boolean;
  timeout?: number;
};

export type CancelIntentActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CancelIntentParams<K>
>;

export type GetQuoteParams = SolverIntentQuoteRequest & {
  /** Per-call partner fee override; stripped before the request reaches the solver. */
  partnerFee?: PartnerFee;
};

export type SwapServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
  hubProvider: HubProvider;
  backendApi: BackendApiService;
  /** @deprecated Use `new Sodax({ swaps: { useBackendSubmitTx } })`; removed in v3. When set, it wins over config. */
  useBackendSubmitTx?: boolean;
};

/** Durable-record lookup budget in `getStatus`: a polled read must not inherit the long default request budget. */
const RECONCILE_TIMEOUT_MS = 5_000;

/** Solver status budget in `getDetailedStatus`; the relay leg keeps its own longer budget, since an expired one is untagged and would poll forever. */
const DETAILED_STATUS_SOLVER_TIMEOUT_MS = 5_000;

/** Intent-based swaps: spoke intent relayed to the Sonic hub, filled by the solver on the destination chain. */
export class SwapService {
  readonly hubProvider: HubProvider;
  readonly config: ConfigService;
  readonly spoke: SpokeService;

  readonly solver: SolverConfig;
  readonly relayerApiEndpoint: HttpUrl;

  readonly backendApi: BackendApiService;

  private readonly useBackendSubmitTxOverride: boolean | undefined;

  /** Read live off `ConfigService` so config and behavior cannot disagree (unless the deprecated override is set). */
  get useBackendSubmitTx(): boolean {
    return this.useBackendSubmitTxOverride ?? this.config.swapUseBackendSubmitTx;
  }

  /** Read live (not snapshotted) so it tracks `config.swapPartnerFee` if the config object is replaced. */
  get partnerFee(): PartnerFee | undefined {
    return this.config.swapPartnerFee;
  }

  public constructor({ config, hubProvider, spoke, backendApi, useBackendSubmitTx }: SwapServiceConstructorParams) {
    this.solver = config.solver;
    this.relayerApiEndpoint = config.relay.relayerApiEndpoint;
    this.config = config;
    this.hubProvider = hubProvider;
    this.spoke = spoke;
    this.backendApi = backendApi;
    this.useBackendSubmitTxOverride = useBackendSubmitTx;
  }

  public async estimateGas<C extends SpokeChainKey>(
    params: EstimateGasParams<C>,
  ): Promise<Result<GetEstimateGasReturnType<C>>> {
    return this.spoke.estimateGas(params) as Promise<Result<GetEstimateGasReturnType<C>>>;
  }

  /**
   * Solver quote with `amount` reduced by the partner fee, so `quoted_amount` is the user's net output.
   * Pass `partnerFee` to match an `extras.partnerFee` override given to `createIntent`.
   */
  public async getQuote(payload: GetQuoteParams): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>> {
    const { partnerFee = this.partnerFee, ...request } = payload;
    const adjustedPayload = {
      ...request,
      amount: adjustAmountByFee(request.amount, partnerFee, request.quote_type),
    } satisfies SolverIntentQuoteRequest;
    return SolverApiService.getQuote(adjustedPayload, this.solver, this.config);
  }

  public getPartnerFee(inputAmount: bigint): bigint {
    if (!this.partnerFee) {
      return 0n;
    }

    return calculateFeeAmount(inputAmount, this.partnerFee);
  }

  /** Maximum solver fee (10 bps); the actual fee is 1-10 bps by route and is already included in quotes. */
  public getSolverFee(inputAmount: bigint): bigint {
    return calculatePercentageFeeAmount(inputAmount, 10);
  }

  /**
   * `intent_tx_hash` must be the hub (Sonic) tx hash, i.e. the relay packet's `dst_tx_hash`.
   * A `NOT_FOUND` or failed request is cross-checked against the backend's durable intent record.
   */
  public async getStatus(
    request: SolverIntentStatusRequest,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    return this.resolveSolverStatus(request);
  }

  /**
   * `timeoutMs` bounds only the solver request (the reconcile has its own budget). `reconcileNonFinal`
   * (getDetailedStatus only) also reconciles in-flight answers, since the solver can report a cancelled intent in flight forever.
   */
  private async resolveSolverStatus(
    request: SolverIntentStatusRequest,
    { timeoutMs, reconcileNonFinal = false }: { timeoutMs?: number; reconcileNonFinal?: boolean } = {},
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    const solverResult = await SolverApiService.getStatus(
      request,
      this.solver,
      this.config.logger,
      timeoutMs,
      this.config.apiKey,
    );
    const status = solverResult.ok ? solverResult.value.status : undefined;
    if (status === SolverIntentStatusCode.SOLVED || status === SolverIntentStatusCode.FAILED) return solverResult;
    const forgotten = !solverResult.ok || status === SolverIntentStatusCode.NOT_FOUND;
    if (!forgotten && !reconcileNonFinal) return solverResult;

    // The solver keeps state in memory, so a restart yields NOT_FOUND for filled intents; the backend record is durable.
    // Clamp, not override: a per-call timeout replaces the configured one and could lengthen a stricter config.
    const timeout = Math.min(RECONCILE_TIMEOUT_MS, this.backendApi.requestTimeoutMs);
    const intent = await this.backendApi.getIntentByTxHash(request.intent_tx_hash, { timeout });
    const outcome = intent.ok ? readIntentJournalOutcome(intent.value) : undefined;
    if (outcome?.kind === 'solved') {
      return { ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: outcome.fillTxHash } };
    }
    if (outcome?.kind === 'cancelled' && reconcileNonFinal) {
      return { ok: true, value: { status: SolverIntentStatusCode.FAILED } };
    }
    // Without terminal evidence an in-flight answer stands, even behind an unreadable record.
    if (!forgotten) return solverResult;

    // A record or 404 is an answer; a 5xx/transport failure is not, and reporting NOT_FOUND would let
    // pollers (which give up after 40 misses) abandon a swap that may have filled.
    const backendAnswered = intent.ok || (isSodaxError(intent.error) && intent.error.context?.status === 404);
    if (solverResult.ok && !backendAnswered) {
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: 'solver reported NOT_FOUND and the durable intent record could not be read to verify it',
          },
        },
      };
    }

    return solverResult;
  }

  /**
   * Status by source tx: the backend submit-tx record while usable, else the (journal-reconciled) solver answer.
   * A reconciled cancel reads `FAILED`; don't offer a cancel for it. See `docs/SWAPS.md` § Get Detailed Status.
   */
  public async getDetailedStatus(
    params: DetailedSwapStatusKey,
  ): Promise<Result<DetailedSwapStatus, DetailedStatusError>> {
    try {
      const record = await this.backendApi.swaps.getSubmitTxStatus({
        txHash: params.srcTxHash,
        srcChainKey: params.srcChainKey,
      });

      // `success: false` is the wire contract's "no record found", whatever `data` carries.
      if (record.ok && record.value.success && !isBackendSubmitTxAbandoned(record.value.data)) {
        return { ok: true, value: { source: 'backend', data: record.value.data } };
      }

      // A rejected key is a config problem; routing on would bury it and leave pollers retrying forever.
      if (!record.ok && isSodaxError(record.error) && isAuthFailure(record.error)) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(record.error, params.srcChainKey, {
            status: record.error.context?.status,
          }),
        };
      }

      // A record or 404 is a definitive answer; after a 5xx/transport failure a relay miss must stay
      // unbudgeted, or a backend outage would stop callers polling a live swap.
      const backendAnswered = record.ok || (isSodaxError(record.error) && record.error.context?.status === 404);

      const dstTxHash = await this.resolveHubTxHash(params, backendAnswered);
      if (!dstTxHash.ok) return dstTxHash;

      const solver = await this.resolveSolverStatus(
        { intent_tx_hash: dstTxHash.value },
        { timeoutMs: DETAILED_STATUS_SOLVER_TIMEOUT_MS, reconcileNonFinal: true },
      );
      if (!solver.ok) {
        return { ok: false, error: this.detailedStatusLookupFailed(solver.error, params.srcChainKey) };
      }
      return { ok: true, value: { source: 'solver', dstTxHash: dstTxHash.value, data: solver.value } };
    } catch (error) {
      // The relay client asserts on empty identifiers rather than returning a Result.
      return { ok: false, error: this.detailedStatusLookupFailed(error, params.srcChainKey) };
    }
  }

  /** Hub tx hash the solver is keyed on: the source tx on the hub, else from the delivered packet / MPC deposit record. */
  private async resolveHubTxHash(
    key: DetailedSwapStatusKey,
    backendAnswered: boolean,
  ): Promise<Result<Hex, DetailedStatusError>> {
    let hubTxHash = key.srcTxHash;

    if (!isHubChainKeyType(key.srcChainKey)) {
      const delivered = await resolveDeliveredHubTxHash({
        srcChainKey: key.srcChainKey,
        srcTxHash: key.srcTxHash,
        relayerApiEndpoint: this.relayerApiEndpoint,
        backendAnswered,
        spoke: this.spoke,
      });
      if (!delivered.ok) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(delivered.cause, key.srcChainKey, {
            reason: delivered.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
          }),
        };
      }
      hubTxHash = delivered.hubTxHash;
    }

    if (isHex(hubTxHash)) return { ok: true, value: hubTxHash };
    return {
      ok: false,
      error: this.detailedStatusLookupFailed(
        new Error(`hub tx hash is not a hex string: ${hubTxHash}`),
        key.srcChainKey,
      ),
    };
  }

  /**
   * `reason` marks the budgetable not-delivered miss; without it callers should keep retrying.
   * `status` is lifted because `isAuthFailure` reads `context.status`, not the cause chain.
   */
  private detailedStatusLookupFailed(
    cause: unknown,
    srcChainKey: SpokeChainKey,
    extra?: { reason?: string; status?: number },
  ): DetailedStatusError {
    return lookupFailed('swap', 'getDetailedStatus', cause, { srcChainKey, action: 'swap', ...extra });
  }

  /** Tells the solver to fill an intent registered on the hub; `swap()` calls this automatically. */
  public async postExecution(
    request: SolverExecutionRequest,
  ): Promise<Result<SolverExecutionResponse, PostExecutionError>> {
    try {
      const result = await SolverApiService.postExecution(request, this.solver, this.config.logger, this.config.apiKey);
      if (result.ok) return result;

      // Defensive: a malformed upstream payload may lack `detail` despite the type.
      const detail = result.error?.detail ?? {
        code: -999, // SolverIntentErrorCode.UNKNOWN
        message: 'Solver returned malformed error response',
      };
      return {
        ok: false,
        error: new SodaxError('EXTERNAL_API_ERROR', detail.message, {
          feature: 'swap',
          context: {
            phase: 'postExecution',
            api: 'solver',
            solverCode: detail.code,
            solverDetail: detail,
          },
        }),
      };
    } catch (error) {
      // Out-of-union SodaxErrors are rewrapped so the typed contract holds at runtime.
      if (isPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('swap', error, { phase: 'postExecution' }) };
    }
  }

  public async submitIntent(submitPayload: IntentRelayRequest<'submit'>): Promise<Result<GetRelayResponse<'submit'>>> {
    try {
      return await submitTransaction(submitPayload, this.relayerApiEndpoint);
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * End-to-end swap: createIntent, then backend submit-tx (falls back to client-side relay + postExecution; idempotent).
   * `timeout` is per attempt, not end-to-end — see `docs/SWAPS.md` § How `timeout` bounds each attempt.
   */
  public async swap<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey };
    return this.config.analytics.trackResult(
      'swap',
      'swap',
      async () => {
        try {
          const createIntentResult = await this.createIntent(_params);
          if (!createIntentResult.ok) {
            return { ok: false, error: createIntentResult.error };
          }

          return await this.completeSwap(_params, createIntentResult.value);
        } catch (error) {
          if (isSwapError(error)) return { ok: false, error };
          return {
            ok: false,
            error: unknownFailed('swap', error, { ...baseCtx, action: 'swap' }),
          };
        }
      },
      {
        start: () => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcAddress: params.srcAddress,
          dstAddress: params.dstAddress,
        }),
        success: value => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcTxHash: value.intentDeliveryInfo.srcTxHash,
          dstTxHash: value.intentDeliveryInfo.dstTxHash,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  /**
   * Read-only: the approval path {@link swapWithApproval} would take. `'ready'` EIP-5792 wallets need an
   * account upgrade on first batch (`allowAccountUpgrade: false` treats them as unable to batch).
   */
  public async getApprovalStrategy<K extends SpokeChainKey>(
    _params: SwapWithApprovalParams<K>,
  ): Promise<Result<SwapApprovalStrategy, ApprovalStrategyError>> {
    const { params, walletProvider, allowAccountUpgrade = true } = _params;
    const srcChainKey = params.srcChainKey;

    const allowance = await this.isAllowanceValid(_params);
    if (!allowance.ok) {
      return {
        ok: false,
        error: allowanceCheckFailed('swap', allowance.error, {
          srcChainKey,
          dstChainKey: params.dstChainKey,
          action: 'swapWithApproval',
        }),
      };
    }
    if (allowance.value) return { ok: true, value: 'not-required' };
    return { ok: true, value: await resolveApprovalStrategy({ srcChainKey, walletProvider, allowAccountUpgrade }) };
  }

  /**
   * {@link swap} with approval folded in (one atomic EIP-5792 batch when possible). A batch the user saw is never
   * resent as separate txs: on {@link ATOMIC_BATCH_UNCONFIRMED} it may have landed, so resume via `resumeBatchId`.
   */
  public async swapWithApproval<K extends SpokeChainKey>(
    _params: SwapWithApprovalParams<K>,
  ): Promise<Result<SwapWithApprovalResponse, SwapWithApprovalError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'swapWithApproval' };
    return this.config.analytics.trackResult(
      'swap',
      'swapWithApproval',
      async () => {
        try {
          if (_params.resumeBatchId !== undefined) return await this.resumeAtomicBatch(_params, _params.resumeBatchId);

          const strategy = await this.getApprovalStrategy(_params);
          if (!strategy.ok) return strategy;

          const { result: created, approvalStrategy } = await runWithApproval<
            CreateIntentResult<K, false>,
            SwapWithApprovalError
          >({
            strategy: strategy.value,
            notRequired: () => this.createIntent(_params),
            atomicBatch: () => this.createIntentInAtomicBatch(_params),
            sequential: afterRefusedBatch => this.approveThenCreateIntent(_params, afterRefusedBatch),
            onBatchRefused: error =>
              this.config.logger.warn('[swapWithApproval] wallet refused the atomic batch; approving separately', {
                error,
              }),
          });
          if (!created.ok) return created;

          const completed = await this.completeSwap(_params, created.value);
          if (!completed.ok) return completed;
          return { ok: true, value: { ...completed.value, approvalStrategy } };
        } catch (error) {
          if (isSwapWithApprovalError(error)) return { ok: false, error };
          return { ok: false, error: unknownFailed('swap', error, baseCtx) };
        }
      },
      {
        start: () => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcAddress: params.srcAddress,
          dstAddress: params.dstAddress,
        }),
        success: value => ({
          srcChainKey,
          dstChainKey: params.dstChainKey,
          srcTxHash: value.intentDeliveryInfo.srcTxHash,
          dstTxHash: value.intentDeliveryInfo.dstTxHash,
          approvalStrategy: value.approvalStrategy,
        }),
        failure: error => ({ code: error.code }),
      },
    );
  }

  private async createIntentInAtomicBatch<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
  ): Promise<Result<CreateIntentResult<K, false>, SwapWithApprovalError>> {
    const { params, walletProvider, extras, skipSimulation } = _params;
    const srcChainKey = params.srcChainKey;
    swapInvariant(
      isEvmSpokeOnlyChainKeyType(srcChainKey) && isEvmWalletProviderType(walletProvider),
      'Atomic batches need an EVM spoke source and an EVM wallet provider',
    );
    swapInvariant(canSendAtomicBatch(walletProvider), 'Wallet provider does not implement EIP-5792 batches');
    const ctx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'swapWithApproval',
      approvalStrategy: 'atomic-batch',
    };

    const [approval, created] = await Promise.all([
      this.buildApproveTxs<K>({ params, raw: true }),
      this.createIntent<K, true>({ params, extras, skipSimulation, raw: true }),
    ]);
    if (!approval.ok) {
      return {
        ok: false,
        error: isSwapWithApprovalError(approval.error)
          ? withErrorContext(approval.error, ctx)
          : approveFailed('swap', approval.error, ctx),
      };
    }
    if (!created.ok) return created;

    // An EVM spoke source makes every unsigned leg an EvmRawTransaction.
    const { resetTx, approveTx } = approval.value as ApprovalTxs<EvmSpokeOnlyChainKey>;
    const depositTx = created.value.tx as EvmRawTransaction;
    const txs = resetTx ? [resetTx, approveTx, depositTx] : [approveTx, depositTx];
    const sent = await sendApprovalBatch({
      walletProvider,
      srcChainKey,
      txs,
      timeoutMs: approvalBatchWaitMs(_params.timeout),
      feature: 'swap',
      context: ctx,
    });
    if (!sent.ok) return sent;
    return {
      ok: true,
      value: {
        tx: sent.value.txHash satisfies TxReturnType<EvmSpokeOnlyChainKey, false> as TxReturnType<K, false>,
        intent: created.value.intent,
        relayData: created.value.relayData,
      },
    };
  }

  /** Sends nothing: re-waits the batch, relays client-side, and reads the lost intent back from the hub tx. */
  private async resumeAtomicBatch<K extends SpokeChainKey>(
    _params: SwapWithApprovalParams<K>,
    batchId: string,
  ): Promise<Result<SwapWithApprovalResponse, SwapWithApprovalError>> {
    const { params, walletProvider } = _params;
    const srcChainKey = params.srcChainKey;
    swapInvariant(
      isEvmSpokeOnlyChainKeyType(srcChainKey) &&
        isEvmWalletProviderType(walletProvider) &&
        canSendAtomicBatch(walletProvider),
      'Resuming an atomic batch needs an EVM spoke source and an EIP-5792 wallet provider',
    );
    const ctx = {
      srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'swapWithApproval',
      approvalStrategy: 'atomic-batch',
    };
    const timeoutMs = approvalBatchWaitMs(_params.timeout);

    const deposit = await confirmApprovalBatch({
      walletProvider,
      batchId,
      callCount: _params.resumeBatchCallCount,
      timeoutMs,
      feature: 'swap',
      context: ctx,
    });
    if (!deposit.ok) return deposit;
    const srcTxHash = deposit.value.txHash;
    const txCtx = { ...ctx, srcTxHash };

    // An EVM spoke tx is relayed by its hash alone, so the lost `relayData` is not needed.
    const packet = await relayTxAndWaitPacket({
      srcTxHash,
      chainKey: srcChainKey,
      relayerApiEndpoint: this.relayerApiEndpoint,
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
    });
    if (!packet.ok) return { ok: false, error: mapRelayFailure(packet.error, { feature: 'swap', ...txCtx }) };
    const dstTxHash = packet.value.dst_tx_hash as Hash;

    const intent = await this.getIntent(dstTxHash);
    if (!intent.ok) return { ok: false, error: unknownFailed('swap', intent.error, txCtx) };
    const solved = await this.postExecution({ intent_tx_hash: dstTxHash });
    if (!solved.ok) return { ok: false, error: withErrorContext(solved.error, { srcChainKey, srcTxHash, dstTxHash }) };

    return {
      ok: true,
      value: {
        solverExecutionResponse: solved.value,
        intent: intent.value,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash,
          srcAddress: params.srcAddress,
          dstChainKey: params.dstChainKey,
          dstTxHash,
          dstAddress: params.dstAddress,
        } satisfies IntentDeliveryInfo,
        approvalStrategy: 'atomic-batch',
      },
    };
  }

  private async approveThenCreateIntent<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    validated = false,
  ): Promise<Result<CreateIntentResult<K, false>, SwapWithApprovalError>> {
    const { params, extras, skipSimulation } = _params;
    const ctx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'swapWithApproval',
      approvalStrategy: 'sequential',
    };

    // Build the intent unsigned first, so params that can never become a swap fail before the user pays for an approval.
    if (!validated) {
      const preflight = await this.createIntent<K, true>({ params, extras, skipSimulation, raw: true });
      if (!preflight.ok) return preflight;
    }

    const approved = await this.approve(_params);
    if (!approved.ok) {
      return {
        ok: false,
        error: isSwapWithApprovalError(approved.error)
          ? withErrorContext(approved.error, ctx)
          : approveFailed('swap', approved.error, ctx),
      };
    }

    const confirmed = await confirmApproval({
      waitForTxReceipt: receiptParams => this.spoke.waitForTxReceipt(receiptParams),
      txHash: approved.value,
      chainKey: params.srcChainKey,
      feature: 'swap',
      context: ctx,
    });
    if (!confirmed.ok) return confirmed;

    return this.createIntent(_params);
  }

  private async completeSwap<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    created: CreateIntentResult<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    // Per-attempt budget: a shared deadline would leave the fallback relay only the backend's leftovers.
    const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

    // Fallback on any non-success is safe: re-relay / re-post are idempotent.
    // The backend only relays through the intent relay, so an MPC-relay source settles client-side.
    if (this.useBackendSubmitTx && !isMpcRelayChainKey(_params.params.srcChainKey)) {
      const submitted = await this.submitTx(_params, created, createSubmitTxAttempt(timeoutMs));
      if (submitted.ok) return submitted;
      this.config.logger.warn('[swap] backend submit-tx did not complete; falling back to the client-side relay', {
        error: submitted.error,
      });
    }

    return this.fallbackSwapSteps(_params, created, timeoutMs);
  }

  /** Client-side completion. Verification lives only here: the backend verifies itself, and pre-verifying would delay it. */
  private async fallbackSwapSteps<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    created: CreateIntentResult<K, false>,
    timeoutMs: number,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const { tx: spokeTxHash, intent, relayData } = created;
    // Every failure from here on is post-broadcast: carry the tx so the caller can keep reading its status.
    const txCtx = { srcChainKey, dstChainKey: params.dstChainKey, action: 'swap', srcTxHash: spokeTxHash };

    let dstIntentTxHash: string;
    if (isHubChainKeyType(srcChainKey)) {
      const verifyTxHashResult = await this.spoke.verifyTxHash({ txHash: created.tx, chainKey: srcChainKey });
      if (!verifyTxHashResult.ok) {
        return { ok: false, error: verifyFailed('swap', verifyTxHashResult.error, txCtx) };
      }
      dstIntentTxHash = spokeTxHash;
    } else {
      const settled = await this.spoke.settle({
        chainKey: srcChainKey,
        tx: spokeTxHash,
        direction: 'inbound',
        relayData,
        // Full budget starting after verification; the floor keeps a tiny `timeout` from stranding a landed tx unrelayed.
        timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
      });
      if (!settled.ok) {
        return {
          ok: false,
          error:
            settled.error.phase === 'verification'
              ? verifyFailed('swap', settled.error.cause, txCtx)
              : mapRelayFailure(settled.error.cause, { feature: 'swap', ...txCtx }),
        };
      }
      dstIntentTxHash = settled.value.dstChainTxHash;
    }

    if (isMpcRelayChainKey(srcChainKey) && !isHex(dstIntentTxHash)) {
      return {
        ok: false,
        error: mapRelayFailure(new Error('MPC relay returned an invalid hub mint hash'), {
          feature: 'swap',
          ...txCtx,
        }),
      };
    }

    const postExecResult = await this.postExecution({
      intent_tx_hash: dstIntentTxHash as `0x${string}`,
    });
    if (!postExecResult.ok) {
      // The hub tx is what a retried `postExecution` needs.
      return {
        ok: false,
        error: withErrorContext(postExecResult.error, {
          srcChainKey,
          srcTxHash: spokeTxHash,
          dstTxHash: dstIntentTxHash,
        }),
      };
    }

    return {
      ok: true,
      value: {
        solverExecutionResponse: postExecResult.value,
        intent,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash: spokeTxHash,
          srcAddress: params.srcAddress,
          dstChainKey: params.dstChainKey,
          dstTxHash: dstIntentTxHash,
          dstAddress: params.dstAddress,
        } satisfies IntentDeliveryInfo,
      },
    };
  }

  /**
   * Backend submit-tx attempt; never throws. The backend keeps processing after this gives up, so the
   * fallback relay can race it — safe because relay and solver dedup (see `e2e-tests/e2e-relay.test.ts`).
   */
  private async submitTx<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    created: CreateIntentResult<K, false>,
    attempt: SubmitTxAttempt,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { params } = _params;
    const srcChainKey = params.srcChainKey;
    const baseCtx = { srcChainKey, dstChainKey: params.dstChainKey };
    const { tx: spokeTxHash, intent, relayData } = created;
    try {
      const outcome = await runBackendSubmitTx({
        attempt,
        api: this.backendApi.swaps,
        // The configured key is already in the SwapsApiService headers; only the per-action override travels here.
        overrideConfig: { apiKey: _params.extras?.apiKey },
        body: {
          txHash: spokeTxHash,
          srcChainKey,
          walletAddress: params.srcAddress,
          intent,
          relayData: relayData.payload,
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        terminalStatus: 'solved',
        onExecuted: (result): SwapResponse | undefined =>
          result?.dstIntentTxHash && result.intent_hash
            ? {
                solverExecutionResponse: { answer: 'OK', intent_hash: result.intent_hash as Hex },
                intent,
                intentDeliveryInfo: {
                  srcChainKey,
                  srcTxHash: spokeTxHash,
                  srcAddress: params.srcAddress,
                  dstChainKey: params.dstChainKey,
                  dstTxHash: result.dstIntentTxHash,
                  dstAddress: params.dstAddress,
                } satisfies IntentDeliveryInfo,
              }
            : undefined,
      });
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('swap', outcome.cause, { ...baseCtx, action: 'swap' }) };
    } catch (error) {
      return { ok: false, error: unknownFailed('swap', error, { ...baseCtx, action: 'swap' }) };
    }
  }

  /** EVM: ERC-20 allowance; Stellar: trustline; other chains have no allowance concept and return `true`. */
  public async isAllowanceValid<K extends SpokeChainKey>(
    _params: SwapActionParams<K, boolean>,
  ): Promise<Result<boolean>> {
    try {
      const { params } = _params;
      const srcChainKey = params.srcChainKey;

      if (isHubChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: intentDepositSpender(this.config, srcChainKey),
        } satisfies SpokeIsAllowanceValidParamsHub);
      }

      if (isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: intentDepositSpender(this.config, srcChainKey),
        } satisfies SpokeIsAllowanceValidParamsEvmSpoke);
      }

      if (isStellarChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
        } satisfies SpokeIsAllowanceValidParamsStellar);
      }

      return { ok: true, value: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Raw mode returns one tx and cannot express a USDT-style reset + approve; use {@link buildApproveTxs}.
   * Signed mode may send two txs (user signs twice); the returned hash is the last one's.
   */
  public async approve<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;
    const wrapApproveFailure = (cause: unknown) => approveFailed('swap', cause);

    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        invariant(
          isOptionalEvmWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Evm wallet provider.',
        );
        const spender = intentDepositSpender(this.config, params.srcChainKey);
        const coreParams = {
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.inputAmount,
          spender,
        } as const;

        const result = await this.spoke.approve<HubChainKey | EvmSpokeOnlyChainKey, Raw>({
          ...coreParams,
          raw: _params.raw,
          walletProvider: _params.walletProvider,
        });

        if (!result.ok) {
          return { ok: false, error: wrapApproveFailure(result.error) };
        }

        return {
          ok: true,
          value: result.value satisfies TxReturnType<EvmSpokeOnlyChainKey, Raw> as TxReturnType<K, Raw>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        invariant(
          isOptionalStellarWalletProviderType(_params.walletProvider),
          'Invalid wallet provider. Expected Stellar wallet provider.',
        );
        const coreParams = {
          srcChainKey: params.srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
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

      return {
        ok: false,
        error: new Error('Approve only supported for hub (Sonic), EVM spokes, and Stellar'),
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Unsigned approval txs in broadcast order; when `resetTx` is present it must be mined before `approveTx` is valid. */
  public async buildApproveTxs<K extends SpokeChainKey>(
    _params: SwapActionParams<K, true>,
  ): Promise<Result<ApprovalTxs<K>>> {
    const { params } = _params;
    const wrapApproveFailure = (cause: unknown) => approveFailed('swap', cause);

    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        const spender = intentDepositSpender(this.config, params.srcChainKey);

        const result = await this.spoke.buildApproveTxs<HubChainKey | EvmSpokeOnlyChainKey>({
          srcChainKey: params.srcChainKey,
          owner: params.srcAddress as GetAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          token: params.inputToken as GetTokenAddressType<HubChainKey | EvmSpokeOnlyChainKey>,
          amount: params.inputAmount,
          spender,
          raw: true,
        });

        if (!result.ok) {
          return { ok: false, error: wrapApproveFailure(result.error) };
        }

        return {
          ok: true,
          value: result.value satisfies ApprovalTxs<HubChainKey | EvmSpokeOnlyChainKey> as ApprovalTxs<K>,
        };
      }

      if (isStellarChainKeyType(params.srcChainKey)) {
        const result = await this.spoke.buildApproveTxs<StellarChainKey>({
          srcChainKey: params.srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress as GetAddressType<StellarChainKey>,
          raw: true,
        });

        if (!result.ok) {
          return { ok: false, error: wrapApproveFailure(result.error) };
        }

        return {
          ok: true,
          value: result.value satisfies ApprovalTxs<StellarChainKey> as ApprovalTxs<K>,
        };
      }

      return {
        ok: false,
        error: new Error('Approve only supported for hub (Sonic), EVM spokes, and Stellar'),
      };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Creates the intent on the source chain without relaying or notifying the solver (use `swap()` for end-to-end). */
  public async createIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>> {
    const { params, skipSimulation, extras } = _params;
    const partnerFee = extras?.partnerFee ?? this.partnerFee;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };

    try {
      swapInvariant(
        isUndefinedOrValidWalletProviderForChainKey(params.srcChainKey, _params.walletProvider),
        `Invalid wallet provider for chain key: ${params.srcChainKey}`,
        baseCtx,
      );
      swapInvariant(
        this.config.isValidOriginalAssetAddress(params.srcChainKey, params.inputToken),
        `Unsupported spoke chain token (srcChainKey): ${params.srcChainKey}, params.inputToken): ${params.inputToken}`,
        { ...baseCtx, field: 'inputToken' },
      );
      swapInvariant(
        this.config.isValidOriginalAssetAddress(params.dstChainKey, params.outputToken),
        `Unsupported spoke chain token (params.dstChain): ${params.dstChainKey}, params.outputToken): ${params.outputToken}`,
        { ...baseCtx, field: 'outputToken' },
      );
      swapInvariant(
        this.config.isValidSpokeChainKey(params.srcChainKey),
        `Invalid spoke chain (srcChainKey): ${params.srcChainKey}`,
        { ...baseCtx, field: 'srcChainKey' },
      );
      swapInvariant(
        this.config.isValidSpokeChainKey(params.dstChainKey),
        `Invalid spoke chain (params.dstChain): ${params.dstChainKey}`,
        { ...baseCtx, field: 'dstChainKey' },
      );
      // Native BTC (address '0:0', in sats) must clear the dust limit on both source and destination;
      // resolve to token descriptors rather than comparing the address against 'BTC'.
      const inputTokenInfo = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.inputToken);
      if (isNativeBitcoinTransfer(this.config, params.srcChainKey, inputTokenInfo)) {
        swapInvariant(
          params.inputAmount >= BITCOIN_DUST_SATS,
          `Invalid inputAmount (${params.inputAmount}): below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'inputAmount' },
        );
      }
      const outputTokenInfo = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.outputToken);
      if (isNativeBitcoinTransfer(this.config, params.dstChainKey, outputTokenInfo)) {
        swapInvariant(
          params.minOutputAmount >= BITCOIN_DUST_SATS,
          `Invalid minOutputAmount (${params.minOutputAmount}): below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'minOutputAmount' },
        );
      }
      assertProductionSwapRoute(this.solver.solverApiEndpoint, params);
      assertMpcSwapRoute({ ...params, outputToken: outputTokenInfo });
      const refundAmount = params.inputAmount - calculateFeeAmount(params.inputAmount, partnerFee);
      if (inputTokenInfo) {
        assertMpcPayoutAboveMinimum({
          feature: 'swap',
          token: inputTokenInfo,
          amount: refundAmount,
          context: { ...baseCtx, field: 'inputAmount' },
        });
        await this.spoke.assertReleaseRecipientReady({
          feature: 'swap',
          chainKey: params.srcChainKey,
          recipient: encodeRecipient(params.srcChainKey, params.srcAddress),
          token: inputTokenInfo.address,
          // The deposit takes more off this line than a refund puts back, so it needs no room beyond today's.
          amount: 0n,
          context: { ...baseCtx, field: 'srcAddress' },
        });
      }
      if (outputTokenInfo) {
        if (
          isXrpChainKeyType(params.dstChainKey) &&
          outputTokenInfo.address !== this.config.getChainConfig(params.dstChainKey).nativeToken
        ) {
          const quote = await this.getQuote({
            token_src: params.inputToken,
            token_src_blockchain_id: params.srcChainKey,
            token_dst: params.outputToken,
            token_dst_blockchain_id: params.dstChainKey,
            amount: params.inputAmount,
            quote_type: 'exact_input',
            partnerFee,
          });
          swapInvariant(
            quote.ok && quote.value.quoted_amount > 0n,
            'A current exact-input quote is required for an XRPL issued-token destination',
            { ...baseCtx, field: 'minOutputAmount' },
          );
          swapInvariant(
            params.minOutputAmount * SOLVED_PAYOUT_HEADROOM_FACTOR >= quote.value.quoted_amount,
            'minOutputAmount must be at least half the current quote for an XRPL issued-token destination',
            { ...baseCtx, field: 'minOutputAmount' },
          );
        }
        await this.spoke.assertReleaseRecipientReady({
          feature: 'swap',
          chainKey: params.dstChainKey,
          recipient: encodeRecipient(params.dstChainKey, params.dstAddress),
          token: outputTokenInfo.address,
          amount: params.minOutputAmount,
          maxAmount: params.minOutputAmount * SOLVED_PAYOUT_HEADROOM_FACTOR,
          context: { ...baseCtx, field: 'dstAddress' },
        });
      }
      if (isStacksChainKeyType(params.srcChainKey) && _params.raw === true) {
        swapInvariant(
          extras?.srcPublicKey !== undefined,
          'srcPublicKey is required for Stacks createIntent (raw) — the source tx is built unsigned and needs the signer public key',
          { ...baseCtx, field: 'srcPublicKey' },
        );
      }

      const personalAddress = params.srcAddress;

      // Bitcoin TRADING mode: deposits originate from the trading wallet, so derive the hub wallet from it.
      let walletAddress: string = personalAddress;
      if (isBitcoinChainKeyType(params.srcChainKey)) {
        if (_params.raw === false) {
          // Non-raw needs a provider to sign; only TRADING mode needs Bound auth (USER is self-custody).
          swapInvariant(
            isBitcoinWalletProviderType(_params.walletProvider),
            `Invalid wallet provider for chain key: ${params.srcChainKey}`,
            baseCtx,
          );
          if (this.spoke.bitcoin.walletMode === 'TRADING') {
            await this.spoke.bitcoin.radfi.ensureRadfiAccessToken(_params.walletProvider);
          }
        }
        walletAddress = await this.spoke.bitcoin.getEffectiveWalletAddress(personalAddress);
      }

      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);

      if (isHubChainKeyType(params.srcChainKey) && isSonicChainKeyType(params.srcChainKey)) {
        const coreSonicParams = {
          createIntentParams: params,
          creatorHubWalletAddress,
          solverConfig: this.solver,
          fee: partnerFee,
          hubProvider: this.hubProvider,
        } as const;

        const [txResult, intent, feeAmount, data] = await SonicSpokeService.createSwapIntent(
          _params.raw
            ? { ...coreSonicParams, raw: true }
            : {
                ...coreSonicParams,
                raw: false,
                walletProvider: _params.walletProvider as GetWalletProviderType<SonicChainKey>,
              },
        );

        return {
          ok: true,
          value: {
            tx: txResult satisfies TxReturnType<SonicChainKey, boolean> as DepositReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: intent.creator, payload: data },
          },
        };
      }

      const [data, intent, feeAmount] = EvmSolverService.constructCreateIntentData(
        {
          ...params,
          srcAddress: walletAddress,
        },
        creatorHubWalletAddress,
        this.config,
        partnerFee,
      );

      const coreDepositParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: walletAddress as GetAddressType<K>,
        srcPublicKey: extras?.srcPublicKey,
        // Bitcoin Bound token; BitcoinSpokeService.deposit falls back to the RadfiProvider instance token when undefined.
        accessToken: extras?.bound?.accessToken,
        to: creatorHubWalletAddress,
        token: params.inputToken as GetTokenAddressType<K>,
        amount: params.inputAmount,
        data: data,
        skipSimulation,
      } as const;

      const txResult = await this.spoke.deposit(
        _params.raw
          ? {
              ...coreDepositParams,
              raw: true,
            }
          : {
              ...coreDepositParams,
              raw: false,
              walletProvider: _params.walletProvider as GetWalletProviderType<K>,
            },
      );

      if (!txResult.ok) {
        if (isSwapCreateIntentError(txResult.error)) {
          return { ok: false, error: txResult.error };
        }
        return {
          ok: false,
          error: intentCreationFailed('swap', txResult.error, baseCtx),
        };
      }

      return {
        ok: true,
        value: {
          tx: txResult.value satisfies DepositReturnType<K, Raw> as DepositReturnType<K, Raw>,
          intent: { ...intent, feeAmount } as Intent & FeeAmount,
          relayData: { address: intent.creator, payload: data },
        },
      };
    } catch (error) {
      if (isSwapCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('swap', error, baseCtx),
      };
    }
  }

  /** End-to-end swap with `deadline` forced to `0n`: no expiry until filled or cancelled. */
  public async createLimitOrder<K extends SpokeChainKey>(
    _params: LimitOrderActionParams<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { timeout, skipSimulation } = _params;
    const params: CreateIntentParams<K> = {
      ..._params.params,
      deadline: 0n,
    } as CreateIntentParams<K>;

    return this.swap<K>({
      ..._params,
      params,
      timeout,
      skipSimulation,
    });
  }

  public async createLimitOrderIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: LimitOrderActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>> {
    const limitOrderParams: CreateIntentParams<K> = {
      ..._params.params,
      deadline: 0n,
    } as const as CreateIntentParams<K>;

    return this.createIntent({
      ..._params,
      params: limitOrderParams,
    } as SwapActionParams<K, Raw>);
  }

  public async cancelLimitOrder<K extends SpokeChainKey>(
    params: CancelIntentActionParams<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.cancelIntent(params);
  }

  /** Builds/broadcasts the cancel tx only; `cancelIntent` also relays and waits for the hub. */
  public async createCancelIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: CancelIntentActionParams<K, Raw>,
  ): Promise<Result<TxReturnType<K, Raw>>> {
    const { params } = _params;

    try {
      invariant(
        this.config.isValidIntentRelayChainId(params.intent.srcChain),
        `Invalid intent.srcChain: ${params.intent.srcChain}`,
      );
      invariant(
        this.config.isValidIntentRelayChainId(params.intent.dstChain),
        `Invalid intent.dstChain: ${params.intent.dstChain}`,
      );
      invariant(
        getIntentRelayChainId(params.srcChainKey) === params.intent.srcChain,
        `srcChainKey (${params.srcChainKey}) does not match intent.srcChain (${params.intent.srcChain}). Expected relay chain id ${getIntentRelayChainId(params.srcChainKey)}.`,
      );
      // `cancelIntent` confirms the cancel through the intent relay, which an MPC-relay chain does not use.
      swapInvariant(
        !isMpcRelayChainKey(params.srcChainKey),
        `Cancelling an intent from an MPC-relay source chain (${params.srcChainKey}) is not supported yet`,
        { srcChainKey: params.srcChainKey, field: 'srcChainKey' },
      );

      const relayData = this.buildCancelRelayData(params.intent);

      const coreParams = {
        srcChainKey: params.srcChainKey,
        srcAddress: await this.resolveCancelSrcAddress(_params),
        dstChainKey: HUB_CHAIN_KEY,
        dstAddress: relayData.address,
        payload: relayData.payload,
        skipSimulation: params.skipSimulation,
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

      if (!txResult.ok) return { ok: false, error: intentCreationFailed('swap', txResult.error) };

      return {
        ok: true,
        value: txResult.value satisfies SendMessageReturnType<K, boolean> as TxReturnType<K, Raw>,
      };
    } catch (error) {
      if (isSwapCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('swap', error) };
    }
  }

  /** For Bitcoin, `srcChainTxHash` is the relay's derived `od:<hash>` id (on-demand cancels broadcast no spoke tx). */
  public async cancelIntent<K extends SpokeChainKey>(
    _params: CancelIntentActionParams<K, false>,
  ): Promise<Result<TxHashPair>> {
    const { params } = _params;
    try {
      const cancelResult = await this.createCancelIntent<K, false>(_params);
      if (!cancelResult.ok) return cancelResult;

      const cancelTxHash = cancelResult.value;

      const verifyTxHashResult = await this.spoke.verifyTxHash({
        txHash: cancelTxHash,
        chainKey: params.srcChainKey,
      });
      if (!verifyTxHashResult.ok) return verifyTxHashResult;

      if (isHubChainKey(params.srcChainKey)) {
        return { ok: true, value: { srcChainTxHash: cancelTxHash, dstChainTxHash: cancelTxHash } };
      }

      const relayIdentity = this.buildCancelRelayIdentity(params.srcChainKey, cancelTxHash, params.intent);
      const packet = await relayTxAndWaitPacket({
        ...relayIdentity,
        chainKey: params.srcChainKey,
        relayerApiEndpoint: this.relayerApiEndpoint,
        timeout: _params.timeout,
      });
      if (!packet.ok) return packet;

      return {
        ok: true,
        value: {
          srcChainTxHash: relayIdentity.pollTxHash ?? cancelTxHash,
          dstChainTxHash: packet.value.dst_tx_hash,
        },
      };
    } catch (error) {
      if (isSwapError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('swap', error, { action: 'cancelIntent' }) };
    }
  }

  /**
   * Bitcoin TRADING intents store the trading address, but the spoke layer needs the personal wallet to
   * re-derive it and pick the signing scheme; every other chain uses the intent's address.
   */
  private async resolveCancelSrcAddress<K extends SpokeChainKey, Raw extends boolean>(
    _params: CancelIntentActionParams<K, Raw>,
  ): Promise<GetAddressType<K>> {
    const { params } = _params;
    if (params.srcAddress !== undefined) return params.srcAddress;

    if (isBitcoinChainKeyType(params.srcChainKey) && this.spoke.bitcoin.walletMode === 'TRADING') {
      const walletProvider = _params.walletProvider;
      invariant(
        walletProvider !== undefined && isBitcoinWalletProviderType(walletProvider),
        'Bitcoin TRADING-mode cancel needs the personal wallet address: pass params.srcAddress for raw: true',
      );
      return (await walletProvider.getWalletAddress()) as GetAddressType<K>;
    }

    return reverseEncodeAddress(params.srcChainKey, params.intent.srcAddress) as GetAddressType<K>;
  }

  /**
   * For self-relayed cancels: Solana commits only the payload hash on-chain, so the relayer needs it.
   * Bitcoin cancels are on-demand instead (`BitcoinSpokeService.getOnDemandRelayIdentity`).
   */
  public getCancelIntentRelayData(intent: Intent): Result<RelayExtraData> {
    try {
      invariant(this.config.isValidIntentRelayChainId(intent.srcChain), `Invalid intent.srcChain: ${intent.srcChain}`);
      return { ok: true, value: this.buildCancelRelayData(intent) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  private buildCancelRelayData(intent: Intent): RelayExtraData {
    return {
      address: intent.creator,
      payload: encodeContractCalls([EvmSolverService.encodeCancelIntent(intent, this.solver.intentsContract)]),
    };
  }

  /** Bitcoin cancels broadcast no spoke tx: relayed under `withdraw` and tracked under a derived `od:<hash>` id. */
  private buildCancelRelayIdentity(srcChainKey: SpokeChainKey, tx: string, intent: Intent) {
    return isBitcoinChainKeyType(srcChainKey)
      ? this.spoke.bitcoin.getOnDemandRelayIdentity(tx)
      : { srcTxHash: tx, data: this.buildCancelRelayData(intent), pollTxHash: undefined };
  }

  /** Relay extra data for Solana/Bitcoin sources, whose deposits commit only a hash of the payload; see {@link reconstructRelayData}. */
  public async getIntentSubmitTxExtraData(params: GetIntentSubmitTxExtraDataParams): Promise<Result<RelayExtraData>> {
    if ('txHash' in params) {
      const intentResult = await this.getIntent(params.txHash);
      if (!intentResult.ok) return intentResult;
      return this.reconstructRelayData(intentResult.value);
    }
    return this.reconstructRelayData(params.intent);
  }

  /**
   * Byte-identical relay data from the intent alone (`intentId` is the only random field). Cannot reconstruct a
   * leverage-yield `hubWalletSwap` intent (hub src, spoke payload); use `sodax.api.leverageYield.getIntentSubmitTxExtraData`.
   */
  public reconstructRelayData(intent: Intent): Result<RelayExtraData> {
    try {
      invariant(this.config.isValidIntentRelayChainId(intent.srcChain), `Invalid intent.srcChain: ${intent.srcChain}`);
      invariant(this.config.isValidIntentRelayChainId(intent.dstChain), `Invalid intent.dstChain: ${intent.dstChain}`);

      const isHubSource = intent.srcChain === getIntentRelayChainId(HUB_CHAIN_KEY);
      const payload = EvmSolverService.reconstructCreateIntentData(intent, this.solver.intentsContract, isHubSource);

      return { ok: true, value: { address: intent.creator, payload } };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Reads the `IntentCreated` event from a hub tx receipt. */
  public async getIntent(txHash: Hash): Promise<Result<Intent>> {
    try {
      const value = await EvmSolverService.getIntent(txHash, this.config, this.hubProvider.publicClient);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Reads the `IntentFilled` event from the hub fill tx receipt. */
  public async getFilledIntent(txHash: Hash): Promise<Result<IntentState>> {
    try {
      const value = await EvmSolverService.getFilledIntent(txHash, this.solver, this.hubProvider.publicClient);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Destination delivery packet for a solver fill (a fill emits several packets; this picks the user-facing one).
   * Fails for MPC-relay destinations, which have no packet: use {@link waitForIntentDelivery}.
   */
  public async getSolvedIntentPacket({
    chainId,
    fillTxHash,
    timeout = DEFAULT_RELAY_TX_TIMEOUT,
  }: {
    chainId: SpokeChainKey;
    fillTxHash: string;
    timeout?: number;
  }): Promise<Result<PacketData>> {
    if (isMpcRelayChainKey(chainId)) {
      return {
        ok: false,
        error: new Error(
          `[getSolvedIntentPacket] ${chainId} is paid by an MPC relay release, which has no packet: use waitForIntentDelivery`,
        ),
      };
    }

    return waitUntilIntentExecuted({
      intentRelayChainId: getIntentRelayChainId(chainId).toString(),
      srcTxHash: fillTxHash,
      timeout,
      apiUrl: this.relayerApiEndpoint,
      selectPacket: packets => selectSolvedIntentPacket(packets, this.solver.intentsContract),
    });
  }

  /**
   * Waits for a solved intent's payout: relay packet, or (MPC-relay dst) submits and awaits the hub release,
   * or (hub dst) confirms the fill tx. MPC-relay waits at least its settlement floor regardless of `timeout`.
   */
  public async waitForIntentDelivery({
    chainId,
    fillTxHash,
    timeout = DEFAULT_RELAY_TX_TIMEOUT,
  }: {
    chainId: SpokeChainKey;
    fillTxHash: string;
    timeout?: number;
  }): Promise<Result<IntentDelivery>> {
    if (isHubChainKey(chainId)) {
      const receipt = await this.spoke.waitForTxReceipt({
        chainKey: chainId,
        txHash: fillTxHash,
        maxTimeoutMs: timeout,
      });
      if (!receipt.ok) return receipt;
      if (receipt.value.status !== 'success') return { ok: false, error: receipt.value.error };
      return { ok: true, value: { source: 'hub', dstTxHash: fillTxHash } };
    }
    if (isMpcRelayChainKeyType(chainId)) {
      const release = await this.spoke.submitHubRelease({ hubTxHash: fillTxHash, dstChainKey: chainId });
      if (!release.ok) return { ok: false, error: release.error.cause };
      const released = await this.spoke.waitForHubRelease({ release: release.value, timeout });
      if (!released.ok) return { ok: false, error: released.error.cause };
      return {
        ok: true,
        value: { source: 'mpcRelay', dstTxHash: released.value.dstChainTxHash, release: release.value },
      };
    }

    const packet = await this.getSolvedIntentPacket({ chainId, fillTxHash, timeout });
    if (!packet.ok) return packet;
    return { ok: true, value: { source: 'relay', dstTxHash: packet.value.dst_tx_hash, packet: packet.value } };
  }

  /** keccak256 of the ABI-encoded intent: its unique ID on the hub. */
  public getIntentHash(intent: Intent): Hex {
    return EvmSolverService.getIntentHash(intent);
  }

  /** Latest hub block timestamp + `deadline` seconds (must be > 0; use `0n` directly for no expiry). */
  public async getSwapDeadline(deadline: bigint = DEFAULT_DEADLINE_OFFSET): Promise<Result<bigint>> {
    try {
      invariant(deadline > 0n, 'Deadline must be greater than 0');

      const block = await this.hubProvider.publicClient.getBlock({
        includeTransactions: false,
        blockTag: 'latest',
      });
      return { ok: true, value: block.timestamp + deadline };
    } catch (error) {
      return { ok: false, error };
    }
  }

  public getSupportedSwapTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.config.getSupportedSwapTokensByChainId(chainId);
  }

  public getSupportedSwapTokens(): Record<SpokeChainKey, readonly XToken[]> {
    return this.config.getSupportedSwapTokens();
  }

  /** Offline estimate; RWA vaults never count as sodaAssets. See {@link estimateSwapSpeedTier}. */
  public getSwapSpeedTier(params: SwapSpeedTierParams): SwapSpeedTierResult {
    return estimateSwapSpeedTier(
      params,
      vault =>
        this.config.isMoneyMarketReserveAsset(vault) && !isRealWorldAsset({ chainKey: HUB_CHAIN_KEY, address: vault }),
    );
  }
}
