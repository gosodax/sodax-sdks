import {
  DEFAULT_MAX_RETRY,
  DEFAULT_RELAY_TX_TIMEOUT,
  DEFAULT_RETRY_DELAY_MS,
  type HttpUrl,
  type Result,
  type SpokeChainKey,
  getIntentRelayChainId,
} from '@sodax/types';
import { invariant } from '../../utils/tiny-invariant.js';
import { resolveTimeoutMs } from '../../utils/resolveTimeoutMs.js';
import { retry } from '../../utils/shared-utils.js';
import type {
  RelayAction,
  RelayExtraData,
  OnDemandRelayData,
  IntentDeliveryInfo,
  IntentRelayRequest,
  WaitUntilIntentExecutedPayload,
  RelayTxStatus,
  PacketData,
} from '../../types/relay-types.js';
import { isBitcoinChainKeyType, isSolanaChainKeyType } from '../../guards.js';

export type {
  RelayAction,
  RelayExtraData,
  OnDemandRelayData,
  IntentDeliveryInfo,
  IntentRelayRequest,
  WaitUntilIntentExecutedPayload,
  RelayTxStatus,
  PacketData,
};

/**
 * Stable error message strings emitted by relay-layer helpers ({@link submitTransaction},
 * {@link relayTxAndWaitPacket}) on failure.
 *
 * **Public contract** — callers across the SDK rely on these literal strings for error
 * discrimination. They MUST NOT be renamed without coordinating callers (see swap module's
 * `mapRelayFailureToSwapError` and the per-module relay-error handling in moneyMarket,
 * bridge, dex, migration, staking).
 */
export const RELAY_ERROR_CODES = {
  /** The spoke tx landed but the relay POST submit call failed (HTTP error, malformed response). */
  SUBMIT_TX_FAILED: 'SUBMIT_TX_FAILED',
  /**
   * Polling completed cleanly but the destination packet never reached `status: 'executed'`
   * within the timeout. Distinguish from {@link RELAY_ERROR_CODES.RELAY_POLLING_FAILED}: this
   * means polling worked, the relay just didn't deliver in time.
   */
  RELAY_TIMEOUT: 'RELAY_TIMEOUT',
  /**
   * Polling itself failed: the polling endpoint kept returning network errors or threw
   * exceptions during the wait window. The original polling error is on `error.cause`.
   * Operators should treat this as a relay-API outage, not a slow packet.
   */
  RELAY_POLLING_FAILED: 'RELAY_POLLING_FAILED',
} as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[keyof typeof RELAY_ERROR_CODES];

/**
 * Structured HTTP error from a relay-layer fetch. Exposes the numeric `status` so
 * callers can discriminate transient/expected statuses (e.g. 404 during polling, where
 * the relayer hasn't indexed the spoke tx yet) from genuine outages without parsing
 * the message string.
 */
export class HttpRelayError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string, body: string) {
    const detail = body ? `${statusText}: ${body.slice(0, 200)}` : statusText;
    super(`HTTP ${status}: ${detail}`);
    this.name = 'HttpRelayError';
    this.status = status;
  }
}

export type SubmitTxParams = {
  chain_id: string;
  tx_hash: string;
  data?: RelayExtraData;
};

export type GetTransactionPacketsParams = {
  chain_id: string;
  tx_hash: string;
};

export type GetPacketParams = {
  chain_id: string;
  tx_hash: string;
  conn_sn: string;
};

export type SubmitTxResponse = {
  success: boolean;
  message: string;
};

export type GetTransactionPacketsResponse = {
  success: boolean;
  data: PacketData[];
};

export type GetPacketResponse =
  | {
      success: true;
      data: PacketData;
    }
  | {
      success: false;
      message: string;
    };

export type GetRelayRequestParamType<T extends RelayAction> = T extends 'submit'
  ? SubmitTxParams
  : T extends 'get_transaction_packets'
    ? GetTransactionPacketsParams
    : T extends 'get_packet'
      ? GetPacketParams
      : never;

export type GetRelayResponse<T extends RelayAction> = T extends 'submit'
  ? SubmitTxResponse
  : T extends 'get_transaction_packets'
    ? GetTransactionPacketsResponse
    : T extends 'get_packet'
      ? GetPacketResponse
      : never;

export type IntentRelayRequestParams = SubmitTxParams | GetTransactionPacketsParams | GetPacketParams;

export type RelayAndWaitParams = {
  srcTxHash: string;
  // Usually `RelayExtraData` ({ address, payload }) for split-tx chains. Bitcoin on-demand
  // borrow/withdraw instead pass the signed payload as an `OnDemandRelayData` JSON object.
  data: RelayExtraData | OnDemandRelayData;
  chainKey: SpokeChainKey;
  relayerApiEndpoint: HttpUrl;
  timeout: number | undefined;
  // Identity used to poll `get_transaction_packets`, when it differs from the submit `srcTxHash`.
  // Bitcoin on-demand submits under tx_hash "withdraw" but the relay tracks the packet under a
  // derived id (`od:<keccak256(payload_hex)>`). Defaults to `srcTxHash` for every other flow.
  pollTxHash?: string;
};

/**
 * Per-attempt HTTP budget — caps a hung connection so it can't hold the polling loop hostage, and
 * the SDK's answer to "how long may a single relay request reasonably take". Exported so a caller
 * bounding its own one-shot read (see {@link getTransactionPackets}'s `timeoutMs`) can adopt that
 * answer instead of inventing a second, tighter one that would abort requests this one tolerates.
 */
export const RELAY_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Minimum `timeout` a feature's client-side relay path passes to {@link relayTxAndWaitPacket}, applied
 * as `Math.max(timeout, RELAY_FALLBACK_FLOOR_MS)` over the caller's own `timeout` — NOT over a remainder.
 * The relay wait is a per-attempt budget that starts when this call does; nothing the caller spent
 * earlier (a backend submit-tx attempt, an on-chain verification) is subtracted from it.
 *
 * The floor exists because `relayTxAndWaitPacket` submits the tx to the relay BEFORE `timeout` bounds
 * anything (only the packet wait is bounded), so a caller passing 0 or a negative `timeout` must not
 * cause the call to be skipped: the spoke tx has already landed on chain and would otherwise sit
 * unrelayed. Re-relay is idempotent, so spending this floor is always safe.
 *
 * Do not reintroduce a `deadline - Date.now()` form here. Deriving the relay budget from elapsed time is
 * what let a stalled backend attempt or a slow source-chain confirmation shrink the wait to this floor
 * and fail chains whose relay legitimately needs longer — see `docs/SWAPS.md` § How `timeout` bounds
 * each attempt.
 */
export const RELAY_FALLBACK_FLOOR_MS = 5_000;

/** Matches the `AbortError` raised when a request is cut off by its per-attempt/deadline budget. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// Reads a relay HTTP response: HTTP error → `HttpRelayError` Result; otherwise the parsed JSON body.
// `response.json()` may reject (malformed body or an aborted stream) — callers decide how to treat it.
async function parseRelayResponse<T extends RelayAction>(response: Response): Promise<Result<GetRelayResponse<T>>> {
  // Guard against HTTP-level failures: a 4xx/5xx that returns a JSON body shaped like
  // `{ success: true, ... }` (buggy gateway, CDN, middleware) would otherwise be treated
  // as a relay success. Aligns with `SolverApiService`, which has always checked this.
  if (!response.ok) {
    const statusText = response.statusText || 'unknown';
    let body = '';
    try {
      body = await response.text();
    } catch {
      // Body read failures are non-fatal — preserve the status info even without it.
    }
    return { ok: false, error: new HttpRelayError(response.status, statusText, body) };
  }
  return { ok: true, value: await response.json() };
}

async function postRequest<T extends RelayAction>(
  payload: IntentRelayRequest<T>,
  apiUrl: string,
): Promise<Result<GetRelayResponse<T>>> {
  try {
    const response = await retry(() =>
      fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );
    return await parseRelayResponse<T>(response);
  } catch (error) {
    return { ok: false, error };
  }
}

// Deadline-bounded `get_transaction_packets`: bounds each attempt AND its body read with an
// `AbortSignal` + `deadline`, so a hung connection or a stalled body can't block the caller. Retries
// only transport rejects and aborts; an HTTP error or a genuine parse error is surfaced without retry.
// Reached from the polling loop and from {@link getTransactionPackets} when a caller supplies a
// timeout (submit/getPacket keep {@link postRequest}, where re-POSTing a delivered request is unsafe).
async function pollTransactionPackets(
  payload: IntentRelayRequest<'get_transaction_packets'>,
  apiUrl: string,
  deadline: number,
): Promise<Result<GetRelayResponse<'get_transaction_packets'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');

  let lastError: unknown;
  for (let attempt = 0; attempt < DEFAULT_MAX_RETRY; attempt++) {
    if (Date.now() >= deadline) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(RELAY_REQUEST_TIMEOUT_MS, deadline - Date.now()));
    let response: Response | undefined;
    try {
      // The timer covers `parseRelayResponse` too — a response can resolve headers but stall the body.
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return await parseRelayResponse<'get_transaction_packets'>(response);
    } catch (error) {
      lastError = error;
      // Retry a transport reject (fetch threw, no response) or an abort (hung connection / hung body).
      // A genuine parse error after a delivered response is not retriable.
      if (response !== undefined && !isAbortError(error)) {
        return { ok: false, error };
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < DEFAULT_MAX_RETRY - 1 && Date.now() < deadline) {
      const backoffMs = Math.min(DEFAULT_RETRY_DELAY_MS, deadline - Date.now());
      if (backoffMs > 0) await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  return { ok: false, error: lastError ?? new Error('Relay polling request failed') };
}

/**
 * Submits a transaction to the intent relay service.
 *
 * @public
 *
 * **Failure contract** — every failure mode (HTTP error, network/transport error, malformed
 * response body, or relayer-reported `success: false`) surfaces as
 * `{ ok: false, error: new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED, { cause }) }`. The
 * underlying error is preserved on `error.cause` for diagnostics. The literal string
 * `'SUBMIT_TX_FAILED'` is part of the public relay-layer contract and is relied on by swap,
 * moneyMarket, bridge, dex, migration, and staking for error discrimination. Renaming
 * requires coordinated updates across all callers — prefer adding a new code to
 * {@link RELAY_ERROR_CODES} over renaming.
 *
 * NOTE: if transaction was already relayed, post request will return { success: true, message: 'Transaction registered' }
 *
 * @param payload - The request payload containing the 'submit' action type and parameters.
 * @param apiUrl - The URL of the intent relay service.
 * @returns The response from the intent relay service.
 */
export async function submitTransaction(
  payload: IntentRelayRequest<'submit'>,
  apiUrl: HttpUrl,
): Promise<Result<GetRelayResponse<'submit'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');

  try {
    const submitResult = await postRequest(payload, apiUrl);

    if (!submitResult.ok) {
      // postRequest's failure modes (HTTP non-2xx, network errors after retries, JSON parse
      // failures) are all submit-side failures from the caller's perspective. Wrap as the
      // canonical SUBMIT_TX_FAILED so swap/moneyMarket/etc. discriminators see one code.
      return {
        ok: false,
        error: new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED, { cause: submitResult.error }),
      };
    }
    const submitTxResponse = submitResult.value;
    if (!submitTxResponse.success) {
      return {
        ok: false,
        error: new Error(RELAY_ERROR_CODES.SUBMIT_TX_FAILED, { cause: new Error(submitTxResponse.message) }),
      };
    }
    return { ok: true, value: submitTxResponse };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Retrieves transaction packets from the intent relay service.
 *
 * @param payload - The request payload containing the 'get_transaction_packets' action type and parameters.
 * @param apiUrl - The URL of the intent relay service.
 * @param timeoutMs - Optional total budget for the read, covering connection setup, retries, back-off
 *   **and** the response-body parse. Omit it and the call is unbounded, as it has always been — a
 *   caller waiting on the relay in its own loop supplies its own bound. Supply it when a stalled
 *   request must not hold the caller open, e.g. a status read polled on a short interval.
 *
 *   The budget truncates retries rather than adding to them: a hung connection consumes the whole
 *   thing in one attempt. A non-positive value therefore leaves no budget to spend and fails
 *   immediately **without issuing a request**. A non-finite one (a `NaN` out of
 *   `Number(process.env.X)`, say) falls back to {@link RELAY_REQUEST_TIMEOUT_MS} — the per-request
 *   budget this module already applies, and so the closest thing to the short bound such a caller
 *   was reaching for. Not `DEFAULT_RELAY_TX_TIMEOUT`: that one is sized for the packet wait loop,
 *   and here it would buy three 15s attempts before the retry cap ended it, ~49s for someone who
 *   asked for a bound and mistyped it.
 *
 *   `SolverApiService.getStatus` takes a `timeoutMs` too but degrades the opposite way, to *no*
 *   bound — it has no per-request budget of its own to fall back on, and inventing one to absorb
 *   bad input would be worse than dropping the bound. The two are deliberately different; read
 *   both before unifying them.
 * @returns The response from the intent relay service.
 */
export async function getTransactionPackets(
  payload: IntentRelayRequest<'get_transaction_packets'>,
  apiUrl: HttpUrl,
  timeoutMs?: number,
): Promise<Result<GetRelayResponse<'get_transaction_packets'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');

  if (timeoutMs === undefined) return postRequest(payload, apiUrl);
  return pollTransactionPackets(payload, apiUrl, Date.now() + resolveTimeoutMs(timeoutMs, RELAY_REQUEST_TIMEOUT_MS));
}

/**
 * Retrieves a packet from the intent relay service.
 * @param payload - The request payload containing the 'get_packet' action type and parameters.
 * @param apiUrl - The URL of the intent relay service.
 * @returns The response from the intent relay service.
 */
export async function getPacket(
  payload: IntentRelayRequest<'get_packet'>,
  apiUrl: HttpUrl,
): Promise<Result<GetRelayResponse<'get_packet'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');
  invariant(payload.params.conn_sn.length > 0, 'Invalid input parameters. conn_sn empty');

  return postRequest(payload, apiUrl);
}

/**
 * Outcome of a single poll attempt inside {@link waitUntilIntentExecuted}.
 *
 * - `found`: the destination packet reached `status: 'executed'` — return success.
 * - `continue`: nothing fatal happened; sleep and re-poll. Includes HTTP 404 (relayer
 *   hasn't yet indexed the spoke tx) and packets that exist but aren't `executed` yet.
 * - `hardError`: persistent HTTP/transport failure (5xx, network errors after retries) —
 *   stop polling and surface RELAY_POLLING_FAILED with `error` as cause.
 */
type PollOutcome = { kind: 'found'; packet: PacketData } | { kind: 'continue' } | { kind: 'hardError'; error: unknown };

async function pollForExecutedPacket(payload: WaitUntilIntentExecutedPayload, deadline: number): Promise<PollOutcome> {
  const txPacketsResult = await pollTransactionPackets(
    {
      action: 'get_transaction_packets',
      params: {
        chain_id: payload.intentRelayChainId,
        tx_hash: payload.srcTxHash,
      },
    },
    payload.apiUrl,
    deadline,
  );

  if (!txPacketsResult.ok) {
    // HTTP 404 is the relayer's normal "spoke tx not yet indexed" response — exactly
    // the condition we are polling to outlast. Keep polling until either the packet
    // appears or the wall-clock timeout fires (→ RELAY_TIMEOUT). 5xx, transport
    // errors, and parse failures fall through to hardError → RELAY_POLLING_FAILED.
    if (txPacketsResult.error instanceof HttpRelayError && txPacketsResult.error.status === 404) {
      return { kind: 'continue' };
    }
    // An abort, or any failure once the deadline has elapsed, is a timeout — not a relay outage.
    // Keep polling so the wall-clock loop ends as RELAY_TIMEOUT, not RELAY_POLLING_FAILED.
    if (isAbortError(txPacketsResult.error) || Date.now() >= deadline) {
      return { kind: 'continue' };
    }
    return { kind: 'hardError', error: txPacketsResult.error };
  }

  const txPackets = txPacketsResult.value;
  if (txPackets.success && txPackets.data.length > 0) {
    // Filter by (src_tx_hash, src_chain_id) before selecting; string-guard the hash so a malformed
    // entry is skipped (not thrown). `selectPacket` disambiguates siblings (defaults to first).
    const candidates = txPackets.data.filter(
      packet =>
        typeof packet?.src_tx_hash === 'string' &&
        packet.src_tx_hash.toLowerCase() === payload.srcTxHash.toLowerCase() &&
        packet.src_chain_id === Number(payload.intentRelayChainId),
    );
    const packet = payload.selectPacket ? payload.selectPacket(candidates) : candidates[0];
    // dst_tx_hash guard hardens against a malformed executed packet (untrusted runtime input).
    if (packet?.status === 'executed' && typeof packet.dst_tx_hash === 'string' && packet.dst_tx_hash.length > 0) {
      return { kind: 'found', packet };
    }
  }
  return { kind: 'continue' };
}

export async function waitUntilIntentExecuted(payload: WaitUntilIntentExecutedPayload): Promise<Result<PacketData>> {
  try {
    // Resolved, not just defaulted: `??` lets a NaN through, and `while (… < NaN)` is false on the
    // first check — an instant RELAY_TIMEOUT on a tx already broadcast. This is the single loop every
    // feature's relay wait funnels into, so guarding it here covers every caller.
    const timeout = resolveTimeoutMs(payload.timeout, DEFAULT_RELAY_TX_TIMEOUT);
    const startTime = Date.now();
    // End-to-end budget for this poll: bounds every fetch, retry back-off, and inter-poll sleep so
    // the call never overruns `timeout`. Submit is separate (single round-trip, not covered here).
    const deadline = startTime + timeout;
    // Track the last observed polling-side failure so the post-loop emit path can distinguish
    // a genuine RELAY_TIMEOUT (polling worked, packet didn't land) from RELAY_POLLING_FAILED
    // (polling never recovered). Without this, both surface identically as RELAY_TIMEOUT.
    let lastPollingError: unknown;

    while (Date.now() - startTime < timeout) {
      try {
        const outcome = await pollForExecutedPacket(payload, deadline);
        if (outcome.kind === 'found') {
          return { ok: true, value: outcome.packet };
        }
        if (outcome.kind === 'hardError') {
          lastPollingError = outcome.error;
          break;
        }
      } catch (e) {
        // Sync exceptions inside the loop body (e.g. invariant fires on bad payload, or a
        // future code path throws). Record so the post-loop path surfaces RELAY_POLLING_FAILED
        // instead of a misleading RELAY_TIMEOUT.
        lastPollingError = e;
      }
      // Inter-poll back-off, capped so we never sleep past the deadline.
      const sleepMs = Math.min(2000, deadline - Date.now());
      if (sleepMs > 0) await new Promise(resolve => setTimeout(resolve, sleepMs));
    }

    if (lastPollingError !== undefined) {
      return {
        ok: false,
        error: new Error(RELAY_ERROR_CODES.RELAY_POLLING_FAILED, { cause: lastPollingError }),
      };
    }
    return { ok: false, error: new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Submit the transaction to the Solver API and wait for it to be executed.
 *
 * @public
 *
 * **Failure contract** — this helper returns `{ ok: false, error: new Error(<CODE>, { cause }) }`
 * with one of two stable code strings on `error.message`. The literal strings are part of the
 * public relay-layer contract (also exported as {@link RELAY_ERROR_CODES}) and are relied on
 * by swap, moneyMarket, bridge, dex, migration, and staking for error discrimination.
 * Renaming requires coordinated updates across all callers.
 *
 * - `RELAY_ERROR_CODES.SUBMIT_TX_FAILED` — the spoke tx landed but the relay submit call
 *   failed (HTTP error, malformed response). Critical: the user's funds may already be in
 *   flight; callers should persist the spokeTxHash and retry submit.
 * - `RELAY_ERROR_CODES.RELAY_TIMEOUT` — submit succeeded, polling worked, but the destination
 *   packet did not reach `status: 'executed'` within `timeout`. The relay was reachable; it
 *   just didn't deliver in time.
 * - `RELAY_ERROR_CODES.RELAY_POLLING_FAILED` — submit succeeded but polling itself never
 *   recovered (persistent network errors or sync exceptions during the wait window). The
 *   packet's actual status is unknown; query the hub directly to confirm. The original
 *   polling error is preserved on `error.cause`.
 *
 * @param spokeTxHash - The transaction hash to submit.
 * @param data - The additional data to submit when relaying the transaction on Solana or Bitcoin.
 *               These chains use split transactions: the on-chain tx contains only a verification hash,
 *               while the full call data is submitted off-chain via the relayer. Contains the destination
 *               address on the Hub chain and the instruction payload. Required for Solana and Bitcoin;
 *               ignored for all other chains.
 * @param chainKey - The chain key identifying the source chain of the transaction.
 * @param timeout - The timeout in milliseconds to wait for the relay packet. Defaults to
 *   `DEFAULT_RELAY_TX_TIMEOUT` (120,000 ms / 120 seconds).
 * @returns A `Result<PacketData>` where `PacketData` contains the relay packet details:
 *   `src_chain_id`, `src_tx_hash`, `src_address`, `dst_chain_id`, `dst_tx_hash`, `dst_address`,
 *   `conn_sn`, `status` (`'executed'` when complete), `payload`, and `signatures`.
 *   Use `dst_tx_hash` as the hub-chain transaction hash for subsequent solver interactions.
 */
export async function relayTxAndWaitPacket(params: RelayAndWaitParams): Promise<Result<PacketData>> {
  try {
    const { srcTxHash, data, chainKey, relayerApiEndpoint, pollTxHash } = params;
    // A destructuring default fires only on `undefined`, so it would pass a NaN straight through to
    // the packet wait. Same guard as {@link waitUntilIntentExecuted}, which this also feeds.
    const timeout = resolveTimeoutMs(params.timeout, DEFAULT_RELAY_TX_TIMEOUT);
    const intentRelayChainId = getIntentRelayChainId(chainKey).toString();

    const isSplitTxChain = isSolanaChainKeyType(chainKey) || isBitcoinChainKeyType(chainKey);
    invariant(!isSplitTxChain || data !== undefined, 'Data is required for Solana and Bitcoin chain keys');

    const submitPayload: IntentRelayRequest<'submit'> = {
      action: 'submit',
      params: isSplitTxChain
        ? {
            chain_id: intentRelayChainId,
            tx_hash: srcTxHash,
            data,
          }
        : {
            chain_id: intentRelayChainId,
            tx_hash: srcTxHash,
          },
    };

    const submitResult = await submitTransaction(submitPayload, relayerApiEndpoint);
    if (!submitResult.ok) return submitResult;

    return await waitUntilIntentExecuted({
      intentRelayChainId,
      // The relay may track the packet under a different id than the submit tx_hash (Bitcoin
      // on-demand: submit "withdraw", poll the derived `od:<hash>`). Defaults to the submit id.
      srcTxHash: pollTxHash ?? srcTxHash,
      timeout,
      apiUrl: relayerApiEndpoint,
    });
  } catch (error) {
    return { ok: false, error };
  }
}
