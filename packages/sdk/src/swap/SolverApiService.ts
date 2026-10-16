import { invariant } from '../shared/utils/tiny-invariant.js';
import { retry } from '../shared/utils/shared-utils.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { apiKeyHeader, mergeHeaders } from '../backendApi/api-utils.js';
import { silentLogger } from '../shared/logger.js';
import {
  SolverIntentErrorCode,
  type Result,
  type SodaxLogger,
  type SolverConfig,
  type SolverErrorResponse,
  type SolverExecutionRequest,
  type SolverExecutionResponse,
  type SolverIntentQuoteRequest,
  type SolverIntentQuoteResponse,
  type SolverIntentQuoteResponseRaw,
  type SolverIntentStatusRequest,
  type SolverIntentStatusResponse,
} from '@sodax/types';

/**
 * JSON replacer that coerces `bigint` to its decimal string so error serialization never throws.
 * Caught values are `unknown` and may carry `bigint` fields (e.g. viem errors with gas amounts);
 * `JSON.stringify` throws a `TypeError` on those, which would escape the surrounding catch block.
 */
const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/**
 * Stateless HTTP client for the SODAX solver API.
 *
 * All methods are `static` — this class is never instantiated and holds no state.
 * It encapsulates the three solver API endpoints:
 * - `/quote`    — get a price quote for a token swap
 * - `/execute`  — notify the solver that an intent is live on the hub chain
 * - `/status`   — poll the execution status of a submitted intent
 *
 * `SwapService` delegates all solver API communication to this class. External callers
 * should use `SwapService` rather than calling `SolverApiService` directly.
 */
export class SolverApiService {
  private constructor() {}

  /**
   * Requests a price quote from the solver API (`POST /quote`).
   *
   * Validates that both tokens are supported by the active config, translates spoke-chain token
   * addresses to their hub (Sonic) equivalents, then forwards the request to the solver.
   * The returned `quoted_amount` is in the destination token's smallest unit.
   *
   * @param payload - Quote request with source/destination tokens, chain IDs, amount, and quote type.
   * @param config - Solver endpoint and contract configuration.
   * @param configService - Used to validate tokens and resolve hub asset addresses.
   * @returns A `Result` containing `{ quoted_amount: bigint }` on success, or a
   *   `SolverErrorResponse` (with a `SolverIntentErrorCode`) on failure.
   * @throws Invariant errors for empty fields or unsupported token addresses (thrown before the async request).
   */
  public static async getQuote(
    payload: SolverIntentQuoteRequest,
    config: SolverConfig,
    configService: ConfigService,
  ): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>> {
    invariant(payload.token_src.length > 0, 'Empty token_src');
    invariant(payload.token_src_blockchain_id.length > 0, 'Empty token_src_blockchain_id');
    invariant(payload.token_dst.length > 0, 'Empty token_dst');
    invariant(payload.token_dst_blockchain_id.length > 0, 'Empty token_dst_blockchain_id');
    invariant(payload.amount > 0n, 'amount must be greater than 0');
    invariant(
      configService.isValidOriginalAssetAddress(payload.token_src_blockchain_id, payload.token_src),
      'unsupported token_src for src chain',
    );
    invariant(
      configService.isValidOriginalAssetAddress(payload.token_dst_blockchain_id, payload.token_dst),
      'unsupported token_dst for dst chain',
    );

    const tokenSrc = configService.getSpokeTokenFromOriginalAssetAddress(
      payload.token_src_blockchain_id,
      payload.token_src,
    )?.hubAsset;
    const tokenDst = configService.getSpokeTokenFromOriginalAssetAddress(
      payload.token_dst_blockchain_id,
      payload.token_dst,
    )?.hubAsset;

    invariant(tokenSrc, 'hub asset not found for token_src');
    invariant(tokenDst, 'hub asset not found for token_dst');

    try {
      const response = await fetch(`${config.solverApiEndpoint}/quote`, {
        method: 'POST',
        headers: mergeHeaders({ 'Content-Type': 'application/json' }, apiKeyHeader(configService.apiKey)),
        body: JSON.stringify({
          token_src: tokenSrc,
          token_dst: tokenDst,
          amount: payload.amount.toString(),
          quote_type: payload.quote_type,
        }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: await response.json(),
        };
      }

      const quoteResponse: SolverIntentQuoteResponseRaw = await response.json();

      return {
        ok: true,
        value: {
          quoted_amount: BigInt(quoteResponse.quoted_amount),
        } satisfies SolverIntentQuoteResponse,
      };
    } catch (e: unknown) {
      configService.logger.error(
        '[SolverApiService.getQuote] failed',
        e instanceof Error ? e : new Error(JSON.stringify(e, bigintReplacer)),
      );
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: e ? JSON.stringify(e, bigintReplacer) : 'Unknown error',
          },
        },
      };
    }
  }

  /**
   * Notifies the solver that an intent is live on the hub chain (`POST /execute`).
   *
   * The request body contains only `intent_tx_hash` — the hub-chain transaction hash where
   * the intent was registered. The solver uses this to locate and start filling the intent.
   * The request is retried automatically on transient network failures.
   *
   * @param request - Object containing `intent_tx_hash` (the hub-chain tx hash of the created intent).
   * @param config - Solver endpoint configuration.
   * @param logger - Diagnostics sink; defaults to the silent logger.
   * @param apiKey - Configured backend API key (`config.apiKey`), sent as the `x-api-key` header.
   * @returns A `Result` containing `{ answer: 'OK', intent_hash: Hex }` on success.
   */
  public static async postExecution(
    request: SolverExecutionRequest,
    config: SolverConfig,
    logger: SodaxLogger = silentLogger,
    apiKey?: string,
  ): Promise<Result<SolverExecutionResponse, SolverErrorResponse>> {
    try {
      const response = await retry(() =>
        fetch(`${config.solverApiEndpoint}/execute`, {
          method: 'POST',
          headers: mergeHeaders({ 'Content-Type': 'application/json' }, apiKeyHeader(apiKey)),
          body: JSON.stringify(request),
        }),
      );

      if (!response.ok) {
        return {
          ok: false,
          error: await response.json(),
        };
      }

      return {
        ok: true,
        value: await response.json(),
      };
    } catch (e: unknown) {
      logger.error(
        '[SolverApiService.postExecution] failed',
        e instanceof Error ? e : new Error(JSON.stringify(e, bigintReplacer)),
      );
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: e ? JSON.stringify(e, bigintReplacer) : 'Unknown error',
          },
        },
      };
    }
  }

  /**
   * Polls the solver API for the current execution status of an intent (`POST /status`).
   *
   * @param request - Object containing `intent_tx_hash` — the hub-chain tx hash of the intent.
   * @param config - Solver endpoint configuration.
   * @param logger - Diagnostics sink; defaults to the silent logger.
   * @param timeoutMs - Optional budget for the request. Omit it and the call is unbounded, as it has
   *   always been. Supply it when a stalled solver must not hold the caller open — a status read
   *   polled on a short interval, say. An expiry surfaces as `UNKNOWN`, like any other failure.
   *   A non-finite value (`NaN` out of `Number(process.env.X)`, or `Infinity`) is treated as no
   *   budget at all rather than passed to `setTimeout`, which would coerce it to ~0 and fail every
   *   request instantly. A non-positive one is a real budget of zero: the request aborts at once.
   *   The relay's `getTransactionPackets` takes the same parameter but degrades a non-finite value
   *   to its own per-request budget instead; the divergence is deliberate, and explained inline.
   * @param apiKey - Configured backend API key (`config.apiKey`), sent as the `x-api-key` header.
   * @returns A `Result` containing `{ status: SolverIntentStatusCode, fill_tx_hash?: string }`.
   *   `fill_tx_hash` is set only when `status === SolverIntentStatusCode.SOLVED (3)`.
   * @throws Invariant error if `intent_tx_hash` is empty (thrown before the async request).
   */
  public static async getStatus(
    request: SolverIntentStatusRequest,
    config: SolverConfig,
    logger: SodaxLogger = silentLogger,
    timeoutMs?: number,
    apiKey?: string,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    invariant(request.intent_tx_hash.length > 0, 'Empty intent_tx_hash');
    // A budget only bounds anything if it is a usable number. `setTimeout` coerces `NaN`/`Infinity`
    // to ~0, so passing one straight through would abort every healthy request on the next tick and
    // report it as a timeout. Degrade to the unbounded call the caller would have got by omitting
    // the argument instead — losing the bound beats failing every request.
    //
    // Not `resolveTimeoutMs`, which the relay's `getTransactionPackets` uses for the same input:
    // that needs a fallback duration, and this endpoint has no per-request budget to name. A
    // constant invented here to absorb bad input would be a policy nobody could justify.
    const budgetMs = timeoutMs !== undefined && Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : undefined;
    // Cleared in `finally`, never between the fetch and the body read: `fetch` resolves as soon as
    // headers arrive, so a response can stall indefinitely in `json()` with the request "complete".
    const controller = budgetMs === undefined ? undefined : new AbortController();
    const timeoutId = controller ? setTimeout(() => controller.abort(), budgetMs) : undefined;
    try {
      const response = await fetch(`${config.solverApiEndpoint}/status`, {
        method: 'POST',
        headers: mergeHeaders({ 'Content-Type': 'application/json' }, apiKeyHeader(apiKey)),
        body: JSON.stringify(request),
        signal: controller?.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: await response.json(),
        };
      }

      return {
        ok: true,
        value: await response.json(),
      };
    } catch (e: unknown) {
      logger.error(
        '[SolverApiService.getStatus] failed',
        e instanceof Error ? e : new Error(JSON.stringify(e, bigintReplacer)),
      );
      // Any abort here is ours — nothing else holds the controller. Name the timeout rather than
      // reporting `JSON.stringify(DOMException)`, which is `{}`.
      return {
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: controller?.signal.aborted
              ? `solver /status timed out after ${budgetMs}ms`
              : e
                ? JSON.stringify(e, bigintReplacer)
                : 'Unknown error',
          },
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
