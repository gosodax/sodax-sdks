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

/** Stable relay-layer error strings callers match on: a public contract, so add codes rather than rename. */
export const RELAY_ERROR_CODES = {
  /** The spoke tx landed but the relay POST submit call failed (HTTP error, malformed response). */
  SUBMIT_TX_FAILED: 'SUBMIT_TX_FAILED',
  /** Polling worked but the packet never reached `executed` within the timeout. */
  RELAY_TIMEOUT: 'RELAY_TIMEOUT',
  /** Polling itself failed (relay-API outage); the original error is on `error.cause`. */
  RELAY_POLLING_FAILED: 'RELAY_POLLING_FAILED',
} as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[keyof typeof RELAY_ERROR_CODES];

/** Relay HTTP error exposing `status` (e.g. 404 while the relayer hasn't indexed the spoke tx yet). */
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
  // Required for split-tx chains (Solana, Bitcoin); Bitcoin on-demand passes an `OnDemandRelayData` object.
  data?: RelayExtraData | OnDemandRelayData;
  chainKey: SpokeChainKey;
  relayerApiEndpoint: HttpUrl;
  timeout: number | undefined;
  // Poll id when it differs from the submit hash (Bitcoin on-demand polls `od:<keccak256(payload_hex)>`).
  pollTxHash?: string;
};

/** Per-attempt HTTP budget for a single relay request, so a hung connection can't stall polling. */
export const RELAY_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Floor for the relay wait (`Math.max(timeout, floor)`) so an already-landed spoke tx is still relayed.
 * Never derive it from `deadline - Date.now()`: see `docs/SWAPS.md` § How `timeout` bounds each attempt.
 */
export const RELAY_FALLBACK_FLOOR_MS = 5_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

// `response.json()` may reject (malformed body or aborted stream); callers decide how to treat it.
async function parseRelayResponse<T extends RelayAction>(response: Response): Promise<Result<GetRelayResponse<T>>> {
  // A 4xx/5xx with a `{ success: true }` JSON body (buggy gateway/CDN) must not count as success.
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

// Deadline-bounded `get_transaction_packets`: retries only transport rejects and aborts. submit/getPacket
// keep `postRequest` because re-POSTing a delivered request is unsafe.
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
      // A parse error after a delivered response is not retriable.
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
 * Every failure surfaces as `SUBMIT_TX_FAILED` with the underlying error on `error.cause`.
 * An already-relayed tx returns `{ success: true, message: 'Transaction registered' }`.
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
 * `timeoutMs` bounds the whole read (retries and body parse); omitted is unbounded, non-positive fails without a
 * request, non-finite falls back to RELAY_REQUEST_TIMEOUT_MS (deliberately unlike SolverApiService.getStatus).
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

export async function getPacket(
  payload: IntentRelayRequest<'get_packet'>,
  apiUrl: HttpUrl,
): Promise<Result<GetRelayResponse<'get_packet'>>> {
  invariant(payload.params.chain_id.length > 0, 'Invalid input parameters. source_chain_id empty');
  invariant(payload.params.tx_hash.length > 0, 'Invalid input parameters. tx_hash empty');
  invariant(payload.params.conn_sn.length > 0, 'Invalid input parameters. conn_sn empty');

  return postRequest(payload, apiUrl);
}

/** 404 and not-yet-executed packets are `continue`; persistent HTTP/transport failures are `hardError`. */
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
    // 404 means the relayer hasn't indexed the spoke tx yet: keep polling.
    if (txPacketsResult.error instanceof HttpRelayError && txPacketsResult.error.status === 404) {
      return { kind: 'continue' };
    }
    // An abort or a failure past the deadline is a timeout, not an outage: keep polling to end as RELAY_TIMEOUT.
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
    // Resolved, not just defaulted: a NaN timeout would end the loop instantly with RELAY_TIMEOUT.
    const timeout = resolveTimeoutMs(payload.timeout, DEFAULT_RELAY_TX_TIMEOUT);
    const startTime = Date.now();
    // Bounds every fetch, back-off and sleep so the poll never overruns `timeout`; submit is not covered.
    const deadline = startTime + timeout;
    // Distinguishes RELAY_POLLING_FAILED (polling never recovered) from a genuine RELAY_TIMEOUT.
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
        // Sync throws (e.g. invariant on a bad payload) surface as RELAY_POLLING_FAILED, not RELAY_TIMEOUT.
        lastPollingError = e;
      }
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
 * Submits a spoke tx to the relay and waits for its packet; `dst_tx_hash` is the hub tx hash. Fails with
 * SUBMIT_TX_FAILED (funds may be in flight: persist the hash), RELAY_TIMEOUT, or RELAY_POLLING_FAILED (status unknown).
 */
export async function relayTxAndWaitPacket(params: RelayAndWaitParams): Promise<Result<PacketData>> {
  try {
    const { srcTxHash, data, chainKey, relayerApiEndpoint, pollTxHash } = params;
    // A destructuring default fires only on `undefined` and would let NaN through.
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
      srcTxHash: pollTxHash ?? srcTxHash,
      timeout,
      apiUrl: relayerApiEndpoint,
    });
  } catch (error) {
    return { ok: false, error };
  }
}
