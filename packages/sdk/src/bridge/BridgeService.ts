import {
  type SpokeService,
  Erc20Service,
  type HubProvider,
  RELAY_FALLBACK_FLOOR_MS,
  EvmVaultTokenService,
  EvmAssetManagerService,
  encodeContractCalls,
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
  type SpokeApproveParams,
  type BitcoinBoundExtras,
} from '../shared/index.js';
import type { IntentTxResult, TxHashPair } from '../shared/types/types.js';
import type { BackendApiService } from '../backendApi/index.js';
import { runBackendSubmitTx } from '../backendApi/runBackendSubmitTx.js';
import { createSubmitTxAttempt, type SubmitTxAttempt } from '../backendApi/submitTxAttempt.js';
import { resolveTimeoutMs } from '../shared/utils/resolveTimeoutMs.js';
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
  type GetWalletProviderType,
  type EvmSpokeOnlyChainKey,
  type GetTokenAddressType,
  type SpokeExecActionParams,
  type GetChainType,
  DEFAULT_RELAY_TX_TIMEOUT,
  BITCOIN_DUST_SATS,
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
} from '../errors/wrappers.js';
import { mapRelayFailure } from '../errors/relay-error-mapping.js';
import {
  type BridgeAllowanceCheckError,
  type BridgeApproveError,
  type BridgeCreateIntentError,
  type BridgeLookupError,
  type BridgeOrchestrationError,
  bridgeInvariant,
  isBridgeAllowanceCheckError,
  isBridgeApproveError,
  isBridgeCreateIntentError,
  isBridgeLookupError,
  isBridgeOrchestrationError,
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
 * Per-action extras for bridge intent creation, supplied via the `extras` slot of the bridge
 * action params. Mirrors `SwapExtras` chain-keyed slots, plus a chain-agnostic `partnerFee` per-action
 * override that takes precedence over the config-level `bridgePartnerFee` (omit it to use the configured fee).
 *
 * - `srcPublicKey` — only for Stacks sources (their address can't yield the signer public key at
 *   raw-tx build time); keyed off `K` so non-Stacks actions can't set it.
 * - `bound` — Bound Exchange (Radfi) inputs for raw Bitcoin TRADING-mode sources; keyed off `K`
 *   so non-Bitcoin actions can't set it.
 */
export type BridgeExtras<K extends SpokeChainKey = SpokeChainKey> = (GetChainType<K> extends 'STACKS'
  ? { srcPublicKey?: string }
  : { srcPublicKey?: never }) &
  (GetChainType<K> extends 'BITCOIN' ? { bound?: BitcoinBoundExtras } : { bound?: never }) & {
    /**
     * Per-action partner-fee override. When present, takes precedence over the config-level
     * `bridgePartnerFee` for this call, so an integrator can charge (and route) its own fee per bridge.
     * Omit to use the configured fee. Chain-agnostic (unlike `srcPublicKey`/`bound`).
     */
    partnerFee?: PartnerFee;
  };

export type BridgeParams<ChainKey extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  ChainKey,
  Raw,
  CreateBridgeIntentParams<ChainKey>,
  BridgeExtras<ChainKey>
>;

export type BridgeServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
  spoke: SpokeService;
  backendApi: BackendApiService;
};

/**
 * Orchestrates cross-chain token transfers within the SODAX hub-and-spoke architecture.
 *
 * Bridging works by depositing tokens into a spoke vault on the source chain, which triggers
 * a cross-chain message relayed to the Sonic hub. The hub then performs vault transformations
 * (deposit/withdraw) and forwards the tokens to the destination chain via the asset manager.
 *
 * Supports three transfer directions:
 * - Spoke → Hub (deposit into hub vault)
 * - Hub → Spoke (withdrawal from hub vault)
 * - Spoke → Spoke (deposit on source + withdraw on destination)
 *
 * The high-level `bridge()` method handles the full lifecycle. For fine-grained control,
 * `createBridgeIntent()` executes only the spoke-side deposit, leaving relay to the caller.
 */
export class BridgeService {
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;
  public readonly spoke: SpokeService;

  // backend bridge-API client
  public readonly backendApi: BackendApiService;

  /**
   * Effective backend submit-tx flow (`bridge.useBackendSubmitTx`, default on). Read live off
   * `ConfigService` like `bridgePartnerFee`, so the config object and the behavior can never disagree.
   */
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
   * Calculates the partner fee deducted from a given bridge input amount.
   *
   * Returns `0n` when no partner fee is configured. `inputAmount` must be in 18-dp hub/vault
   * units — the units the hub deducts the fee in (see `buildBridgeData`) — NOT the spoke token's
   * native base units. This matters for a fixed `PartnerFee.amount`, which is wei-denominated
   * (18 dp); a percentage fee is unit-agnostic.
   *
   * @param inputAmount - Gross amount being bridged, in 18-dp hub/vault units.
   * @returns Fee amount to be deducted, in the same units as `inputAmount`.
   */
  public getFee(inputAmount: bigint, partnerFee: PartnerFee | undefined = this.config.bridgePartnerFee): bigint {
    if (!partnerFee) {
      return 0n;
    }

    return calculateFeeAmount(inputAmount, partnerFee);
  }

  /**
   * Checks whether the caller has sufficient token allowance to execute the bridge.
   *
   * The required spender varies by chain type:
   * - Hub (Sonic): the caller's hub wallet router contract
   * - EVM spoke: the spoke chain's asset manager contract
   * - Stellar: validated by the Stellar spoke service (no explicit spender needed)
   * - All other chain types (e.g. Solana, NEAR, Bitcoin): returns `true` — approvals are not applicable.
   *
   * @param _params - Bridge parameters containing source chain, token, amount, and sender address.
   * @returns `Result<boolean>` — `true` if the allowance covers the bridge amount, `false` otherwise.
   */
  public async isAllowanceValid<S extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<S, Raw>,
  ): Promise<Result<boolean, BridgeAllowanceCheckError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey };
    try {
      bridgeInvariant(params.amount > 0n, 'Amount must be greater than 0', { ...baseCtx, field: 'amount' });
      bridgeInvariant(params.srcToken.length > 0, 'Source asset is required', { ...baseCtx, field: 'srcToken' });

      // Compute the underlying Result<boolean> across chain-type paths, then wrap any
      // spoke-layer failure as BRIDGE_ALLOWANCE_CHECK_FAILED at the single return point below.
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
   * Grants token spending approval required before executing a bridge.
   *
   * Approval targets differ by chain:
   * - Hub (Sonic): approves the caller's hub wallet router contract.
   * - EVM spoke: approves the spoke chain's asset manager contract.
   * - Stellar: delegates to the Stellar spoke service for trustline/allowance handling.
   * - All other chain types: returns an error — approvals are not supported.
   *
   * When `raw` is `true` the encoded transaction is returned without broadcasting.
   * When `raw` is `false` the transaction is signed and submitted via the provided wallet provider.
   *
   * @param _params - Bridge parameters including source chain, token, amount, wallet provider, and `raw` flag.
   * @returns `Result<TxReturnType<K, Raw>>` — encoded transaction data (raw) or submitted transaction hash.
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
        const spender = isHubChainKeyType(params.srcChainKey)
          ? await this.hubProvider.getUserHubWalletAddress(params.srcAddress, params.srcChainKey)
          : this.config.getChainConfig(params.srcChainKey).addresses.assetManager;

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

      // Reached only for chains that don't support approval (Solana, NEAR, Bitcoin, etc.).
      // Surface as a validation failure rather than a generic Error so consumers can discriminate.
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
   * Executes a full end-to-end bridge transfer: spoke deposit → relay → hub settlement.
   *
   * Internally calls `createBridgeIntent()` to submit the spoke-side deposit transaction, then
   * completes the transfer via one of two paths. Use this method for the typical "fire and wait" UX.
   *
   * - **Backend submit-tx (default, `bridge.useBackendSubmitTx`), {@link submitTx}:** hands the deposit
   *   to the bridge API, which relays server-side, and polls until `executed`. On ANY non-success it
   *   falls back to the path below — safe because re-relaying is idempotent.
   * - **Client-side (opt-out with `useBackendSubmitTx: false`), {@link fallbackBridgeSteps}:** verifies
   *   the deposit landed on-chain, then relays it and waits for the settlement packet. `verifyTxHash`
   *   runs on this path only; the backend runs its own.
   *
   * For manual relay control (e.g. monitoring or batching), use `createBridgeIntent()` directly
   * and handle the relay step yourself.
   *
   * @param _params - Bridge parameters including source/destination chain keys, token addresses,
   *   amount, recipient address, wallet provider, and an optional `timeout` — a PER-ATTEMPT budget,
   *   not an end-to-end one. The backend attempt gets it, and if that attempt does not complete the
   *   client-side relay wait gets a fresh one starting after verification, so neither a stalled backend
   *   nor a slow source-chain confirmation can shorten it. Worst-case wall-clock is
   *   `createBridgeIntent + timeout + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS)`, where
   *   verification is bounded by the source chain's `pollingConfig.maxTimeoutMs` and intent creation is
   *   not bounded by `timeout` at all. See `docs/BRIDGE.md` § Completion paths and `timeout`.
   * @returns `Result<TxHashPair>` — `{ srcChainTxHash, dstChainTxHash }` on success,
   *   where `srcChainTxHash` is the spoke deposit tx and `dstChainTxHash` is the hub settlement tx.
   *
   * @example
   * const result = await sodax.bridge.bridge({
   *   params: {
   *     srcChainKey: '0x2105.base',
   *     srcAddress: '0x...',
   *     srcToken: '0x...', // source token address on Base
   *     amount: 1000n,
   *     dstChainKey: '0x89.polygon',
   *     dstToken: '0x...', // destination token address on Polygon
   *     recipient: '0x...',
   *   },
   *   raw: false,
   *   walletProvider: evmWalletProvider,
   *   timeout: 30_000, // optional, defaults to 120 000 ms
   * });
   *
   * if (result.ok) {
   *   const { srcChainTxHash, dstChainTxHash } = result.value;
   * }
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
          // CreateBridgeIntentErrorCode ⊂ BridgeOrchestrationErrorCode, so SodaxError narrows correctly.
          if (!created.ok) return { ok: false, error: created.error };

          // `timeout` is a PER-ATTEMPT budget, not an end-to-end one: the backend attempt gets it, and if
          // that attempt fails the client-side relay fallback gets a fresh one. Sharing a single deadline
          // would leave the fallback whatever the backend had not spent, which is how a relay that needs
          // longer than the leftovers ends in RELAY_TIMEOUT. Resolved (not just defaulted) so a non-finite
          // caller value cannot reach either budget — see `resolveTimeoutMs`.
          const timeoutMs = resolveTimeoutMs(_params.timeout, DEFAULT_RELAY_TX_TIMEOUT);

          // Backend submit-tx flow (default on): hand the broadcast spoke-deposit tx to the bridge API, which
          // relays server-side. On ANY non-success we fall back to the client-side relay so the bridge
          // still completes — safe because re-relay is idempotent.
          if (this.useBackendSubmitTx) {
            const submitted = await this.submitTx(_params, created.value, createSubmitTxAttempt(timeoutMs));
            if (submitted.ok) return submitted;
            this.config.logger.warn(
              '[bridge] backend submit-tx did not complete; falling back to the client-side relay',
              { error: submitted.error },
            );
          }

          return this.fallbackBridgeSteps(_params, created.value, timeoutMs);
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
   * Client-side bridge completion (opt-out via `bridge.useBackendSubmitTx: false`): verify the broadcast
   * spoke-deposit tx, then relay it to the hub and wait for the settlement packet. Extracted verbatim from
   * `bridge()` so the backend submit-tx path ({@link submitTx}) can fall back to it on any non-success.
   * Bridge always relays — there is no hub-source short-circuit.
   *
   * Verification belongs to THIS path only: the backend runs its own, so verifying before handing over
   * would delay every backend success by the source chain's confirmation wait and could fail a bridge the
   * backend would have completed.
   */
  private async fallbackBridgeSteps<K extends SpokeChainKey>(
    _params: BridgeParams<K, false>,
    created: IntentTxResult<K, false>,
    timeoutMs: number,
  ): Promise<Result<TxHashPair, BridgeOrchestrationError>> {
    const { params } = _params;
    const baseCtx = { srcChainKey: params.srcChainKey, dstChainKey: params.dstChainKey };

    const settled = await this.spoke.settle({
      chainKey: params.srcChainKey,
      tx: created.tx,
      direction: 'inbound',
      relayData: created.relayData,
      // The caller's full `timeout`, starting HERE — after verification, and whether this runs as the only
      // path or as the backend's fallback. Neither a stalled backend attempt nor a slow source-chain
      // confirmation (Stacks polls for up to its full 120s `maxTimeoutMs`) may shorten the relay wait. The
      // Settlement submits before `timeout` bounds anything, so a zero budget would strand a landed
      // deposit unrelayed. Re-relaying is idempotent.
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
    });

    if (!settled.ok) {
      return {
        ok: false,
        error:
          settled.error.phase === 'verification'
            ? verifyFailed('bridge', settled.error.cause, baseCtx)
            : mapRelayFailure(settled.error.cause, {
                feature: 'bridge',
                action: 'bridge',
                srcChainKey: baseCtx.srcChainKey,
                dstChainKey: baseCtx.dstChainKey,
              }),
      };
    }

    return settled;
  }

  /**
   * Backend bridge path (default via `bridge.useBackendSubmitTx`): hand the broadcast
   * spoke-deposit tx to the bridge API (`POST /bridge/submit-tx`) with the FULL `relayData`
   * envelope; the backend relays server-side. Polls `getSubmitTxStatus` until `executed`, then
   * returns the same {@link TxHashPair} the client-side path returns (`result.dstIntentTxHash` →
   * destination tx hash; bridge has no solver `intent_hash`).
   *
   * Never throws — returns `{ ok: false }` on any non-success (submit `!ok`, terminal `failed` /
   * abandoned, or poll timeout) so `bridge()` falls back to {@link fallbackBridgeSteps}. Falling back
   * is safe: re-relaying an already-relayed bridge tx is idempotent — the relay dedups and returns the
   * existing `executed` packet. It is also load-bearing rather than belt-and-braces: the backend keeps
   * processing after this attempt gives up, so the fallback's relay can race the backend's own.
   *
   * The attempt itself — POST, budget clamps, status poll — is {@link runBackendSubmitTx}, shared with
   * swaps. What is bridge-specific and lives here: the request body (the FULL `relayData` envelope), the
   * `executed` terminal status, the mapping to a {@link TxHashPair}, and the bridge error taxonomy.
   *
   * `attempt` bounds this attempt alone — the POST and every status request draw on it, and the
   * client-side fallback holds a separate fresh `timeout`.
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
        body: {
          txHash: spokeTxHash,
          srcChainKey,
          walletAddress: params.srcAddress,
          // Send the FULL { address, payload } envelope — bridge has no intent.creator for the backend
          // to rebuild the relay address, so dropping it would break split-tx-chain relay.
          relayData,
        },
        statusQuery: { txHash: spokeTxHash, srcChainKey },
        // Bridge terminal success is `executed` (hub-settled) — not the swaps `solved`.
        terminalStatus: 'executed',
        onExecuted: (result): TxHashPair | undefined =>
          result?.dstIntentTxHash ? { srcChainTxHash: spokeTxHash, dstChainTxHash: result.dstIntentTxHash } : undefined,
      });
      // Any non-success — rejected POST, terminal `failed`, spent attempt — becomes the cause bridge()
      // logs before falling back to the client-side relay.
      return outcome.ok
        ? { ok: true, value: outcome.value }
        : { ok: false, error: executionFailed('bridge', outcome.cause, { ...baseCtx, action: 'bridge' }) };
    } catch (error) {
      return { ok: false, error: unknownFailed('bridge', error, { ...baseCtx, action: 'bridge' }) };
    }
  }

  /**
   * Submits the spoke-side deposit transaction that initiates a bridge transfer,
   * without waiting for the cross-chain relay to complete.
   *
   * This is the first step of a bridge operation. After this call succeeds, you must
   * relay the returned `relayData` to the hub (Sonic) via `relayTxAndWaitPacket` or
   * the intent relay API to complete the transfer. The higher-level `bridge()` method
   * does this automatically — use `createBridgeIntent()` only when you need manual relay control.
   *
   * When `raw` is `true`, returns the encoded transaction without broadcasting (useful for
   * transaction simulation or batching). When `raw` is `false`, signs and submits the deposit
   * transaction via the provided wallet provider.
   *
   * Bitcoin is only supported with `raw: false` because it requires the Bound Exchange trading wallet
   * derivation flow.
   *
   * @param _params - Bridge parameters including source/destination chain keys, token addresses,
   *   amount, recipient, wallet provider, `raw` flag, and optional simulation skip flag.
   * @returns `Result<IntentTxResult<K, Raw>>` — on success, `{ tx, relayData }` where
   *   `tx` is the spoke deposit tx hash (or encoded call data when raw), and `relayData`
   *   contains the hub wallet address and encoded hub execution payload needed for relay.
   */
  async createBridgeIntent<K extends SpokeChainKey, Raw extends boolean>(
    _params: BridgeParams<K, Raw>,
  ): Promise<Result<IntentTxResult<K, Raw>, BridgeCreateIntentError>> {
    const { params, skipSimulation, extras } = _params;
    // Per-action `extras.partnerFee` wins over the config-level `bridgePartnerFee` (undefined = no fee).
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

      // Vault can only be used on Sonic
      bridgeInvariant(srcToken, `Unsupported spoke chain (${params.srcChainKey}) token: ${params.srcToken}`, {
        ...baseCtx,
        field: 'srcToken',
      });
      // destination
      bridgeInvariant(dstToken, `Unsupported spoke chain (${params.dstChainKey}) token: ${params.dstToken}`, {
        ...baseCtx,
        field: 'dstToken',
      });
      // Reject unregistered chain keys up front (parity with SwapService.createIntent). Redundant with
      // token resolution for most inputs, but gives a VALIDATION_FAILED tagged with the chain-key field
      // for JS/cast consumers instead of a deeper, less specific failure.
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

      // Native BTC on the Bitcoin chain is denominated in satoshis, so a BTC deposit (source) or BTC
      // delivery (destination) must clear the 546-sat dust limit. Bridging is vault-1:1 across 8-decimal
      // BTC-family tokens, so `amount` equals the satoshi value on both sides.
      if (isNativeBitcoinTransfer(this.config, params.srcChainKey, srcToken)) {
        bridgeInvariant(
          params.amount >= BITCOIN_DUST_SATS,
          `Invalid amount (${params.amount}): below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'amount' },
        );
      }
      if (isNativeBitcoinTransfer(this.config, params.dstChainKey, dstToken)) {
        // The DELIVERED (post-fee) sats are what must clear dust, and the partner fee is deducted on the
        // hub in 18-dp vault units — a fixed `PartnerFee.amount` is wei-denominated, NOT sats. Share
        // `buildBridgeData`'s pipeline rather than restating it, so the guard can't drift from the
        // amount the encoded hub calls actually withdraw.
        const { delivered } = this.computeBridgeAmounts(params.amount, srcToken, dstToken, partnerFee);
        bridgeInvariant(
          delivered >= BITCOIN_DUST_SATS,
          `Post-fee BTC delivery (${delivered}) is below the Bitcoin dust limit of ${BITCOIN_DUST_SATS} sats`,
          { ...baseCtx, field: 'amount' },
        );
      }

      // Stacks addresses can't yield the signer public key at raw-tx build time, so a raw Stacks
      // deposit must carry it up front — mirrors SwapService.createIntent. Without this guard a
      // missing key only surfaces deep in StacksSpokeService.deposit as INTENT_CREATION_FAILED.
      if (isStacksChainKeyType(params.srcChainKey) && _params.raw === true) {
        bridgeInvariant(
          extras?.srcPublicKey !== undefined,
          'srcPublicKey is required for Stacks createBridgeIntent (raw) — the source tx is built unsigned and needs the signer public key',
          { ...baseCtx, field: 'srcPublicKey' },
        );
      }

      const personalAddress = params.srcAddress;
      // Bitcoin: derive the Bound trading wallet for raw and non-raw alike (raw TRADING needs the
      // deposit address; the derivation is a public GET). Wallet-provider + Radfi auth stay non-raw only.
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
        // Bitcoin Bound token; BitcoinSpokeService.deposit falls back to the RadfiProvider instance token when undefined.
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
          tx: txResult.value satisfies TxReturnType<K, Raw> as TxReturnType<K, Raw>,
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
   * Resolves a bridge endpoint's {@link XToken} descriptor from a chain key + token address.
   *
   * Spoke endpoints (and hub-native tokens such as USDC/WETH/S whose on-chain address equals their
   * hub asset) resolve by original asset address. On the hub a caller may instead hold a hub asset
   * that has no spoke-token entry under the hub chain — e.g. a partner BTC fee held as the BTC hub
   * asset, whose only spoke-token entry lives on Bitcoin. Resolve those by hub-asset address so the
   * Sonic-sourced "withdraw directly" bridge can find the matching vault/decimals.
   */
  private resolveBridgeEndpointToken(chainKey: SpokeChainKey, token: string): XToken | undefined {
    const spokeToken = this.config.getSpokeTokenFromOriginalAssetAddress(chainKey, token);
    if (spokeToken) return spokeToken;
    return isHubChainKeyType(chainKey) ? this.config.getXTokenFromHubAsset(token) : undefined;
  }

  /**
   * Post-fee amounts for a bridge, in the units each hub step operates in. Single source for the fee +
   * vault-decimal pipeline, so {@link buildBridgeData}'s encoded hub calls and the BTC-destination dust
   * guard in {@link createBridgeIntent} can never disagree about what actually gets delivered.
   *
   * A spoke endpoint's amount is translated INTO 18-dp vault units on the way in (skipped when the
   * endpoint already IS the vault asset), the partner fee is deducted there — so a fixed
   * `PartnerFee.amount` is wei-denominated, never spoke-denominated — and the remainder is translated
   * back OUT into the destination endpoint's own units.
   *
   * @returns `feeAmount` and `withdrawAmount` in 18-dp vault units (what the hub fee transfer and vault
   *   withdrawal use), and `delivered` in the destination endpoint's units (what the recipient receives).
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

  /**
   * Encodes the hub-side execution payload for a bridge operation.
   *
   * Produces an ABI-encoded sequence of contract calls that the hub wallet router
   * will execute on Sonic after receiving the cross-chain message. The sequence is:
   * 1. (if src is not a vault token) `approve` + `deposit` into the source vault → vault shares
   * 2. (if partner fee configured) `transfer` fee shares to the partner address
   * 3. (if dst is not a vault token) `withdraw` from the destination vault → underlying tokens
   * 4. Transfer to the destination: direct ERC-20 transfer (hub destination) or
   *    asset manager cross-chain transfer (spoke destination), or native S unwrap via `withdrawTo`
   *    when the destination token is the Sonic native token.
   *
   * @param params - Intent parameters carrying source/destination chain keys, token addresses,
   *   amount, and recipient.
   * @param srcToken - Resolved source `XToken` with hub asset and vault addresses.
   * @param dstToken - Resolved destination `XToken` with hub asset and vault addresses.
   * @param partnerFee - Optional partner fee config; if present and non-zero, a fee transfer
   *   call is prepended before the withdrawal step.
   * @returns ABI-encoded `Hex` string representing the ordered call batch for the hub router.
   * @throws When `dstToken` cannot be resolved for the destination chain (invariant).
   */
  buildBridgeData(
    params: CreateBridgeIntentParams,
    srcToken: XToken,
    dstToken: XToken,
    partnerFee: PartnerFee | undefined,
  ): Hex {
    const calls: EvmContractCall[] = [];
    const { feeAmount, withdrawAmount, delivered } = this.computeBridgeAmounts(
      params.amount,
      srcToken,
      dstToken,
      partnerFee,
    );
    // The hub-side asset the partner fee is transferred in: on the no-deposit path the hub asset the
    // spoke deposit delivers to the wallet, overwritten with the vault below when a deposit runs.
    // Never `params.srcToken`: for spoke sources that is a spoke-chain address (base58 on Solana; a
    // codeless address on Sonic for EVM spokes), and only for hub sources does it equal the hub asset.
    let srcVault: `0x${string}` = srcToken.hubAsset;
    // if src asset is not a vault token, we need to approve and deposit into the vault
    if (!this.config.isSodaVaultHubAsset(srcToken.hubAsset)) {
      calls.push(Erc20Service.encodeApprove(srcToken.hubAsset, srcToken.vault, params.amount));
      calls.push(EvmVaultTokenService.encodeDeposit(srcToken.vault, srcToken.hubAsset, params.amount));
      srcVault = srcToken.vault;
    }

    if (partnerFee && feeAmount > 0n) {
      calls.push(Erc20Service.encodeTransfer(srcVault, partnerFee.address, feeAmount));
    }

    // if dst asset is not a vault token, we need to withdraw from the vault
    if (!this.config.isSodaVaultHubAsset(dstToken.hubAsset)) {
      calls.push(EvmVaultTokenService.encodeWithdraw(dstToken.vault, dstToken.hubAsset, withdrawAmount));
    }

    const encodedRecipientAddress = encodeRecipient(params.dstChainKey, params.recipient);
    // If the destination chain is Sonic, we can directly transfer the tokens to the recipient
    if (isHubChainKey(params.dstChainKey)) {
      // If destination token is S, then unwrap and send S to the recipient
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
   * Returns the maximum amount that can currently be bridged between two tokens,
   * taking into account both deposit capacity on the source side and withdrawal liquidity
   * on the destination side.
   *
   * The limit type depends on the transfer direction:
   * - Spoke → Hub: constrained by the source vault's remaining deposit capacity (`DEPOSIT_LIMIT`).
   * - Hub → Spoke: constrained by the asset manager balance on the destination spoke (`WITHDRAWAL_LIMIT`).
   * - Spoke → Spoke: the minimum of the deposit capacity (source) and the asset manager balance
   *   (destination), normalised to a common unit for comparison. The returned `type` indicates
   *   which side is the binding constraint.
   *
   * Returns `{ amount: 0n, type: 'DEPOSIT_LIMIT' }` when the source token is not yet supported
   * by the vault (i.e. `isSupported` is false on a non-hub source chain).
   *
   * @param from - Source `XToken` (chain key + address) to bridge from.
   * @param to - Destination `XToken` (chain key + address) to bridge to.
   * @returns `Result<BridgeLimit>` — `{ amount, decimals, type }` where `amount` is the maximum
   *   bridgeable quantity in the token's native base units and `decimals` is its decimal precision.
   */
  public async getBridgeableAmount(from: XToken, to: XToken): Promise<Result<BridgeLimit, BridgeLookupError>> {
    const baseCtx = { srcChainKey: from.chainKey, dstChainKey: to.chainKey };
    try {
      const fromToken = this.config.getSpokeTokenFromOriginalAssetAddress(from.chainKey, from.address);
      const toToken = this.config.getSpokeTokenFromOriginalAssetAddress(to.chainKey, to.address);

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

      // we need to check the max deposit of the token on the from chain and the asset manager balance on the to chain
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

      // if the from token to be deposited is not supported, we return 0
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

      // spoke -> hub, we need to check the max deposit of the token on the from chain
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

      // hub -> spoke, we need to check the asset manager balance on the to chain
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

      // spoke -> spoke, we need to check the deposit available on the from chain and the withdrawable asset manager balance on the to chain
      const fromTokenDepositedAmount = this.findTokenBalanceInReserves(reserves, from);
      const availableDeposit = fromTokenInfo.maxDeposit - fromTokenDepositedAmount;
      const assetManagerBalance = this.findTokenBalanceInReserves(reserves, to);
      const availableDepositNormalised = BigNumber(availableDeposit).shiftedBy(-fromTokenInfo.decimals);
      const assetManagerBalanceNormalised = BigNumber(assetManagerBalance).shiftedBy(-toTokenInfo.decimals);

      // return the minimum of the deposit available and the withdrawable asset manager balance
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

  /**
   * Determines whether two tokens (potentially on different chains) can be bridged to each other.
   *
   * Two tokens are bridgeable if they resolve to the same vault address on the Sonic hub,
   * meaning they represent the same underlying asset across chains (e.g. USDC on Base and
   * USDC on Arbitrum both map to the same hub vault).
   *
   * Returns `false` — rather than throwing — on any resolution or validation error.
   *
   * @param from - Source `XToken` to bridge from.
   * @param to - Destination `XToken` to bridge to.
   * @param unchecked - When `true`, skips the `isValidSpokeChainKey` guard. Useful for
   *   checking theoretical bridgeability without requiring both chains to be in the active config.
   * @returns `true` if the tokens share the same hub vault; `false` otherwise.
   */
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

      // Get hub asset info for both source and destination assets
      const srcToken = this.config.getSpokeTokenFromOriginalAssetAddress(from.chainKey, from.address);
      const dstToken = this.config.getSpokeTokenFromOriginalAssetAddress(to.chainKey, to.address);

      // Check if both assets are supported and have vault information
      bridgeInvariant(srcToken, `Token not found for token ${from.address} on chain ${from.chainKey}`, {
        srcChainKey: from.chainKey,
        field: 'from',
      });
      bridgeInvariant(dstToken, `Token not found for token ${to.address} on chain ${to.chainKey}`, {
        dstChainKey: to.chainKey,
        field: 'to',
      });

      // Check if the vault addresses are the same (case-insensitive comparison)
      return srcToken.vault.toLowerCase() === dstToken.vault.toLowerCase();
    } catch (error) {
      this.config.logger.error('isBridgeable check failed', error);

      // Return false on any error
      return false;
    }
  }

  /**
   * Returns all tokens on the destination chain that can receive a bridge from the given source token.
   *
   * Filters the destination chain's supported tokens to those that share the same hub vault
   * as the source token, which means they represent the same underlying asset.
   *
   * @param from - Source chain key.
   * @param to - Destination chain key whose supported tokens are searched.
   * @param token - Source token address on `from`.
   * @returns `Result<XToken[]>` — array of destination-chain tokens bridgeable from the source token.
   *   Returns an error result if the source token is not found in the config.
   */
  public getBridgeableTokens(
    from: SpokeChainKey,
    to: SpokeChainKey,
    token: string,
  ): Result<XToken[], BridgeLookupError> {
    const baseCtx = { srcChainKey: from, dstChainKey: to };
    try {
      const srcToken = this.config.getSpokeTokenFromOriginalAssetAddress(from, token);
      bridgeInvariant(srcToken, `Token not found for token ${token} on chain ${from}`, { ...baseCtx, field: 'token' });

      return {
        ok: true,
        value: this.filterTokensWithSameVault(this.config.spokeChainConfig[to].supportedTokens, to, srcToken),
      };
    } catch (error) {
      if (isBridgeLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('bridge', 'getBridgeableTokens', error, baseCtx),
      };
    }
  }

  /**
   * Filters a token map to those that share the same hub vault as `srcToken`.
   *
   * Used by `getBridgeableTokens()` to narrow the destination chain's full token list to only
   * the tokens that are bridgeable from the given source. Each matching token is returned with
   * its `chainKey` set to `to`.
   *
   * @param tokens - Map of raw token entries from the destination chain's config.
   * @param to - Destination chain key; applied to each returned token's `chainKey`.
   * @param srcToken - Resolved source `XToken` to match vaults against. Returns empty array when `undefined`.
   * @returns Array of destination-chain `XToken` instances whose vault matches `srcToken.vault`.
   */
  public filterTokensWithSameVault(
    tokens: Record<string, XToken>,
    to: SpokeChainKey,
    srcToken: XToken | undefined,
  ): XToken[] {
    // Filter tokens that share the same vault as the source asset
    const bridgeableTokens: XToken[] = [];

    for (const token of Object.values(tokens)) {
      const dstToken = this.config.getSpokeTokenFromOriginalAssetAddress(to, token.address);

      if (dstToken && srcToken && dstToken.vault.toLowerCase() === srcToken.vault.toLowerCase()) {
        bridgeableTokens.push({
          ...token,
          chainKey: to,
        });
      }
    }

    return bridgeableTokens;
  }

  /**
   * Looks up a token's balance within a vault's reserve snapshot.
   *
   * Resolves the token to its hub asset address via config, then finds the matching index
   * in `reserves.tokens` (case-insensitive) and returns the corresponding balance from
   * `reserves.balances`. Used by `getBridgeableAmount()` to determine deposit capacity
   * and asset manager withdrawal liquidity.
   *
   * @param reserves - Vault reserve snapshot containing parallel `tokens` and `balances` arrays.
   * @param token - `XToken` whose on-chain balance should be retrieved from the reserves.
   * @returns The token balance held in the vault, in the token's native base units.
   * @throws When the token is not found in config or not present in the reserves snapshot.
   */
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
