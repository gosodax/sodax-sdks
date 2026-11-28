/**
 * Tests for the IntentRelayApiService — the HTTP relay client used to submit
 * cross-chain intents and poll for their on-chain delivery.
 *
 * Mirrors the SonicSpokeService.test.ts / BackendApiService.test.ts pattern:
 *   1. `global.fetch` is stubbed once per file via `stubFetch()`. Each `it`
 *      configures its own response with `mockFetch.mockResolvedValueOnce(...)`
 *      / `mockRejectedValueOnce(...)`. `postRequest`'s `retry` (submit / getPacket /
 *      getTransactionPackets) and the polling helper's deadline-aware retry are both
 *      exercised through real code — fetch is the boundary.
 *   2. `describe(function name)` per exported function; one `it` per branch.
 *      Branchy functions (`waitUntilIntentExecuted`, `relayTxAndWaitPacket`)
 *      get nested `happy paths` / `rejects on invalid inputs` / `error
 *      propagation` subgroups.
 *   3. The polling loop in `waitUntilIntentExecuted` uses `vi.useFakeTimers()`
 *      so the 2s `setTimeout` between polls and the wall-clock `Date.now()`
 *      timeout check fire instantly. Tests that exercise the loop drive it
 *      with `vi.advanceTimersByTimeAsync(...)`.
 *   4. The static `RelayChainIdMap` (BSC_MAINNET → 4n) is referenced through
 *      the real `getIntentRelayChainId` so a mutation in `relayTxAndWaitPacket`
 *      that drops the `.toString()` or swaps the chain key surfaces here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, DEFAULT_RELAY_TX_TIMEOUT, type Hex, type HttpUrl, type Result } from '@sodax/types';
import {
  getPacket,
  getTransactionPackets,
  type IntentRelayRequest,
  type GetTransactionPacketsResponse,
  type PacketData,
  relayTxAndWaitPacket,
  submitTransaction,
  type SubmitTxResponse,
  waitUntilIntentExecuted,
} from './IntentRelayApiService.js';
import { abortingFetch, httpErrorResponse, okResponse, stubFetch } from '../../../test-utils/fetch.js';

// --- fetch stub -----------------------------------------------------------
//
// `postRequest` wraps `fetch` in `retry(...)` and parses the body once outside the retry; the
// polling path (`pollTransactionPackets`) adds a per-attempt `AbortSignal` + deadline. For a
// successful response the first attempt resolves, so a one-shot `mockResolvedValueOnce` is enough.
// Tests that exercise retry exhaustion or polling iterations switch to fake timers and advance
// through the 2s back-off explicitly.
const mockFetch = stubFetch();

// --- fixtures -------------------------------------------------------------

const API_URL = 'https://relay.example.com/v1' as HttpUrl;
const SPOKE_TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const CHAIN_ID = '4'; // BSC_MAINNET relay id — matches getIntentRelayChainId(BSC) and packet src_chain_id
const CONN_SN = '42';

// HTTP-error response: `postRequest` short-circuits before calling `json()`, but reads
// `statusText` and `text()` for diagnostic context.
const relayHttpError = (status: number, statusText: string, body = '') => ({
  ...httpErrorResponse(status, body),
  statusText,
});

/** Asserts `result` failed and returns its error. The relay client fails with plain `Error`s, not `SodaxError`s. */
function errorOf(result: Result<unknown>): Error {
  if (result.ok) expect.fail('expected an error, got ok');
  expect(result.error).toBeInstanceOf(Error);
  return result.error as Error;
}

const buildPacket = (overrides: Partial<PacketData> = {}): PacketData => ({
  // Source chain matches the polled `intentRelayChainId` (CHAIN_ID) so the attribution cross-check
  // in `pollForExecutedPacket` accepts the packet; tests that exercise the guard override this.
  src_chain_id: Number(CHAIN_ID),
  src_tx_hash: SPOKE_TX_HASH,
  src_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'executed',
  dst_chain_id: 146,
  conn_sn: 1,
  dst_address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  dst_tx_hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  signatures: ['sig1', 'sig2'],
  payload: '0xpayload',
  ...overrides,
});

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// =========================================================================
// submitTransaction — POST + invariants on chain_id / tx_hash
// =========================================================================

describe('submitTransaction', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH };

  it('POSTs the JSON-stringified payload, including optional `data`, and returns ok:true wrapping the parsed body', async () => {
    const responseBody: SubmitTxResponse = { success: true, message: 'Transaction submitted' };
    mockFetch.mockResolvedValueOnce(okResponse(responseBody));

    // `data` is used by Solana's split-tx flow: the full instruction blob ships off-chain.
    const data = { address: '0xhub' as Hex, payload: '0xpayload' as Hex };
    const payload: IntentRelayRequest<'submit'> = { action: 'submit', params: { ...baseParams, data } };
    const result = await submitTransaction(payload, API_URL);

    expect(result).toEqual({ ok: true, value: responseBody });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(JSON.parse(mockFetch.mock.calls[0]?.[1].body).params.data).toEqual(data);
  });

  describe('error mapping', () => {
    it('wraps an HTTP 5xx, a relayer-side success:false and a network failure as SUBMIT_TX_FAILED with the detail on .cause', async () => {
      vi.useFakeTimers();
      // postRequest short-circuits on !response.ok, so a 5xx with a `{ success: true }` body is not accepted.
      mockFetch.mockResolvedValueOnce(relayHttpError(500, 'Internal Server Error', 'gateway exploded'));

      const httpError = errorOf(await submitTransaction({ action: 'submit', params: baseParams }, API_URL));
      expect(httpError.message).toBe('SUBMIT_TX_FAILED');
      const cause = httpError.cause as Error;
      expect(cause).toBeInstanceOf(Error);
      expect(cause.message).toContain('HTTP 500');
      expect(cause.message).toContain('Internal Server Error');
      expect(cause.message).toContain('gateway exploded');

      // A 200 OK whose body says the relayer rejected the submission.
      const rejection: SubmitTxResponse = {
        success: false,
        message: 'Invalid input parameters. must contain source_chain_id and tx_hash',
      };
      mockFetch.mockResolvedValueOnce(okResponse(rejection));

      const rejected = errorOf(await submitTransaction({ action: 'submit', params: baseParams }, API_URL));
      expect(rejected.message).toBe('SUBMIT_TX_FAILED');
      expect((rejected.cause as Error).message).toBe(rejection.message);

      // Persistent fetch rejection: retry() exhausts attempts and rethrows; postRequest's
      // catch returns ok:false; submitTransaction now wraps as SUBMIT_TX_FAILED rather than
      // propagating raw (so swap's mapper sees the canonical code, not relayCode: 'UNKNOWN').
      const networkError = new Error('socket hang up');
      mockFetch.mockRejectedValue(networkError);

      const promise = submitTransaction({ action: 'submit', params: baseParams }, API_URL);
      // retry() does 3 attempts × 2s back-off = 6s total before rethrowing.
      await vi.advanceTimersByTimeAsync(6_000);
      const network = errorOf(await promise);
      expect(network.message).toBe('SUBMIT_TX_FAILED');
      expect(network.cause).toBe(networkError);
    });

    it('does not re-POST when the response body fails to parse (no duplicate submit)', async () => {
      // A parse failure must not retry the POST — the relay may have already accepted the submit.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
      });

      const result = await submitTransaction({ action: 'submit', params: baseParams }, API_URL);

      expect(errorOf(result).message).toBe('SUBMIT_TX_FAILED');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// =========================================================================
// getTransactionPackets — POST + invariants on chain_id / tx_hash
// =========================================================================

describe('getTransactionPackets', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH };

  describe('happy paths', () => {
    it('POSTs and returns ok:true wrapping the parsed body verbatim, packets or none, with a signal only when bounded', async () => {
      const responseBody: GetTransactionPacketsResponse = {
        success: true,
        data: [buildPacket()],
      };
      mockFetch.mockResolvedValueOnce(okResponse(responseBody));

      const payload: IntentRelayRequest<'get_transaction_packets'> = {
        action: 'get_transaction_packets',
        params: baseParams,
      };
      const result = await getTransactionPackets(payload, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // `{ success: true, data: [] }` while the tx is pending: the polling loop depends on this exact shape.
      const empty: GetTransactionPacketsResponse = { success: true, data: [] };
      mockFetch.mockResolvedValueOnce(okResponse(empty));
      expect(await getTransactionPackets(payload, API_URL)).toEqual({ ok: true, value: empty });

      // A `timeoutMs` switches onto the bounded path, which adds only the abort signal.
      mockFetch.mockResolvedValueOnce(okResponse(empty));
      await getTransactionPackets(payload, API_URL, 5_000);
      expect(mockFetch).toHaveBeenLastCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: expect.any(AbortSignal),
      });
    });
  });

  // `timeoutMs` switches the read onto the deadline-aware path. The no-timeout tests above are the
  // other half of this contract: they assert the legacy request shape (no `signal`) is untouched.
  describe('bounded reads (timeoutMs)', () => {
    const payload: IntentRelayRequest<'get_transaction_packets'> = {
      action: 'get_transaction_packets',
      params: baseParams,
    };

    it('settles at the deadline when the connection hangs or the response body stalls after headers', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(abortingFetch);

      const promise = getTransactionPackets(payload, API_URL, 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      const error = errorOf(result);
      expect(error.name).toBe('AbortError');
      // The budget caps the attempt AND is spent by it — one request, no retry overrun past it.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // `fetch` resolves as soon as headers land; only a timer still armed over `json()` catches this.
      mockFetch.mockImplementation((url: unknown, init: RequestInit) =>
        Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => abortingFetch(url, init) }),
      );

      const stalled = getTransactionPackets(payload, API_URL, 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const stalledResult = await stalled;

      const stalledResultError = errorOf(stalledResult);
      expect(stalledResultError.name).toBe('AbortError');
    });

    // A caller who mistypes a budget asked for a bound, so they get this module's own per-request
    // one — not `DEFAULT_RELAY_TX_TIMEOUT`, which is sized for the packet wait loop and would buy
    // three 15s attempts before the retry cap ended it.
    it('falls back to the per-request budget when the value is non-finite, and fails without a request when non-positive', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(abortingFetch);

      const promise = getTransactionPackets(payload, API_URL, Number.NaN);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      errorOf(result);
      // One attempt: the fallback budget equals the per-attempt cap, so it is spent in full by it.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // No budget left to spend, so there is nothing to spend it on. Documented, not floored —
      // a floor would be a second timeout policy invented here.
      mockFetch.mockReset();
      const noBudget = await getTransactionPackets(payload, API_URL, 0);

      errorOf(noBudget);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// Input invariants shared by submitTransaction / getTransactionPackets / getPacket
// =========================================================================

describe('relay request invariants', () => {
  it('submitTransaction, getTransactionPackets (bounded or not) and getPacket throw on an empty id before any request or budget is consumed', async () => {
    const SRC_EMPTY = 'Invalid input parameters. source_chain_id empty';
    const TX_EMPTY = 'Invalid input parameters. tx_hash empty';
    const rows: Array<[label: string, call: () => Promise<unknown>, message: string]> = [
      [
        'submit chain_id',
        () => submitTransaction({ action: 'submit', params: { chain_id: '', tx_hash: SPOKE_TX_HASH } }, API_URL),
        SRC_EMPTY,
      ],
      [
        'submit tx_hash',
        () => submitTransaction({ action: 'submit', params: { chain_id: CHAIN_ID, tx_hash: '' } }, API_URL),
        TX_EMPTY,
      ],
      [
        'packets chain_id',
        () =>
          getTransactionPackets(
            { action: 'get_transaction_packets', params: { chain_id: '', tx_hash: SPOKE_TX_HASH } },
            API_URL,
          ),
        SRC_EMPTY,
      ],
      [
        'packets tx_hash',
        () =>
          getTransactionPackets(
            { action: 'get_transaction_packets', params: { chain_id: CHAIN_ID, tx_hash: '' } },
            API_URL,
          ),
        TX_EMPTY,
      ],
      [
        'bounded packets tx_hash',
        () =>
          getTransactionPackets(
            { action: 'get_transaction_packets', params: { chain_id: CHAIN_ID, tx_hash: '' } },
            API_URL,
            5_000,
          ),
        TX_EMPTY,
      ],
      [
        'packet chain_id',
        () =>
          getPacket(
            { action: 'get_packet', params: { chain_id: '', tx_hash: SPOKE_TX_HASH, conn_sn: CONN_SN } },
            API_URL,
          ),
        SRC_EMPTY,
      ],
      [
        'packet tx_hash',
        () =>
          getPacket({ action: 'get_packet', params: { chain_id: CHAIN_ID, tx_hash: '', conn_sn: CONN_SN } }, API_URL),
        TX_EMPTY,
      ],
      [
        'packet conn_sn',
        () =>
          getPacket(
            { action: 'get_packet', params: { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH, conn_sn: '' } },
            API_URL,
          ),
        'Invalid input parameters. conn_sn empty',
      ],
    ];
    for (const [label, call, message] of rows) {
      await expect(call(), label).rejects.toThrow(message);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =========================================================================
// waitUntilIntentExecuted — polling loop, status filter, timeout, error swallow
// =========================================================================

describe('waitUntilIntentExecuted', () => {
  const baseInput = {
    intentRelayChainId: CHAIN_ID,
    srcTxHash: SPOKE_TX_HASH,
    apiUrl: API_URL,
  };

  describe('non-finite caller timeout', () => {
    // `payload.timeout ?? DEFAULT` catches only `undefined`, so a NaN used to reach
    // `while (Date.now() - startTime < NaN)` — false on its first evaluation. The wait then returned
    // RELAY_TIMEOUT within milliseconds, having polled zero times, on a tx already broadcast on-chain.
    // This is the funnel every feature's relay wait passes through (money market, staking, migration,
    // cancelIntent, and the swap/bridge fallbacks), so the guard belongs here rather than per caller.
    it('polls normally on a NaN or Infinity timeout instead of giving up instantly', async () => {
      for (const timeout of [Number.NaN, Number.POSITIVE_INFINITY]) {
        mockFetch.mockReset();
        const packet = buildPacket({ status: 'executed' });
        mockFetch.mockResolvedValueOnce(
          okResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
        );

        const result = await waitUntilIntentExecuted({ ...baseInput, timeout });

        expect(result).toEqual({ ok: true, value: packet });
        expect(mockFetch).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('happy paths', () => {
    it('returns the executed packet on the first poll, matching src_tx_hash case-insensitively', async () => {
      // Relayers normalize hashes inconsistently; the service lowercases both sides before comparing.
      const packet = buildPacket({ src_tx_hash: SPOKE_TX_HASH.toUpperCase(), status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        okResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted({ ...baseInput, srcTxHash: SPOKE_TX_HASH });

      expect(result).toEqual({ ok: true, value: packet });
      // First poll succeeded — no setTimeout / no second fetch.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('selects the matching packet past unrelated hashes, wrong-chain packets and malformed entries', async () => {
      // Relay data is runtime-untrusted: a null element or a bad-typed hash must be skipped, not thrown on.
      const unrelated = buildPacket({ src_tx_hash: `0x${'f'.repeat(64)}`, status: 'executed' });
      const wrongChain = buildPacket({ status: 'executed', src_chain_id: 999 });
      const badHash = { src_chain_id: Number(CHAIN_ID), src_tx_hash: null, status: 'executed', dst_tx_hash: '0xabc' };
      const target = buildPacket({ src_tx_hash: SPOKE_TX_HASH, status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        okResponse({ success: true, data: [unrelated, wrongChain, null, badHash, target] }),
      );

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: target });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('keeps polling until the packet is executed', () => {
    it('polls again on success:false, an empty array, an unmatched hash, or a not-yet-executed status', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(okResponse({ success: false, data: [] }))
        .mockResolvedValueOnce(okResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse))
        .mockResolvedValueOnce(
          okResponse({
            success: true,
            data: [buildPacket({ src_tx_hash: `0x${'a'.repeat(64)}`, status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          okResponse({
            success: true,
            data: [buildPacket({ status: 'pending' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          okResponse({
            success: true,
            data: [buildPacket({ status: 'validating' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          okResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      // Six iterations → five 2s back-offs.
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it('emits RELAY_POLLING_FAILED with the cause when the loop body throws or getTransactionPackets returns ok:false', async () => {
      // A caller-supplied `selectPacket` that throws is captured and surfaced as RELAY_POLLING_FAILED,
      // not a misleading RELAY_TIMEOUT after the wall-clock fires.
      vi.useFakeTimers();
      const boom = new Error('selectPacket blew up');
      mockFetch.mockResolvedValue(
        okResponse({
          success: true,
          data: [buildPacket({ status: 'executed' })],
        } satisfies GetTransactionPacketsResponse),
      );

      const promise = waitUntilIntentExecuted({
        ...baseInput,
        timeout: 1_000,
        selectPacket: () => {
          throw boom;
        },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      const thrown = errorOf(result);
      expect(thrown.message).toBe('RELAY_POLLING_FAILED');
      expect(thrown.cause).toBe(boom);

      // postRequest wraps fetch in `retry` (3 attempts, 2s back-off). After all
      // attempts reject, `retry` rethrows, postRequest's catch returns
      // `{ ok: false, error }`, and waitUntilIntentExecuted breaks the polling
      // loop and surfaces RELAY_POLLING_FAILED so operators can distinguish
      // "polling endpoint outage" from "packet never delivered" (RELAY_TIMEOUT).
      const networkError = new Error('network down');
      mockFetch.mockReset();
      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError);

      const outagePromise = waitUntilIntentExecuted(baseInput);
      // 3 retry attempts × 2s back-off = 6s; loop exits before the 2s polling pause.
      await vi.advanceTimersByTimeAsync(6_000);
      const outage = errorOf(await outagePromise);
      expect(outage.message).toBe('RELAY_POLLING_FAILED');
      expect(outage.cause).toBe(networkError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('continues polling on HTTP 404 ("packet not found") and returns the packet once it lands', async () => {
      // The relayer returns HTTP 404 with `{success: false, message: "requested packet not found"}`
      // while the spoke tx hasn't yet been indexed — exactly the condition we are polling to outlast.
      // A 404 must NOT short-circuit the loop into RELAY_POLLING_FAILED; we must keep polling until
      // either the packet appears or the wall-clock timeout fires.
      vi.useFakeTimers();
      const packet = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(
          relayHttpError(404, 'Not Found', '{"success":false,"message":"requested packet not found"}'),
        )
        .mockResolvedValueOnce(okResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted(baseInput);
      // First poll = 404 → continue → 2s sleep → second poll succeeds.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result).toEqual({ ok: true, value: packet });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('emits RELAY_TIMEOUT (not RELAY_POLLING_FAILED) when every poll returns HTTP 404 until the timeout fires', async () => {
      // 404 spam alone is not a polling outage — it just means the packet was never indexed.
      // After the timeout window, the post-loop branch must fall through to RELAY_TIMEOUT with
      // no cause, NOT RELAY_POLLING_FAILED. This pins the "404 does not set lastPollingError"
      // contract so a regression that re-classifies 404 as fatal would surface here.
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(
        relayHttpError(404, 'Not Found', '{"success":false,"message":"requested packet not found"}'),
      );

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      // First poll = 404 → continue → 2s sleep → loop check 2s ≥ 1s → exit via TIMEOUT.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      const error = errorOf(result);
      expect(error.message).toBe('RELAY_TIMEOUT');
      // Crucial: no `cause` — 404s must not have been recorded as a polling error.
      expect(error.cause).toBeUndefined();
      // The explicit timeout ends the wait after one poll.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('emits RELAY_POLLING_FAILED with the 5xx cause when a 404 is followed by a real outage (5xx)', async () => {
      // Confirms the 404-tolerance does not mask genuine outages: if 404 polling is followed
      // by a 5xx, the 5xx still breaks the loop and is the recorded cause. Without this, a
      // regression that swallowed all HTTP errors would silently mask relayer downtime.
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(
          relayHttpError(404, 'Not Found', '{"success":false,"message":"requested packet not found"}'),
        )
        .mockResolvedValueOnce(relayHttpError(503, 'Service Unavailable', 'upstream is down'));

      const promise = waitUntilIntentExecuted(baseInput);
      // First poll = 404 → continue → 2s sleep → second poll = 503 → break.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      const error = errorOf(result);
      expect(error.message).toBe('RELAY_POLLING_FAILED');
      const cause = error.cause as Error;
      expect(cause.message).toContain('HTTP 503');
      expect(cause.message).toContain('upstream is down');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('timeout', () => {
    it('returns ok:false RELAY_TIMEOUT immediately when timeout is 0 (loop body never enters)', async () => {
      // `Date.now() - startTime < timeout` is `0 < 0` → false on first check.
      // No fetch is issued; no setTimeout fires. This pins the strict-`<` boundary
      // so a mutation to `<=` would surface (it'd attempt one poll first).
      const result = await waitUntilIntentExecuted({ ...baseInput, timeout: 0 });

      const error = errorOf(result);
      expect(error.message).toBe('RELAY_TIMEOUT');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to DEFAULT_RELAY_TX_TIMEOUT when payload.timeout is omitted', async () => {
      vi.useFakeTimers();
      // Fail every poll so the loop exits via the timeout branch.
      mockFetch.mockResolvedValue(okResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted(baseInput);

      // Advance just under the default → loop should still be running.
      await vi.advanceTimersByTimeAsync(DEFAULT_RELAY_TX_TIMEOUT - 2_000);
      let settled = false;
      promise.then(() => {
        settled = true;
      });
      // Yield a microtask so any imminent settle propagates.
      await Promise.resolve();
      expect(settled).toBe(false);

      // Push past the default → loop must exit and resolve to RELAY_TIMEOUT.
      await vi.advanceTimersByTimeAsync(4_000);
      const result = await promise;

      const error = errorOf(result);
      expect(error.message).toBe('RELAY_TIMEOUT');
    });

    it('outer try/catch: forwards a thrown Date.now() failure as ok:false (defensive path)', async () => {
      // The inner try/catch wraps only the fetch — `Date.now()` and `setTimeout`
      // sit in the outer try. This pins the outer catch so a mutation that
      // removes it (or rethrows) would surface here.
      const dateError = new Error('clock unavailable');
      vi.spyOn(Date, 'now').mockImplementationOnce(() => {
        throw dateError;
      });

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: false, error: dateError });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // Deadline-aware timeout (#4 sdk-intent-relay:H-2) + packet attribution cross-check
  // (#3 sdk-intent-relay:H-1). The genuine-error → RELAY_POLLING_FAILED path and the
  // valid-packet taxonomy are already covered by the suites above.
  describe('deadline budget & attribution hardening (#3 + #4)', () => {
    it('aborts a hung fetch at the per-request budget, then retries to success', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementationOnce(abortingFetch).mockResolvedValueOnce(
        okResponse({
          success: true,
          data: [buildPacket({ status: 'executed' })],
        } satisfies GetTransactionPacketsResponse),
      );

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 60_000 });
      await vi.advanceTimersByTimeAsync(15_000); // per-request abort fires
      await vi.advanceTimersByTimeAsync(2_000); // retry back-off → second attempt
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('stops at the deadline with RELAY_TIMEOUT (not RELAY_POLLING_FAILED) when a fetch hangs or its body stalls', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(abortingFetch);

      const hung = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await hung;

      const error = errorOf(result);
      expect(error.message).toBe('RELAY_TIMEOUT');
      // Per-request budget is capped at the time left to the deadline → one attempt, no retry overrun.
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Headers resolve, but the body read never settles unless aborted — the timer must cover it.
      mockFetch.mockImplementation((url: unknown, init: RequestInit) =>
        Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => abortingFetch(url, init) }),
      );

      const stalled = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const stalledResult = await stalled;

      const stalledResultError = errorOf(stalledResult);
      expect(stalledResultError.message).toBe('RELAY_TIMEOUT');
    });

    it('classifies a failure once the deadline has elapsed as RELAY_TIMEOUT, not RELAY_POLLING_FAILED', async () => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(new Error('socket hang up')); // transport reject, retried until deadline

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      const error = errorOf(result);
      expect(error.message).toBe('RELAY_TIMEOUT');
    });

    it('keeps polling on an executed packet it cannot attribute: wrong src_chain_id, empty or non-string dst_tx_hash', async () => {
      vi.useFakeTimers();
      const target = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(
          okResponse({
            success: true,
            data: [buildPacket({ status: 'executed', src_chain_id: 999 })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          okResponse({
            success: true,
            data: [buildPacket({ status: 'executed', dst_tx_hash: '' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          okResponse({ success: true, data: [{ ...buildPacket({ status: 'executed' }), dst_tx_hash: null }] }),
        )
        .mockResolvedValueOnce(okResponse({ success: true, data: [target] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await promise;

      expect(result).toEqual({ ok: true, value: target });
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });
});

// =========================================================================
// relayTxAndWaitPacket — orchestrates submitTransaction + waitUntilIntentExecuted
// =========================================================================

describe('relayTxAndWaitPacket', () => {
  describe('happy paths', () => {
    it('submits under the stringified relay chain id, then resolves with the executed packet', async () => {
      // BSC_MAINNET → RelayChainIdMap → 4n → '4'. A mutation that drops `.toString()` would leave a bigint.
      const packet = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(okResponse({ success: true, message: 'queued' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(okResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result).toEqual({ ok: true, value: packet });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const submitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(submitBody.action).toBe('submit');
      expect(submitBody.params).toEqual({ chain_id: '4', tx_hash: SPOKE_TX_HASH });
      // No `data` field when none was passed.
      expect(submitBody.params.data).toBeUndefined();
    });

    it('submits RelayExtraData (Solana split-tx) or JSON-object data polled under pollTxHash (Bitcoin on-demand)', async () => {
      const packet = buildPacket({ status: 'executed', src_chain_id: 1 }); // Solana → 1n
      const data = { address: '0xhub' as Hex, payload: '0xinstruction' as Hex };
      mockFetch
        .mockResolvedValueOnce(okResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(okResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data,
        chainKey: ChainKeys.SOLANA_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      const submitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(submitBody.params).toEqual({
        chain_id: '1', // Solana → 1n → '1'
        tx_hash: SPOKE_TX_HASH,
        data,
      });

      mockFetch.mockReset();
      // Bitcoin on-demand borrow/withdraw submit the signed payload (JSON object) under the literal
      // "withdraw" tx_hash, but the relay tracks the packet under a derived id — so polling uses
      // `pollTxHash` (od:<keccak256(payload_hex)>), not "withdraw".
      const onDemandPayload = { payload_hex: '7b22737263', signature: 'aabbcc' };
      const btcPacket = buildPacket({ status: 'executed', src_tx_hash: 'od:deadbeef', src_chain_id: 627463 }); // Bitcoin → 627463n
      mockFetch
        .mockResolvedValueOnce(okResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(
          okResponse({ success: true, data: [btcPacket] } satisfies GetTransactionPacketsResponse),
        );

      const result = await relayTxAndWaitPacket({
        srcTxHash: 'withdraw',
        data: onDemandPayload,
        chainKey: ChainKeys.BITCOIN_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
        pollTxHash: 'od:deadbeef',
      });

      expect(result).toEqual({ ok: true, value: btcPacket });
      const btcSubmitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(btcSubmitBody.params).toEqual({ chain_id: '627463', tx_hash: 'withdraw', data: onDemandPayload });
      // polling uses the relay-derived id, NOT the submit "withdraw"
      const pollBody = JSON.parse(mockFetch.mock.calls[1]?.[1].body);
      expect(pollBody.params.tx_hash).toBe('od:deadbeef');
    });
  });

  describe('error propagation', () => {
    it('returns ok:false SUBMIT_TX_FAILED with cause when the relayer rejects the submission', async () => {
      mockFetch.mockResolvedValueOnce(
        okResponse({ success: false, message: 'invalid tx_hash' } satisfies SubmitTxResponse),
      );

      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      const error = errorOf(result);
      expect(error.message).toBe('SUBMIT_TX_FAILED');
      // The failure message from the relayer is preserved on the underlying cause.
      expect((error.cause as Error).message).toBe('invalid tx_hash');
      // Critical: waitUntilIntentExecuted must NOT have been called.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns ok:false without any request for Solana without data (invariant) or an unknown chain key', async () => {
      // Solana/Bitcoin source chains use a split-tx flow where the on-chain tx
      // carries only a verification hash — the full instruction blob must be
      // shipped via the off-chain `data` field. Omitting `data` for these
      // chains trips an invariant inside `relayTxAndWaitPacket`; the outer
      // try/catch turns it into ok:false with the raw Error.
      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        chainKey: ChainKeys.SOLANA_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      const error = errorOf(result);
      expect(error.message).toMatch(/Data is required/);
      expect(mockFetch).not.toHaveBeenCalled();

      // An unmapped key makes getIntentRelayChainId throw synchronously; the outer try/catch returns it.
      const unknown = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        chainKey: 'unknown_chain' as never,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      errorOf(unknown);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
