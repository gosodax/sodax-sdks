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
  getEvmViemChain,
  type RelayExtraData,
  type TxHashPair,
  isStacksChainKeyType,
  isNativeBitcoinTransfer,
  RELAY_FALLBACK_FLOOR_MS,
} from '../shared/index.js';
import { resolveDeliveredPacket } from '../backendApi/detailedStatusRouting.js';
import { SolverApiService } from './SolverApiService.js';
import { EvmSolverService } from './EvmSolverService.js';
import type { BackendApiService } from '../backendApi/index.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
import { createSubmitTxAttempt, type SubmitTxAttempt } from '../backendApi/submitTxAttempt.js';
import { isFillEvent } from '../backendApi/guards.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';
import {
  canSendAtomicBatch,
  isAccountUpgradeDeclined,
  isAtomicBatchRefused,
  readAtomicBatchSupport,
  type AtomicBatchEvmWalletProvider,
} from '../shared/utils/evmAtomicBatch.js';
import type { ApprovalTxs } from '../shared/types/spoke-types.js';
import { selectSolvedIntentPacket } from './selectSolvedIntentPacket.js';
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
  type ApprovalStrategyError,
  isSwapCreateIntentError,
  isPostExecutionError,
  isSwapError,
  isSwapWithApprovalError,
  swapInvariant,
  ACCOUNT_UPGRADE_DECLINED,
  ATOMIC_BATCH_UNCONFIRMED,
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
} from '@sodax/types';

export type GetIntentSubmitTxExtraDataParams = { txHash: Hash } | { intent: Intent };

export type SwapResponse = {
  solverExecutionResponse: SolverExecutionResponse;
  intent: Intent;
  intentDeliveryInfo: IntentDeliveryInfo;
};

/**
 * How {@link SwapService.swapWithApproval} gets the source token approved:
 * - `'not-required'` — allowance already sufficient (or none needed, e.g. a native token): one transaction.
 * - `'atomic-batch'` — approve and the swap transaction go out as one EIP-5792 batch: one signature.
 * - `'sequential'` — approve first, wait for it to confirm, then the swap transaction: two signatures, or
 *   three when the token must reset a stale allowance first.
 */
export type SwapApprovalStrategy = 'not-required' | 'atomic-batch' | 'sequential';

export type SwapWithApprovalResponse = SwapResponse & { approvalStrategy: SwapApprovalStrategy };

/** Params for `swapWithApproval` / `getApprovalStrategy`: `swap()`'s, plus the account-upgrade choice. */
export type SwapWithApprovalParams<K extends SpokeChainKey> = SwapActionParams<K, false> & {
  /**
   * Whether a wallet that must first upgrade the account to batch (EIP-5792 `'ready'`, e.g. a MetaMask
   * EOA becoming a smart account) may be asked to. `false` approves separately instead. Defaults to `true`.
   */
  allowAccountUpgrade?: boolean;
  /**
   * `swapWithApproval` only: the `context.batchId` of an {@link ATOMIC_BATCH_UNCONFIRMED} error from an
   * earlier call with the same `params` and wallet. Waits for that batch again instead of sending
   * anything and, once its deposit confirms, completes the swap through the client-side relay.
   */
  resumeBatchId?: string;
  /**
   * With `resumeBatchId`: that error's `context.callCount`. Without it, a batch the wallet confirmed as one
   * transaction per call cannot be matched to its deposit and stays unconfirmed.
   */
  resumeBatchCallCount?: number;
};

export type CreateIntentResult<K extends SpokeChainKey, Raw extends boolean> = {
  tx: TxReturnType<K, Raw>;
  intent: Intent & FeeAmount;
  relayData: RelayExtraData;
};

// Exec-mode params: walletProvider is required and K-narrowed. Consumed by `createIntent`,
// `createLimitOrder`, `createLimitOrderIntent`, `approve` — methods that send a transaction
// and return an executed tx hash.
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

/**
 * Params for `cancelIntent`.
 * Because `Intent.srcChain` is an `IntentRelayChainId` (bigint) whose literal type cannot
 * narrow to a specific ChainKey, the user passes `srcChainKey: K` explicitly. At runtime we
 * assert that `getIntentRelayChainId(srcChainKey) === intent.srcChain` and throw if not.
 */
export type CancelIntentParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  intent: Intent;
  /**
   * Source-chain wallet the cancel message is sent from. Defaults to the intent's `srcAddress`.
   * Bitcoin TRADING mode stores the trading address on the intent while the cancel must originate
   * from the personal wallet: signed cancels read it from `walletProvider`, raw cancels must pass it.
   */
  srcAddress?: GetAddressType<K>;
  skipSimulation?: boolean;
  timeout?: number;
};

export type CancelIntentActionParams<K extends SpokeChainKey, Raw extends boolean = false> = SpokeExecActionParams<
  K,
  Raw,
  CancelIntentParams<K>
>;

// Non-breaking superset of `SolverIntentQuoteRequest`: existing `getQuote(payload)` calls keep
// working unchanged. `partnerFee` is an optional per-call override (matches `extras.partnerFee` on
// createIntent/swap); it is stripped before the request is forwarded to the solver.
export type GetQuoteParams = SolverIntentQuoteRequest & {
  /** Optional per-call override of the configured swap partner fee. Falls back to config when omitted. */
  partnerFee?: PartnerFee;
};

export type SwapServiceConstructorParams = {
  config: ConfigService;
  spoke: SpokeService;
  hubProvider: HubProvider;
  backendApi: BackendApiService;
  /**
   * @deprecated Configure through `new Sodax({ swaps: { useBackendSubmitTx } })` ({@link SwapsOptions});
   * removed in v3. Still honored: when set, it wins over the configured value.
   */
  useBackendSubmitTx?: boolean;
};

/**
 * Ceiling for the durable-record lookup in {@link SwapService.getStatus}. A status read is polled on
 * a short interval, so its secondary lookup must not inherit the much longer default request budget.
 */
const RECONCILE_TIMEOUT_MS = 5_000;

/**
 * Budget for the solver status call behind {@link SwapService.getDetailedStatus}. Same reasoning as
 * {@link RECONCILE_TIMEOUT_MS}: a polled read must not inherit the 30s backend default.
 *
 * The relay leg does **not** share this value — it takes `RELAY_REQUEST_TIMEOUT_MS`, the relay
 * module's own per-request budget. One number for both reads was tempting, but 5s is a third of what
 * the relay path already tolerates for a single request, so it would abort reads that succeed today.
 * A budget that expires is untagged, which keeps the caller polling; a relay slower than the budget
 * would therefore never resolve and never surface an error. Better slow than silently stuck.
 *
 * Worst case for one `getDetailedStatus` call is the sum of its legs, not this number: the backend
 * record's own request budget, then 15s for the relay, then 5s here, plus a further
 * {@link RECONCILE_TIMEOUT_MS} for the durable-record reconcile a failed solver read falls through
 * to. That first leg is not a fixed 30s — `DEFAULT_BACKEND_API_TIMEOUT` is only its fallback, and a
 * consumer configuring `api.timeout` higher raises it, and the whole tick with it. So a poll-count
 * cutoff like dapp-kit's bounds attempts, not wall clock, and by a factor the consumer controls.
 */
const DETAILED_STATUS_SOLVER_TIMEOUT_MS = 5_000;

/** `context.reason` for a batch the wallet refused before anything was signed: safe to approve separately. */
const ATOMIC_BATCH_REFUSED = 'atomic-batch-refused';

/** EIP-5792 status codes that say nothing landed: 400 never included, 500 fully reverted. 600 may have partly landed. */
const BATCH_NOTHING_LANDED_CODES: ReadonlySet<number> = new Set([400, 500]);

/** Never below the default: a batch given up on early is one the user can only wait out. */
const batchWaitMs = (timeout: number | undefined): number =>
  Math.max(resolveTimeoutMs(timeout, DEFAULT_RELAY_TX_TIMEOUT), DEFAULT_RELAY_TX_TIMEOUT);

/**
 * Main entry point for the SODAX swap feature.
 *
 * Implements the intent-based solver architecture: the user creates a `SwapIntent` on their
 * source spoke chain, which is relayed to the Sonic hub where the solver picks it up and
 * delivers the output tokens on the destination chain.
 *
 * Responsibilities:
 * - Building and submitting swap/limit-order intents on any supported spoke chain
 * - Querying quotes and intent status from the solver API
 * - Approving token spend on behalf of the intent system
 * - Cancelling active intents (limit orders)
 * - Waiting for cross-chain relay delivery confirmations
 *
 * Consumers should access this service through the `Sodax` facade: `sodax.swaps`.
 */
export class SwapService {
  // dependent services
  readonly hubProvider: HubProvider;
  readonly config: ConfigService;
  readonly spoke: SpokeService;

  // swap config
  readonly solver: SolverConfig;
  readonly relayerApiEndpoint: HttpUrl;

  // backend swaps-API client
  readonly backendApi: BackendApiService;

  private readonly useBackendSubmitTxOverride: boolean | undefined;

  /**
   * Effective 2-step submit-tx flow (`swaps.useBackendSubmitTx`, default on). Read live off
   * `ConfigService`, like {@link SwapService.partnerFee}, so the config object and the behavior can
   * never disagree — unless a direct constructor caller passed the deprecated override.
   */
  get useBackendSubmitTx(): boolean {
    return this.useBackendSubmitTxOverride ?? this.config.swapUseBackendSubmitTx;
  }

  /**
   * Effective swap partner fee (`swaps.partnerFee`, else the global `fee`). Read live off
   * `ConfigService` rather than snapshotted in the constructor, so it cannot diverge from
   * `config.swapPartnerFee` if the config object is ever replaced (see `ConfigService.initialize`).
   * `BridgeService` and `LeverageYieldService` resolve their fees the same way.
   */
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

  /**
   * Estimates the gas cost for a raw (unsigned) transaction on a spoke chain.
   *
   * @param params - Chain key plus the raw transaction data to simulate.
   * @returns A `Result` wrapping the chain-specific gas estimate (`GetEstimateGasReturnType<C>`).
   */
  public async estimateGas<C extends SpokeChainKey>(
    params: EstimateGasParams<C>,
  ): Promise<Result<GetEstimateGasReturnType<C>>> {
    return this.spoke.estimateGas(params) as Promise<Result<GetEstimateGasReturnType<C>>>;
  }

  /**
   * Requests a price quote from the solver API for a given token pair and amount.
   *
   * Adjusts `payload.amount` by the partner fee before forwarding to the solver, so the returned
   * `quoted_amount` reflects the net output the user actually receives. Pass `partnerFee` to match
   * a per-action override supplied to `createIntent` (`extras.partnerFee`); omit it to use the
   * configured swap fee.
   *
   * @param payload - The solver quote request, optionally carrying a per-call `partnerFee` override
   *   (defaults to the configured swap partner fee). `partnerFee` is stripped before forwarding.
   * @returns A `Result` containing `{ quoted_amount: bigint }` on success, or a
   *   `SolverErrorResponse` (with a `SolverIntentErrorCode`) on failure.
   *
   * @example
   * const response = await swapService.getQuote({
   *   token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
   *   token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
   *   token_src_blockchain_id: '0x38.bsc',
   *   token_dst_blockchain_id: '0xa4b1.arbitrum',
   *   amount: 1000000000000000n,
   *   quote_type: 'exact_input',
   * });
   * if (response.ok) console.log('Quoted amount:', response.value.quoted_amount);
   */
  public async getQuote(payload: GetQuoteParams): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>> {
    const { partnerFee = this.partnerFee, ...request } = payload;
    const adjustedPayload = {
      ...request,
      amount: adjustAmountByFee(request.amount, partnerFee, request.quote_type),
    } satisfies SolverIntentQuoteRequest;
    return SolverApiService.getQuote(adjustedPayload, this.solver, this.config);
  }

  /**
   * Calculates the partner fee that will be deducted from the given input amount.
   *
   * Returns `0n` when no partner fee is configured on this service instance.
   *
   * @param inputAmount - Gross input token amount (in token's smallest unit).
   * @returns The fee amount denominated in the input token. `0n` if no fee is configured.
   */
  public getPartnerFee(inputAmount: bigint): bigint {
    if (!this.partnerFee) {
      return 0n;
    }

    return calculateFeeAmount(inputAmount, this.partnerFee);
  }

  /**
   * Calculates the fixed 0.1% solver protocol fee for a given input amount.
   *
   * @param inputAmount - Gross input token amount (in token's smallest unit).
   * @returns The solver fee amount denominated in the input token (10 basis points of `inputAmount`).
   */
  public getSolverFee(inputAmount: bigint): bigint {
    return calculatePercentageFeeAmount(inputAmount, 10);
  }

  /**
   * Polls the solver API for the current execution status of an intent. A `NOT_FOUND` or a failed
   * request is cross-checked against the backend's durable intent record.
   *
   * The `intent_tx_hash` in the request must be the hub-chain (Sonic) transaction hash where
   * the intent was registered — this is the `dst_tx_hash` from the relay packet returned by
   * `swap()` or `relayTxAndWaitPacket`.
   *
   * @param request - Object containing `intent_tx_hash` (the hub-chain tx hash).
   * @returns A `Result` containing `{ status: SolverIntentStatusCode, fill_tx_hash?: string }`.
   *   `fill_tx_hash` is populated only when `status === SolverIntentStatusCode.SOLVED (3)`.
   */
  public async getStatus(
    request: SolverIntentStatusRequest,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    return this.resolveSolverStatus(request);
  }

  /**
   * {@link SwapService.getStatus} with an optional budget for the solver leg. Public `getStatus` is a
   * one-shot read a caller bounds however it likes, so it stays unbounded; `getDetailedStatus` is
   * polled and passes {@link DETAILED_STATUS_SOLVER_TIMEOUT_MS}. Both go through here so the
   * durable-intent reconcile below is written once.
   *
   * `timeoutMs` bounds the solver request alone. The reconcile that a failed or NOT_FOUND solver read
   * falls through to carries its own {@link RECONCILE_TIMEOUT_MS}, so a bounded call can cost both.
   */
  private async resolveSolverStatus(
    request: SolverIntentStatusRequest,
    timeoutMs?: number,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    const solverResult = await SolverApiService.getStatus(
      request,
      this.solver,
      this.config.logger,
      timeoutMs,
      this.config.apiKey,
    );
    const forgotten = !solverResult.ok || solverResult.value.status === SolverIntentStatusCode.NOT_FOUND;
    if (!forgotten) return solverResult;

    // The solver keeps intent state in memory, so a restart makes it answer NOT_FOUND for intents it
    // already filled. The backend's record is durable; a read that *completes* without terminal fill
    // evidence leaves the solver's answer standing. A read that could not complete proves nothing —
    // see below.
    //
    // A fill event is not by itself proof of completion: an intent created with `allowPartialFill`
    // emits one per fill while input remains. Only a fill that consumed the remainder settles the
    // whole intent, so `SOLVED` is claimed for that one alone — otherwise a partially filled swap
    // would be reported complete, and `useStatus` would stop polling it for good.
    // Bound the reconcile so a status poll cannot hang on it — but clamp rather than override, since
    // a per-call timeout *replaces* the configured one and would otherwise lengthen the request for
    // a consumer who configured something stricter than this ceiling.
    const timeout = Math.min(RECONCILE_TIMEOUT_MS, this.backendApi.requestTimeoutMs);
    const intent = await this.backendApi.getIntentByTxHash(request.intent_tx_hash, { timeout });
    const settled = intent.ok
      ? intent.value.events.filter(isFillEvent).find(fill => fill.intentState.remainingInput === '0')
      : undefined;
    if (settled) return { ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: settled.txHash } };

    // Same reading as `getDetailedStatus`: a record — or a 404, which is the backend saying it has
    // none — answers the question, so the solver's NOT_FOUND stands and a caller may budget it. A
    // 5xx, a transport failure or an unusable body does not: the fill may exist and simply be
    // unreadable right now. Reporting NOT_FOUND there lets a poller spend a miss it never verified,
    // and `useStatus`/`useDetailedStatus` stop after 40 of them — on a swap that did complete.
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

    // Either the backend answered, or the solver's own error is the better diagnostic to return.
    return solverResult;
  }

  /**
   * Reads a swap's status from its source-chain transaction — the identifier a caller always holds.
   *
   * **Routes; does not translate.** Returns the backend submit-tx record while it is in play,
   * otherwise the solver's answer via the hub tx hash resolved from the relay packet. The result is
   * tagged with `source` (discriminate on it) and carries that source's payload unmodified.
   *
   * **Any** unusable backend response routes to the solver — a 404, a transport or server error, or
   * a record the backend gave up on. See `docs/SWAPS.md` § Get Detailed Status for why.
   *
   * A point-in-time read; poll it yourself, or use dapp-kit's `useDetailedStatus`.
   *
   * @param params - `srcChainKey` and `srcTxHash` of the source-chain swap transaction.
   * @returns A `Result` containing a {@link DetailedSwapStatus}. Fails with `LOOKUP_FAILED` when no
   *   source can answer yet — usually the relay has not delivered the packet, so there is no hub tx
   *   hash for the solver to be asked about.
   */
  public async getDetailedStatus(
    params: DetailedSwapStatusKey,
  ): Promise<Result<DetailedSwapStatus, DetailedStatusError>> {
    try {
      const record = await this.backendApi.swaps.getSubmitTxStatus({
        txHash: params.srcTxHash,
        srcChainKey: params.srcChainKey,
      });

      // `success: false` is the wire contract's "no record found", whatever `data` carries — `ok`
      // only proves the request and schema succeeded. Same guard the relay envelope gets below.
      if (record.ok && record.value.success && !isBackendSubmitTxAbandoned(record.value.data)) {
        return { ok: true, value: { source: 'backend', data: record.value.data } };
      }

      // A rejected key is not a source with nothing to say — it is a configuration problem only a
      // corrected key resolves. Routing it on would bury it behind a relay or solver error and leave
      // a poller retrying a request that cannot succeed, so it surfaces directly with its status
      // lifted for `isAuthFailure`. Same rule the bridge sibling applies.
      if (!record.ok && isSodaxError(record.error) && isAuthFailure(record.error)) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(record.error, params.srcChainKey, {
            status: record.error.context?.status,
          }),
        };
      }

      // Did the backend *answer*? A record — even `success: false`, even abandoned — and a 404 are
      // both definitive "nothing usable here". A 5xx or a transport failure is not: behind one we
      // cannot tell a swap that will never resolve from a live one whose record we simply could not
      // read. So a relay miss that follows an outage must stay an unbudgeted dependency failure,
      // or a backend outage would stop the caller polling a swap that is still progressing.
      const backendAnswered = record.ok || (isSodaxError(record.error) && record.error.context?.status === 404);

      const dstTxHash = await this.resolveHubTxHash(params, backendAnswered);
      if (!dstTxHash.ok) return dstTxHash;

      // `this.resolveSolverStatus`, not `SolverApiService.getStatus` — the durable-intent reconcile
      // on solver NOT_FOUND stays in one place. Bounded, because this read is polled.
      const solver = await this.resolveSolverStatus(
        { intent_tx_hash: dstTxHash.value },
        DETAILED_STATUS_SOLVER_TIMEOUT_MS,
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

  /**
   * The hub-chain tx hash the solver is keyed on. A hub-source swap has no relay leg — the source
   * tx *is* the hub tx. Otherwise the delivered relay packet carries it, so an undelivered packet
   * is simply "no hash yet".
   */
  private async resolveHubTxHash(
    key: DetailedSwapStatusKey,
    backendAnswered: boolean,
  ): Promise<Result<Hex, DetailedStatusError>> {
    let hubTxHash = key.srcTxHash;

    if (!isHubChainKeyType(key.srcChainKey)) {
      const delivered = await resolveDeliveredPacket({
        srcChainKey: key.srcChainKey,
        srcTxHash: key.srcTxHash,
        relayerApiEndpoint: this.relayerApiEndpoint,
        backendAnswered,
      });
      if (!delivered.ok) {
        return {
          ok: false,
          error: this.detailedStatusLookupFailed(delivered.cause, key.srcChainKey, {
            reason: delivered.budgetable ? DETAILED_STATUS_NOT_DELIVERED : undefined,
          }),
        };
      }
      hubTxHash = delivered.packet.dst_tx_hash;
    }

    // Validate rather than cast — this hash reaches the solver next.
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
   * `reason` is set only for {@link DETAILED_STATUS_NOT_DELIVERED} — the miss a caller can bound
   * with a retry budget. Leaving it off marks a dependency that is failing right now, which a
   * caller should keep retrying rather than give up on. `status` is lifted for a rejected key so
   * `isAuthFailure` recognises the wrapped error; it reads `context.status` and does not walk the
   * cause chain.
   */
  private detailedStatusLookupFailed(
    cause: unknown,
    srcChainKey: SpokeChainKey,
    extra?: { reason?: string; status?: number },
  ): DetailedStatusError {
    return lookupFailed('swap', 'getDetailedStatus', cause, { srcChainKey, action: 'swap', ...extra });
  }

  /**
   * Notifies the solver API that an intent has been registered on the hub chain, triggering
   * the solver to begin filling it.
   *
   * Called automatically by `swap()` after the cross-chain relay packet lands on the hub. You
   * only need to call this manually when orchestrating the swap steps yourself.
   *
   * @param request - Object containing `intent_tx_hash` — the hub-chain tx where the intent was created.
   * @returns A `Result<SolverExecutionResponse, PostExecutionError>`. On failure `result.error` is a
   *   {@link SodaxError} with one of:
   *   - `EXTERNAL_API_ERROR` — solver returned a typed error response. The original
   *     `SolverIntentErrorCode` is on `result.error.context.solverCode`; the full
   *     `SolverErrorResponse.detail` is on `result.error.context.solverDetail`.
   *   - `EXECUTION_FAILED` — network/transport-level failure (the solver call threw).
   *   - `UNKNOWN` — defensive fallback; should not normally hit.
   *
   *   By design, `postExecution` alone never emits relay/verify codes — those appear only on
   *   `swap` because only `swap` orchestrates verify + relay.
   */
  public async postExecution(
    request: SolverExecutionRequest,
  ): Promise<Result<SolverExecutionResponse, PostExecutionError>> {
    try {
      const result = await SolverApiService.postExecution(request, this.solver, this.config.logger, this.config.apiKey);
      if (result.ok) return result;

      // Defensive: SolverApiService is contractually typed to return SolverErrorResponse,
      // but a malformed upstream payload would otherwise surface as a cryptic
      // "Cannot read properties of undefined" caught below. Fall back to a synthetic detail
      // so the canonical SodaxError carries enough context for forensics.
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
      // Narrow guard: only preserve SodaxErrors whose code is in postExecution's union.
      // A SodaxError with an out-of-union code (e.g. RELAY_TIMEOUT) is wrapped below
      // as EXECUTION_FAILED so the typed contract holds at runtime.
      if (isPostExecutionError(error)) return { ok: false, error };
      return { ok: false, error: executionFailed('swap', error, { phase: 'postExecution' }) };
    }
  }

  /**
   * Submits a spoke-chain transaction to the relayer API so it is tracked and relayed to the hub.
   *
   * Called automatically by `swap()`. Use this directly when you need manual control over the
   * relay lifecycle (e.g. you called `createIntent` separately and want to relay yourself).
   *
   * @param submitPayload - Relay request with `action: 'submit'`, containing `chain_id` and `tx_hash`.
   * @returns A `Result` wrapping the relay submission acknowledgement.
   */
  public async submitIntent(submitPayload: IntentRelayRequest<'submit'>): Promise<Result<GetRelayResponse<'submit'>>> {
    try {
      return await submitTransaction(submitPayload, this.relayerApiEndpoint);
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Executes a full end-to-end cross-chain swap.
   *
   * Orchestrates the complete swap lifecycle. `createIntent` first submits the intent transaction on
   * the source spoke chain; completion then runs via one of two paths, each bounded by its own `timeout`
   * budget:
   *
   * - **Client-side (opt-out via `swaps.useBackendSubmitTx: false`), {@link fallbackSwapSteps}:** verifies
   *   the spoke tx landed on-chain, relays it to the hub (Sonic) and waits for the packet — skipped when
   *   `srcChainKey` is the hub, where the spoke tx already is the hub tx — then calls `postExecution` to
   *   notify the solver, triggering it to fill the intent.
   * - **Backend 2-step (default via `swaps.useBackendSubmitTx`), {@link submitTx}:** hands the
   *   broadcast tx to the swaps API, which verifies, relays and post-executes server-side, then polls
   *   for completion. On ANY non-success it transparently falls back to the client-side path above —
   *   safe because re-relaying / re-posting an already-processed swap is idempotent (no double-fill).
   *
   * @param _params - Swap action params including intent parameters, wallet provider, and an optional
   *   `timeout` — a PER-ATTEMPT budget, not an end-to-end one. The backend attempt (submit POST + status
   *   poll) gets it, and if that attempt does not complete the client-side relay wait gets a fresh one
   *   starting after verification, so neither a stalled backend nor a slow source-chain confirmation can
   *   shorten it. Worst-case wall-clock is `createIntent + timeout + verification +
   *   max(timeout, RELAY_FALLBACK_FLOOR_MS) + postExecution`, where verification is bounded by the source
   *   chain's `pollingConfig.maxTimeoutMs` and the first and last terms are not bounded by `timeout` at
   *   all. See `docs/SWAPS.md` § How `timeout` bounds each attempt.
   * @returns A `Result<SwapResponse, SwapError>`. On success:
   *   - `solverExecutionResponse` — solver acknowledgement (`{ answer: 'OK', intent_hash }`).
   *   - `intent` — the on-chain intent object that was created.
   *   - `intentDeliveryInfo` — source/destination chain keys, tx hashes, and user addresses.
   *
   *   On failure `result.error` is a {@link SodaxError} with one of:
   *   - `VALIDATION_FAILED` — input validation failed (propagated from `createIntent`).
   *   - `INTENT_CREATION_FAILED` — spoke-side intent creation/deposit failed.
   *   - `TX_VERIFICATION_FAILED` — the spoke tx could not be verified on-chain.
   *   - `TX_SUBMIT_FAILED` — relay submission failed after the spoke tx landed
   *     (`context.relayCode === 'SUBMIT_TX_FAILED'`).
   *   - `RELAY_TIMEOUT` — relay packet did not arrive in time
   *     (`context.relayCode === 'RELAY_TIMEOUT'`).
   *   - `RELAY_FAILED` — other relay failure (`context.relayCode === 'UNKNOWN'`).
   *   - `EXECUTION_FAILED` — solver notify call failed.
   *   - `EXTERNAL_API_ERROR` — solver returned a typed error
   *     (`context.solverCode` carries the original `SolverIntentErrorCode`).
   *   - `UNKNOWN` — uncategorized fallback.
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
            // CreateIntentErrorCode ⊂ SwapErrorCode by definition; the cast is structural, not a
            // contract widening. (Verified at design time via the type alias relationship.)
            return { ok: false, error: createIntentResult.error };
          }

          return await this.completeSwap(_params, createIntentResult.value);
        } catch (error) {
          // Narrow guard: preserve SodaxErrors whose code is in the swap union; wrap unknown
          // codes (e.g. an accidental cross-feature code) as UNKNOWN.
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
   * Which approval path {@link swapWithApproval} would take for these params, so a UI can say up front
   * whether the swap costs one signature or two. Read-only; sends nothing.
   *
   * `'atomic-batch'` needs an EVM spoke source and a wallet that reports EIP-5792 atomic support for
   * that chain — `'supported'`, or `'ready'` (the wallet asks the user to upgrade the account on the
   * first batch; pass `allowAccountUpgrade: false` to treat such a wallet as unable to batch). The Sonic
   * hub, a Stellar source that needs a trustline, and wallets without batch support get `'sequential'`;
   * other non-EVM sources have no allowance and get `'not-required'`.
   *
   * @returns `ALLOWANCE_CHECK_FAILED` when the allowance read fails; otherwise the strategy.
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

    if (
      isEvmSpokeOnlyChainKeyType(srcChainKey) &&
      isEvmWalletProviderType(walletProvider) &&
      canSendAtomicBatch(walletProvider)
    ) {
      const support = await readAtomicBatchSupport(walletProvider, getEvmViemChain(srcChainKey).id);
      if (support === 'supported' || (support === 'ready' && allowAccountUpgrade)) {
        return { ok: true, value: 'atomic-batch' };
      }
    }
    return { ok: true, value: 'sequential' };
  }

  /**
   * {@link swap} with the source-token approval folded in. Picks a path with
   * {@link getApprovalStrategy}: no approval when the allowance already suffices; on an EIP-5792
   * wallet, approve and the swap transaction as **one atomic batch — one signature**; otherwise
   * approve, wait for it to confirm, then the swap transaction. Completion (backend submit-tx with
   * the client-side relay fallback) is exactly `swap()`'s.
   *
   * A wallet that refuses the batch before signing anything (e.g. EIP-5792 5760, atomicity not
   * supported) falls back to the two-step path. A batch the user saw is never retried as separate
   * transactions:
   * - rejected → `USER_REJECTED`; a declined account upgrade (5750) adds `context.reason:`
   *   {@link ACCOUNT_UPGRADE_DECLINED}, after which `allowAccountUpgrade: false` swaps without one;
   * - never included or fully reverted (EIP-5792 400 / 500) → `INTENT_CREATION_FAILED` with
   *   `context.reason: 'atomic-batch-failed'`;
   * - anything else short of a confirmed deposit receipt (not confirmed within `timeout`, a partial
   *   revert, receipts that do not identify the deposit) → `TX_VERIFICATION_FAILED` with
   *   `context.reason:` {@link ATOMIC_BATCH_UNCONFIRMED}, `context.batchId` and `context.callCount`. It may
   *   have landed — do not send it again; call again with `resumeBatchId` and `resumeBatchCallCount` to
   *   finish it once it does.
   *
   * @returns A `Result<SwapWithApprovalResponse, SwapWithApprovalError>` — `swap()`'s response plus the
   *   `approvalStrategy` that ran. Errors are `swap()`'s codes plus `APPROVE_FAILED` and
   *   `ALLOWANCE_CHECK_FAILED`.
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

          let approvalStrategy = strategy.value;
          let created: Result<CreateIntentResult<K, false>, SwapWithApprovalError> = approvalStrategy === 'atomic-batch'
            ? await this.createIntentInAtomicBatch(_params)
            : approvalStrategy === 'sequential'
              ? await this.approveThenCreateIntent(_params)
              : await this.createIntent(_params);
          if (
            !created.ok &&
            created.error.code === 'INTENT_CREATION_FAILED' &&
            created.error.context?.reason === ATOMIC_BATCH_REFUSED
          ) {
            // Nothing was signed or sent yet, so approving separately cannot duplicate anything.
            this.config.logger.warn('[swapWithApproval] wallet refused the atomic batch; approving separately', {
              error: created.error,
            });
            approvalStrategy = 'sequential';
            created = await this.approveThenCreateIntent(_params);
          }
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

  /**
   * Approve + deposit as one EIP-5792 atomic batch, in broadcast order (`[reset?, approve, deposit]`),
   * then hand back the batch's transaction hash as the intent tx, for {@link completeSwap}.
   */
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

    const approval = await this.buildApproveTxs<K>({ params, raw: true });
    if (!approval.ok) {
      return {
        ok: false,
        error: isSwapWithApprovalError(approval.error)
          ? withErrorContext(approval.error, ctx)
          : approveFailed('swap', approval.error, ctx),
      };
    }
    const created = await this.createIntent<K, true>({ params, extras, skipSimulation, raw: true });
    if (!created.ok) return created;

    // An EVM spoke source makes every unsigned leg an EvmRawTransaction.
    const { resetTx, approveTx } = approval.value as ApprovalTxs<EvmSpokeOnlyChainKey>;
    const depositTx = created.value.tx as EvmRawTransaction;
    const txs = resetTx ? [resetTx, approveTx, depositTx] : [approveTx, depositTx];
    const timeoutMs = batchWaitMs(_params.timeout);
    return this.sendAtomicBatch(walletProvider, txs, getEvmViemChain(srcChainKey).id, timeoutMs, ctx, created.value);
  }

  private async sendAtomicBatch<K extends SpokeChainKey>(
    walletProvider: AtomicBatchEvmWalletProvider,
    txs: readonly EvmRawTransaction[],
    expectedChainId: number,
    timeoutMs: number,
    ctx: Record<string, string>,
    created: CreateIntentResult<K, true>,
  ): Promise<Result<CreateIntentResult<K, false>, SwapWithApprovalError>> {
    let batchId: string;
    try {
      batchId = await walletProvider.sendAtomicBatch(txs, { expectedChainId });
    } catch (error) {
      const reason = isAtomicBatchRefused(error)
        ? ATOMIC_BATCH_REFUSED
        : isAccountUpgradeDeclined(error)
          ? ACCOUNT_UPGRADE_DECLINED
          : undefined;
      return { ok: false, error: intentCreationFailed('swap', error, { ...ctx, ...(reason && { reason }) }) };
    }

    const deposit = await this.waitForBatchDeposit(walletProvider, batchId, timeoutMs, ctx, txs.length);
    if (!deposit.ok) return deposit;
    return {
      ok: true,
      value: { tx: deposit.value as TxReturnType<K, false>, intent: created.intent, relayData: created.relayData },
    };
  }

  /**
   * Waits for a batch the wallet accepted and returns the hash of the transaction that carries its
   * deposit. `callCount` (the calls sent) also accepts one receipt per call in separate transactions.
   */
  private async waitForBatchDeposit(
    walletProvider: AtomicBatchEvmWalletProvider,
    batchId: string,
    timeoutMs: number,
    ctx: Record<string, string>,
    callCount?: number,
  ): Promise<Result<string, SwapWithApprovalError>> {
    // The wallet holds the batch: a failure to confirm it must not read as "nothing sent".
    const unconfirmed = (cause?: unknown): Result<never, SwapWithApprovalError> => ({
      ok: false,
      error: new SodaxError('TX_VERIFICATION_FAILED', 'Atomic approve + swap batch was sent but not confirmed', {
        feature: 'swap',
        cause,
        context: {
          ...ctx,
          phase: 'verify',
          reason: ATOMIC_BATCH_UNCONFIRMED,
          batchId,
          ...(callCount !== undefined && { callCount }),
        },
      }),
    });
    try {
      // viem reads a zero timeout as "no timeout"; give up at once instead.
      const batch = await walletProvider.waitForBatch(batchId, { timeout: Math.max(1, timeoutMs) });
      if (batch.status !== 'success' && !BATCH_NOTHING_LANDED_CODES.has(batch.statusCode)) return unconfirmed();
      if (batch.status !== 'success') {
        return {
          ok: false,
          error: new SodaxError('INTENT_CREATION_FAILED', 'Atomic approve + swap batch did not succeed', {
            feature: 'swap',
            context: {
              ...ctx,
              phase: 'intentCreation',
              reason: 'atomic-batch-failed',
              batchId,
              statusCode: batch.statusCode,
            },
          }),
        };
      }
      // The deposit is the last call: either every receipt is the same tx (a wallet may add its own
      // fee call to it), or there is one receipt per call.
      const { receipts } = batch;
      const oneTx = new Set(receipts.map(receipt => receipt.transactionHash)).size === 1;
      const deposit = oneTx || receipts.length === callCount ? receipts.at(-1) : undefined;
      if (deposit?.status !== 'success') return unconfirmed();
      return { ok: true, value: deposit.transactionHash };
    } catch (error) {
      return unconfirmed(error);
    }
  }

  /**
   * Finishes a batch an earlier call left {@link ATOMIC_BATCH_UNCONFIRMED}, without sending anything to
   * the wallet: waits for it again, relays its deposit client-side and notifies the solver. The
   * original intent went with that call, so it is read back from the hub tx the relay delivers.
   */
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
    const timeoutMs = batchWaitMs(_params.timeout);

    const deposit = await this.waitForBatchDeposit(
      walletProvider,
      batchId,
      timeoutMs,
      ctx,
      _params.resumeBatchCallCount,
    );
    if (!deposit.ok) return deposit;
    const srcTxHash = deposit.value;
    const txCtx = { ...ctx, srcTxHash };

    // An EVM spoke tx is relayed by its hash alone, so the lost `relayData` is not needed.
    const intentRelayChainId = getIntentRelayChainId(srcChainKey).toString();
    const submitted = await submitTransaction(
      { action: 'submit', params: { chain_id: intentRelayChainId, tx_hash: srcTxHash } },
      this.relayerApiEndpoint,
    );
    if (!submitted.ok) return { ok: false, error: mapRelayFailure(submitted.error, { feature: 'swap', ...txCtx }) };
    const packet = await waitUntilIntentExecuted({
      intentRelayChainId,
      srcTxHash,
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
      apiUrl: this.relayerApiEndpoint,
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

  /** Approve, wait for the approval to confirm, then create the intent — two or more signatures. */
  private async approveThenCreateIntent<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
  ): Promise<Result<CreateIntentResult<K, false>, SwapWithApprovalError>> {
    const { params } = _params;
    const ctx = {
      srcChainKey: params.srcChainKey,
      dstChainKey: params.dstChainKey,
      action: 'swapWithApproval',
      approvalStrategy: 'sequential',
    };

    const approved = await this.approve(_params);
    if (!approved.ok) {
      return {
        ok: false,
        error: isSwapWithApprovalError(approved.error)
          ? withErrorContext(approved.error, ctx)
          : approveFailed('swap', approved.error, ctx),
      };
    }

    // The intent tx is only valid once the allowance is on-chain; `approve` returns at broadcast.
    const receipt = await this.spoke.waitForTxReceipt({ txHash: approved.value, chainKey: params.srcChainKey });
    if (!receipt.ok || receipt.value.status !== 'success') {
      return {
        ok: false,
        error: new SodaxError('APPROVE_FAILED', `Approval transaction ${approved.value} did not confirm`, {
          feature: 'swap',
          cause: receipt.ok ? receipt.value : receipt.error,
          context: { ...ctx, phase: 'approve', reason: 'approve-not-confirmed', approveTxHash: approved.value },
        }),
      };
    }

    return this.createIntent(_params);
  }

  /**
   * Completes a swap whose intent tx is already broadcast: the backend 2-step attempt when
   * `useBackendSubmitTx` is on, falling back to {@link fallbackSwapSteps} on any non-success.
   * Shared by `swap()` and `swapWithApproval()`, which differ only in how the intent tx is created.
   */
  private async completeSwap<K extends SpokeChainKey>(
    _params: SwapActionParams<K, false>,
    created: CreateIntentResult<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    // `timeout` is a PER-ATTEMPT budget, not an end-to-end one: the backend attempt gets it, and if
    // that attempt fails the client-side relay fallback gets a fresh one. Sharing a single deadline
    // would leave the fallback whatever the backend had not spent, which is how a relay that needs
    // longer than the leftovers ends in RELAY_TIMEOUT. Resolved (not just defaulted) so a non-finite
    // caller value cannot reach either budget — see `resolveTimeoutMs`.
    const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

    // Backend 2-step flow (default on): hand the broadcast intent tx to the swaps API, which relays +
    // post-executes server-side. On ANY non-success we fall back to the client-side relay so the
    // swap still completes — safe because re-relay / re-post are idempotent (see `submitTx`).
    if (this.useBackendSubmitTx) {
      const submitted = await this.submitTx(_params, created, createSubmitTxAttempt(timeoutMs));
      if (submitted.ok) return submitted;
      this.config.logger.warn('[swap] backend submit-tx did not complete; falling back to the client-side relay', {
        error: submitted.error,
      });
    }

    return this.fallbackSwapSteps(_params, created, timeoutMs);
  }

  /**
   * Client-side swap completion (opt-out via `swaps.useBackendSubmitTx: false`): verify the broadcast intent
   * tx landed, then relay it to the hub — or use it directly when the source IS the hub — then notify the
   * solver via post-execution and build the {@link SwapResponse}. Extracted verbatim from `swap()` so the
   * backend 2-step path ({@link submitTx}) can fall back to it on any non-success.
   *
   * Verification belongs to THIS path only: the backend runs its own, so verifying before handing over
   * would delay every backend success by the source chain's confirmation wait and could fail a swap the
   * backend would have completed.
   */
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

    const verifyTxHashResult = await this.spoke.verifyTxHash({
      txHash: created.tx,
      chainKey: srcChainKey,
    });
    if (!verifyTxHashResult.ok) {
      return { ok: false, error: verifyFailed('swap', verifyTxHashResult.error, txCtx) };
    }

    let dstIntentTxHash: string;
    if (isHubChainKeyType(srcChainKey)) {
      dstIntentTxHash = spokeTxHash;
    } else {
      const packet = await relayTxAndWaitPacket({
        srcTxHash: spokeTxHash,
        data: relayData,
        chainKey: srcChainKey,
        relayerApiEndpoint: this.relayerApiEndpoint,
        // The caller's full `timeout`, starting HERE — after verification, and whether this runs as the
        // only path or as the backend's fallback. Neither a stalled backend attempt nor a slow source-chain
        // confirmation may shorten the relay wait. The floor covers a sub-floor caller `timeout`:
        // `relayTxAndWaitPacket` SUBMITS before `timeout` bounds anything, so a zero budget would strand an
        // already-landed tx unrelayed. Re-relay is idempotent, so spending it is safe.
        timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
      });
      if (!packet.ok) {
        return { ok: false, error: mapRelayFailure(packet.error, { feature: 'swap', ...txCtx }) };
      }
      dstIntentTxHash = packet.value.dst_tx_hash;
    }

    const postExecResult = await this.postExecution({
      intent_tx_hash: dstIntentTxHash as `0x${string}`,
    });
    if (!postExecResult.ok) {
      // PostExecutionErrorCode ⊂ SwapErrorCode by definition. The hub tx is what a retried `postExecution` needs.
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
   * Backend 2-step swap path (default via `swaps.useBackendSubmitTx`): hand the broadcast
   * intent tx to the swaps API (`POST /swaps/submit-tx`); the backend relays + post-executes
   * server-side. Polls `getSubmitTxStatus` until `solved`, then reconstructs the same
   * {@link SwapResponse} the client-side path returns (`result.dstIntentTxHash` → delivery info,
   * `result.intent_hash` → solver response).
   *
   * Never throws — returns `{ ok: false }` on any non-success (submit `!ok`, terminal `failed` /
   * abandoned, or poll timeout) so `swap()` falls back to {@link fallbackSwapSteps}.
   *
   * Falling back is safe: re-relaying / re-posting an already-processed swap is idempotent — the
   * relay dedups and returns the existing `executed` packet, and the solver re-affirms the intent
   * (no double-fill). Verified live by `e2e-tests/e2e-relay.test.ts`. It is also load-bearing rather
   * than belt-and-braces: the backend keeps processing after this attempt gives up, so the fallback's
   * relay can race the backend's own.
   *
   * The attempt itself — POST, budget clamps, status poll — is {@link runBackendSubmitTx}, shared with
   * bridge. What is swap-specific and lives here: the request body, the `solved` terminal status, the
   * mapping from a terminal result to a {@link SwapResponse}, and the swap error taxonomy.
   *
   * `attempt` bounds this attempt alone — the POST and every status request draw on it, and the
   * client-side fallback holds a separate fresh `timeout`.
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
        // The configured key is already baked into the SwapsApiService headers, so only this
        // per-action override (mirroring `extras.partnerFee`) travels per call.
        overrideConfig: { apiKey: _params.extras?.apiKey },
        body: {
          txHash: spokeTxHash,
          srcChainKey,
          walletAddress: params.srcAddress,
          intent,
          relayData: relayData.payload,
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        // Swaps terminal success is `solved` (solver filled) — not the bridge `executed`.
        terminalStatus: 'solved',
        onExecuted: (result): SwapResponse | undefined =>
          result?.dstIntentTxHash && result.intent_hash
            ? {
                // Backend serializes the hex intent_hash as a plain string; brand it at the boundary.
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
      // Any non-success — rejected POST, terminal `failed`, spent attempt — becomes the cause swap()
      // logs before falling back to the client-side relay.
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('swap', outcome.cause, { ...baseCtx, action: 'swap' }) };
    } catch (error) {
      return { ok: false, error: unknownFailed('swap', error, { ...baseCtx, action: 'swap' }) };
    }
  }

  /**
   * Checks whether the relevant spender contract is already approved to spend the input token amount.
   *
   * - EVM hub (Sonic): checks ERC-20 allowance against the intents contract.
   * - EVM spoke chains: checks ERC-20 allowance against the spoke's asset manager.
   * - Stellar: checks trustline balance sufficiency.
   * - All other chains (Solana, NEAR, etc.): returns `true` — no on-chain allowance concept.
   *
   * Call this before `createIntent` or `swap` to decide whether an `approve` call is needed.
   *
   * @param _params - Swap action params; only `params.srcChainKey`, `params.inputToken`,
   *   `params.inputAmount`, and `params.srcAddress` are used.
   * @returns A `Result` wrapping `true` if the allowance is sufficient, `false` if approval is required.
   */
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
          spender: this.solver.intentsContract,
        } satisfies SpokeIsAllowanceValidParamsHub);
      }

      if (isEvmSpokeOnlyChainKeyType(srcChainKey)) {
        return await this.spoke.isAllowanceValid({
          srcChainKey,
          token: params.inputToken,
          amount: params.inputAmount,
          owner: params.srcAddress,
          spender: this.config.getChainConfig(srcChainKey).addresses.assetManager,
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
   * Approves the relevant spender contract to transfer the input token on behalf of the user.
   *
   * - EVM hub (Sonic): approves the intents contract.
   * - EVM spoke chains: approves the spoke's asset manager contract.
   * - Stellar: approves the trustline (adds/increases it).
   * - Other chain types: returns an error — approval is not supported.
   *
   * When `raw: true`, returns unsigned transaction data instead of broadcasting. That is always a
   * single transaction, which cannot express the two-step approval a TetherToken-lineage token
   * needs when a stale allowance already exists — use {@link SwapService.buildApproveTxs} for the
   * whole plan.
   * When `raw: false`, a matching wallet provider for `K` must be supplied and the transaction
   * is signed and broadcast immediately. Such an approval can take **two** transactions, so the
   * user may sign twice; the returned hash is the last one's.
   *
   * @param _params - Swap action params including the source chain key, input token, amount, and wallet provider.
   * @returns A `Result` wrapping the chain-specific transaction return type (`TxReturnType<K, Raw>`).
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
        const spender = isHubChainKeyType(params.srcChainKey)
          ? this.solver.intentsContract
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
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

  /**
   * The unsigned approval transactions for the swap's source token, in the order they must be
   * broadcast.
   *
   * Two transactions when the source token needs its stale allowance cleared first, one otherwise.
   * {@link SwapService.approve} is unchanged and still returns a single transaction; this is the
   * entry point for unsigned callers that need to handle the two-step case. When `resetTx` is
   * present, broadcast it and wait for it to be mined first — `approveTx` is not valid until the
   * reset has landed.
   */
  public async buildApproveTxs<K extends SpokeChainKey>(
    _params: SwapActionParams<K, true>,
  ): Promise<Result<ApprovalTxs<K>>> {
    const { params } = _params;
    const wrapApproveFailure = (cause: unknown) => approveFailed('swap', cause);

    try {
      if (isHubChainKeyType(params.srcChainKey) || isEvmSpokeOnlyChainKeyType(params.srcChainKey)) {
        const spender = isHubChainKeyType(params.srcChainKey)
          ? this.solver.intentsContract
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

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

  /**
   * Creates a swap intent on the user's source spoke chain without submitting it to the solver.
   *
   * Use this when you need the raw transaction data or want to control the relay step yourself.
   * For a full end-to-end swap (create → relay → notify solver), use `swap()` instead.
   *
   * Strongly typed: `K` narrows `walletProvider` to the correct chain-specific provider interface,
   * and `Raw` controls whether the transaction is broadcast or returned unsigned:
   * - `raw: true` — returns unsigned transaction data; `walletProvider` must be absent.
   * - `raw: false` — broadcasts the transaction; `walletProvider` is required and must match `K`.
   *
   * Validates tokens and chain keys against the active `ConfigService` before constructing the
   * intent. Bitcoin source chains require an additional Bound Exchange access token step.
   *
   * @param _params - Intent parameters, source chain key, wallet provider (when `raw: false`),
   *   and optional `skipSimulation` flag.
   * @returns A `Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>`. On success contains:
   *   - `tx` — chain-specific tx hash (executed) or raw tx data (raw mode).
   *   - `intent` — the fully constructed `Intent` object augmented with `feeAmount`.
   *   - `relayData` — `{ address, payload }` needed to submit the intent to the relayer.
   *
   *   On failure `result.error` is a {@link SodaxError} with one of:
   *   - `VALIDATION_FAILED` — invariant precondition failed (unsupported tokens,
   *     invalid chain key, Bitcoin dust output below 546 sats, invalid wallet provider).
   *     The original prose is on `result.error.message`; phase is `'validate'`.
   *   - `INTENT_CREATION_FAILED` — spoke-side intent creation/deposit failed.
   *   - `UNKNOWN` — defensive fallback.
   */
  public async createIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: SwapActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>> {
    const { params, skipSimulation, extras } = _params;
    // Per-action `extras.partnerFee` is primary; `this.partnerFee` (the effective swap fee,
    // `swaps.partnerFee ?? fee`, read live off config) is the fallback default. undefined = no fee.
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
      // Native BTC on the Bitcoin chain is denominated in satoshis and must clear the 546-sat dust limit —
      // the BTC deposit on a Bitcoin source and the BTC delivery to a Bitcoin destination alike. `inputToken`
      // / `outputToken` are original asset addresses (native BTC is '0:0'), so resolve them to token
      // descriptors and match on symbol rather than comparing the address against the 'BTC' string.
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
      if (isStacksChainKeyType(params.srcChainKey) && _params.raw === true) {
        swapInvariant(
          extras?.srcPublicKey !== undefined,
          'srcPublicKey is required for Stacks createIntent (raw) — the source tx is built unsigned and needs the signer public key',
          { ...baseCtx, field: 'srcPublicKey' },
        );
      }

      const personalAddress = params.srcAddress;

      // Bitcoin TRADING mode: derive the hub wallet from the trading address (raw + non-raw), since
      // deposits originate from the trading wallet, not the personal one.
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

      // derive users hub wallet address
      const creatorHubWalletAddress = await this.hubProvider.getUserHubWalletAddress(walletAddress, params.srcChainKey);

      if (isHubChainKeyType(params.srcChainKey) && isSonicChainKeyType(params.srcChainKey)) {
        const coreSonicParams = {
          createIntentParams: params,
          creatorHubWalletAddress,
          solverConfig: this.solver,
          fee: partnerFee,
          hubProvider: this.hubProvider,
        } as const;

        // on hub chain create intent directly
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
            tx: txResult satisfies TxReturnType<SonicChainKey, boolean> as TxReturnType<K, Raw>,
            intent: { ...intent, feeAmount } as Intent & FeeAmount,
            relayData: { address: intent.creator, payload: data },
          },
        };
      }

      // construct the intent data
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
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
          intent: { ...intent, feeAmount } as Intent & FeeAmount,
          relayData: { address: intent.creator, payload: data },
        },
      };
    } catch (error) {
      // swapInvariant() throws SodaxError<'VALIDATION_FAILED'> directly, so the guard
      // catches validation failures by code membership. Anything else (a hubProvider
      // rejection, deposit throw, etc.) gets wrapped as INTENT_CREATION_FAILED with
      // the original on cause.
      if (isSwapCreateIntentError(error)) return { ok: false, error };
      return {
        ok: false,
        error: intentCreationFailed('swap', error, baseCtx),
      };
    }
  }

  /**
   * Submits a full end-to-end limit order (create intent → relay → notify solver).
   *
   * A limit order is a swap intent with `deadline = 0n`, meaning it has no expiry and stays
   * active until the solver fills it at `minOutputAmount` or the user cancels it via
   * `cancelLimitOrder`. The `deadline` field is forced to `0n` regardless of any value
   * in `_params.params`.
   *
   * This is the limit-order equivalent of `swap()`.
   *
   * @param _params - Limit order action params (same shape as `swap()` but uses `CreateLimitOrderParams`).
   * @returns A `Result` containing `SwapResponse` — same structure as `swap()`.
   */
  public async createLimitOrder<K extends SpokeChainKey>(
    _params: LimitOrderActionParams<K, false>,
  ): Promise<Result<SwapResponse, SwapError>> {
    const { timeout, skipSimulation } = _params;
    // Force deadline to 0n (no deadline) for limit orders. K is preserved on the resulting
    // CreateIntentParams<K> so swap() infers the same chain narrowing.
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

  /**
   * Creates a limit order intent on the source spoke chain without submitting it to the solver.
   *
   * The limit-order equivalent of `createIntent()`: forces `deadline = 0n` (no expiry) and
   * delegates to `createIntent`. Does not relay or notify the solver — use `createLimitOrder()`
   * for the full lifecycle.
   *
   * Supports both raw mode (`raw: true`) and executed mode (`raw: false`).
   *
   * @param _params - Limit order action params including intent parameters, chain key, and optional raw flag.
   * @returns A `Result` containing `CreateIntentResult<K, Raw>` — same structure as `createIntent()`.
   */
  public async createLimitOrderIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: LimitOrderActionParams<K, Raw>,
  ): Promise<Result<CreateIntentResult<K, Raw>, SwapCreateIntentError>> {
    // Force deadline to 0n for limit orders. srcChain is preserved on params so K narrowing
    // flows through to createIntent unchanged.
    const limitOrderParams: CreateIntentParams<K> = {
      ..._params.params,
      deadline: 0n,
    } as const as CreateIntentParams<K>;

    return this.createIntent({
      ..._params,
      params: limitOrderParams,
    } as SwapActionParams<K, Raw>);
  }

  /**
   * Cancels an active limit order and waits for the cancellation to be confirmed on the hub chain.
   *
   * Convenience alias for `cancelIntent` — semantically equivalent, exposed under a
   * domain-specific name for callers who think in terms of limit orders rather than intents.
   *
   * @param params - Cancel params including `srcChainKey`, the `intent` to cancel, wallet provider,
   *   and an optional `timeout` in milliseconds.
   * @returns A `Result` containing `TxHashPair`:
   *   - `srcChainTxHash` — cancel tx hash on the source spoke chain.
   *   - `dstChainTxHash` — corresponding hub-chain (Sonic) tx hash after relay.
   */
  public async cancelLimitOrder<K extends SpokeChainKey>(
    params: CancelIntentActionParams<K, false>,
  ): Promise<Result<TxHashPair>> {
    return this.cancelIntent(params);
  }

  /**
   * Builds and optionally broadcasts the cancel-intent transaction on the source spoke chain.
   *
   * Does not relay or wait for hub confirmation — call `cancelIntent` for the full lifecycle.
   * Use this directly only when you need raw transaction data or manual relay control.
   *
   * Because `Intent.srcChain` is an `IntentRelayChainId` (bigint) whose literal type cannot
   * narrow to a specific `SpokeChainKey`, the caller must pass `srcChainKey: K` explicitly.
   * At runtime the method asserts `getIntentRelayChainId(srcChainKey) === intent.srcChain` to
   * catch mismatches. `K` then narrows `walletProvider` the same way `createIntent` does.
   *
   * @param _params - Cancel params including `srcChainKey`, the `intent` to cancel, raw flag,
   *   and wallet provider (required when `raw: false`).
   * @returns A `Result` wrapping the chain-specific transaction return type (`TxReturnType<K, Raw>`).
   */
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
        value: txResult.value satisfies TxReturnType<K, boolean> as TxReturnType<K, Raw>,
      };
    } catch (error) {
      if (isSwapCreateIntentError(error)) return { ok: false, error };
      return { ok: false, error: intentCreationFailed('swap', error) };
    }
  }

  /**
   * Cancels an intent on the source spoke chain and waits for the cancellation to land on the hub.
   *
   * Full cancellation lifecycle:
   * 1. Calls `createCancelIntent` to broadcast the cancel transaction on the spoke chain.
   * 2. Verifies the spoke transaction.
   * 3. For non-hub source chains: submits to the relayer and polls until the cancel packet
   *    is delivered to the hub. Solana submits the cancel payload alongside the tx (the spoke tx
   *    only carries its hash) and Bitcoin relays its signed on-demand payload — see
   *    {@link buildCancelRelayIdentity}. For hub source chains, the spoke tx hash is reused directly.
   *
   * @param _params - Cancel params including `srcChainKey`, the `intent`, wallet provider, and
   *   an optional `timeout` in milliseconds.
   * @returns A `Result` containing `TxHashPair`:
   *   - `srcChainTxHash` — cancel tx hash on the source spoke chain (Bitcoin: the relay's derived
   *     `od:<hash>` id, since an on-demand cancel broadcasts no spoke tx).
   *   - `dstChainTxHash` — hub-chain (Sonic) tx hash confirming the cancellation.
   */
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
   * Source address the cancel `sendMessage` originates from.
   *
   * Every chain but Bitcoin signs from the address stored on the intent. A Bitcoin TRADING-mode intent
   * stores the trading address, yet the spoke layer expects the personal wallet: it re-derives the
   * trading wallet from it and picks the message-signing scheme from its address type. So Bitcoin
   * TRADING takes `params.srcAddress`, else the wallet provider's address (raw has no provider).
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
   * Relay extra data (`{ address, payload }`) for cancelling `intent`, for callers that relay a
   * `createCancelIntent` transaction themselves (`raw` mode or manual relay control).
   *
   * Solana commits only the hash of the cancel payload on-chain, so the relayer needs this alongside
   * the spoke tx; other chains ignore it. It is the cancel counterpart of {@link reconstructRelayData}:
   * the create-intent extra data does not match a cancel tx. Bitcoin cancels are on-demand instead —
   * relay the signed payload `createCancelIntent` returns via `BitcoinSpokeService.getOnDemandRelayIdentity`.
   *
   * @param intent - The intent being cancelled (e.g. from `getIntent(txHash)`).
   * @returns A `Result` containing `RelayExtraData`: `{ address: Hex; payload: Hex }`.
   */
  public getCancelIntentRelayData(intent: Intent): Result<RelayExtraData> {
    try {
      invariant(this.config.isValidIntentRelayChainId(intent.srcChain), `Invalid intent.srcChain: ${intent.srcChain}`);
      return { ok: true, value: this.buildCancelRelayData(intent) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Relay extra data for a cancel: the hub wallet that owns the intent and the `cancelIntent` call it
   * executes. This is exactly what `createCancelIntent` sends on-chain, so split-tx chains (Solana),
   * whose spoke tx carries only the payload hash, can hand the relayer the full payload.
   */
  private buildCancelRelayData(intent: Intent): RelayExtraData {
    return {
      address: intent.creator,
      payload: encodeContractCalls([EvmSolverService.encodeCancelIntent(intent, this.solver.intentsContract)]),
    };
  }

  /**
   * Relay submit/poll identity for a cancel, mirroring the money market's on-demand handling.
   *
   * A Bitcoin cancel broadcasts no spoke tx: `sendMessage` returns a signed payload JSON that the relay
   * accepts under the literal `withdraw` tx_hash and tracks under a derived `od:<hash>` id (see
   * {@link BitcoinSpokeService.getOnDemandRelayIdentity}). Every other chain relays and polls by its
   * spoke tx hash and passes the cancel relay data, which the relayer needs on Solana and ignores elsewhere.
   */
  private buildCancelRelayIdentity(srcChainKey: SpokeChainKey, tx: string, intent: Intent) {
    return isBitcoinChainKeyType(srcChainKey)
      ? this.spoke.bitcoin.getOnDemandRelayIdentity(tx)
      : { srcTxHash: tx, data: this.buildCancelRelayData(intent), pollTxHash: undefined };
  }

  /**
   * Returns the relay extra data (`address` + `payload`) required to submit an intent to the relayer API.
   *
   * Only required when the source chain is Solana or Bitcoin, whose deposits commit a hash of the relay
   * payload on-chain, so the relayer needs the exact bytes bundled with the submission. For an intent
   * created by {@link SwapService.createIntent} the payload is byte-identical to the `relayData` that
   * call returned; see {@link SwapService.reconstructRelayData}, which this delegates to, for the
   * derivation and the one intent shape it cannot reconstruct.
   *
   * Accepts either a hub-chain tx hash (will fetch the intent on-chain first) or a
   * pre-fetched `Intent` object directly.
   *
   * @param params - Either `{ txHash: Hash }` to look up the intent, or `{ intent: Intent }` to use directly.
   * @returns A `Result` containing `RelayExtraData`: `{ address: Hex; payload: Hex }`.
   */
  public async getIntentSubmitTxExtraData(params: GetIntentSubmitTxExtraDataParams): Promise<Result<RelayExtraData>> {
    if ('txHash' in params) {
      const intentResult = await this.getIntent(params.txHash);
      if (!intentResult.ok) return intentResult;
      return this.reconstructRelayData(intentResult.value);
    }
    return this.reconstructRelayData(params.intent);
  }

  /**
   * Re-derives the byte-identical relay extra data (`{ address, payload }`) for an intent created by
   * {@link SwapService.createIntent} (or `swap` / `createLimitOrderIntent`) from a fully-populated
   * `Intent` alone — no on-chain call, no original `createIntent` return value needed.
   *
   * The `payload` matches exactly what `createIntent` relayed when the intent was first created:
   * - Sonic-hub source — raw `createIntent(intent)` calldata.
   * - Any spoke source — the `[approve, createIntent]` multicall (uniform across all spokes).
   *
   * Not reconstructable: a `LeverageYieldService.vaultSwap` / `createVaultIntent` intent with
   * `hubWalletSwap`. Its `srcChain` is the hub while the relayed payload is the spoke multicall sent
   * through `sendMessage`, so it is indistinguishable here from a Sonic-source swap and would yield raw
   * `createIntent` calldata. Keep the `relayData` that call returned, or use
   * `sodax.api.leverageYield.getIntentSubmitTxExtraData`.
   *
   * Byte-identity is possible because the only originally-random field, `intentId`, is already
   * carried on the `Intent`; everything else in the payload is a pure function of the intent and
   * the configured intents contract. Use this to rebuild relay submission data for a manual relay
   * step when the runtime `relayData` from `createIntent` is no longer available.
   *
   * @param intent - A fully-populated intent (e.g. from `getIntent(txHash)` or the `intent` field
   *   returned by `createIntent`).
   * @returns A `Result` containing `RelayExtraData`: `{ address: Hex; payload: Hex }`.
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

  /**
   * Fetches a previously created `Intent` from the hub chain by its transaction hash.
   *
   * Parses the `IntentCreated` event log from the transaction receipt.
   *
   * @param txHash - Transaction hash of the hub-chain (Sonic) intent creation transaction.
   * @returns A `Result` containing the `Intent` struct, or an error if the tx has no matching event.
   */
  public async getIntent(txHash: Hash): Promise<Result<Intent>> {
    try {
      const value = await EvmSolverService.getIntent(txHash, this.config, this.hubProvider.publicClient);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Fetches the fill state of an intent from the hub chain by the solver's fill transaction hash.
   *
   * Parses the `IntentFilled` event log from the transaction receipt. Useful for confirming
   * partial fills or verifying the final received output amount.
   *
   * @param txHash - Transaction hash of the hub-chain (Sonic) intent fill transaction.
   * @returns A `Result` containing `IntentState`: `{ exists, remainingInput, receivedOutput, pendingPayment }`.
   */
  public async getFilledIntent(txHash: Hash): Promise<Result<IntentState>> {
    try {
      const value = await EvmSolverService.getFilledIntent(txHash, this.solver, this.hubProvider.publicClient);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Polls the relayer API until the solver's fill transaction has been delivered to the
   * destination spoke chain, then returns the relay packet data.
   *
   * Use this after `getStatus` returns `SolverIntentStatusCode.SOLVED (3)` to obtain the
   * destination-chain transaction hash from `packet.dst_tx_hash`.
   *
   * A single solver fill tx emits multiple relay packets sharing the same `src_tx_hash`. The
   * user-facing `IntentFilled` delivery is the packet whose payload targets the hub intents
   * contract; `selectSolvedIntentPacket` disambiguates so the returned `dst_tx_hash` is the
   * destination delivery tx rather than an internal hop.
   *
   * @param chainId - The destination spoke chain key (where output tokens are delivered).
   * @param fillTxHash - The solver's fill transaction hash, obtained from `getStatus.fill_tx_hash`.
   * @param timeout - Poll timeout in milliseconds. Defaults to `DEFAULT_RELAY_TX_TIMEOUT` (120 s).
   * @returns A `Result` containing `PacketData` with relay details including `dst_tx_hash`,
   *   or an error tagged `'RELAY_TIMEOUT'` if the packet does not arrive within `timeout`.
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
    return waitUntilIntentExecuted({
      intentRelayChainId: getIntentRelayChainId(chainId).toString(),
      srcTxHash: fillTxHash,
      timeout,
      apiUrl: this.relayerApiEndpoint,
      selectPacket: packets => selectSolvedIntentPacket(packets, this.solver.intentsContract),
    });
  }

  /**
   * Computes the keccak256 hash of an intent struct, which serves as its unique ID on the hub chain.
   *
   * @param intent - The intent to hash.
   * @returns The `0x`-prefixed keccak256 digest of the ABI-encoded intent.
   */
  public getIntentHash(intent: Intent): Hex {
    return EvmSolverService.getIntentHash(intent);
  }

  /**
   * Computes an absolute deadline timestamp for a swap intent.
   *
   * Fetches the latest hub-chain (Sonic) block timestamp and adds `deadline` seconds to it.
   * Pass the result as `CreateIntentParams.deadline`. Use `0n` in `createIntent` directly for
   * no expiry (limit orders).
   *
   * @param deadline - Offset in seconds from the current hub-chain block time.
   *   Defaults to `DEFAULT_DEADLINE_OFFSET` (5 minutes). Must be greater than `0n`.
   * @returns A `Result` containing the absolute deadline as a Unix timestamp (bigint, seconds).
   * @throws Invariant error (forwarded as `Result.error`) if `deadline` is `0n` or negative.
   */
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

  /**
   * Returns the list of tokens supported for swapping on a specific spoke chain.
   *
   * @param chainId - The spoke chain key to query.
   * @returns A readonly array of `XToken` objects available for swapping on that chain.
   */
  public getSupportedSwapTokensByChainId(chainId: SpokeChainKey): readonly XToken[] {
    return this.config.getSupportedSwapTokensByChainId(chainId);
  }

  /**
   * Returns all supported swap tokens across every spoke chain.
   *
   * @returns A map from each `SpokeChainKey` to its readonly array of supported `XToken` objects.
   */
  public getSupportedSwapTokens(): Record<SpokeChainKey, readonly XToken[]> {
    return this.config.getSupportedSwapTokens();
  }

  /**
   * Offline, rule-based estimate of how fast a `srcToken`→`dstToken` swap will settle.
   *
   * Derived purely from SDK config (no network / on-chain / backend call): tokens whose vault is a
   * money-market-reserve sodaAsset settle faster, and an Ethereum leg adds a fixed penalty. See
   * {@link estimateSwapSpeedTier} for the rules.
   *
   * @param params `{ srcToken, dstToken }` spoke token pair to estimate
   * @returns the estimated `tier` bucket and `estimatedSeconds`
   */
  public getSwapSpeedTier(params: SwapSpeedTierParams): SwapSpeedTierResult {
    return estimateSwapSpeedTier(params, vault => this.config.isMoneyMarketReserveAsset(vault));
  }
}
