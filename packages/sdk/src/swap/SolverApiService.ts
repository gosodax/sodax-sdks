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

/** Caught errors may carry bigints (e.g. viem gas fields), on which `JSON.stringify` would throw. */
const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

/** Stateless HTTP client for the solver `/quote`, `/execute` and `/status` endpoints; use via `SwapService`. */
export class SolverApiService {
  private constructor() {}

  /** Translates spoke tokens to hub assets before quoting; `quoted_amount` is in destination-token base units. */
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

  /** Retried on transient network failures. */
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

  /** `timeoutMs` omitted or non-finite = unbounded; non-positive aborts immediately. Expiry surfaces as `UNKNOWN`. */
  public static async getStatus(
    request: SolverIntentStatusRequest,
    config: SolverConfig,
    logger: SodaxLogger = silentLogger,
    timeoutMs?: number,
    apiKey?: string,
  ): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>> {
    invariant(request.intent_tx_hash.length > 0, 'Empty intent_tx_hash');
    // `setTimeout` coerces NaN/Infinity to ~0 and would abort every request; degrade to unbounded instead.
    const budgetMs = timeoutMs !== undefined && Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : undefined;
    // Cleared in `finally`, not after fetch: a response can stall in `json()` after headers arrive.
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
      // Any abort is ours; name it, since `JSON.stringify(DOMException)` is `{}`.
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
