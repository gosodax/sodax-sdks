/**
 * Tests for the IntentRelayApiService — the HTTP relay client used to submit
 * cross-chain intents and poll for their on-chain delivery.
 *
 * Mirrors the SonicSpokeService.test.ts / BackendApiService.test.ts pattern:
 *   1. `global.fetch` is stubbed once per file via `vi.stubGlobal`. Each `it`
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
import { ChainKeys, DEFAULT_RELAY_TX_TIMEOUT, type Hex, type HttpUrl } from '@sodax/types';
import {
  getPacket,
  getTransactionPackets,
  type IntentRelayRequest,
  type GetPacketResponse,
  type GetTransactionPacketsResponse,
  type PacketData,
  type RelayExtraData,
  relayTxAndWaitPacket,
  submitTransaction,
  type SubmitTxResponse,
  waitUntilIntentExecuted,
} from './IntentRelayApiService.js';

// --- fetch stub -----------------------------------------------------------
//
// `postRequest` wraps `fetch` in `retry(...)` and parses the body once outside the retry; the
// polling path (`pollTransactionPackets`) adds a per-attempt `AbortSignal` + deadline. For a
// successful response the first attempt resolves, so a one-shot `mockResolvedValueOnce` is enough.
// Tests that exercise retry exhaustion or polling iterations switch to fake timers and advance
// through the 2s back-off explicitly.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- fixtures -------------------------------------------------------------

const API_URL = 'https://relay.example.com/v1' as HttpUrl;
const SPOKE_TX_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const CHAIN_ID = '4'; // BSC_MAINNET relay id — matches getIntentRelayChainId(BSC) and packet src_chain_id
const CONN_SN = '42';

// `RelayAndWaitParams.data` is statically typed as required `RelayExtraData`,
// but `relayTxAndWaitPacket`'s invariant only requires it for Solana/Bitcoin
// source chains and the EVM branch never reads it. Tests for non-Solana/Bitcoin
// chains pass `undefined` and rely on this cast — same intent-defeating mock
// pattern the rest of the SDK test suite uses for misaligned param types.
const NO_DATA = undefined as unknown as RelayExtraData;

// Build a `fetch` response stub matching the subset of `Response` that `postRequest` reads:
// `ok`/`status`/`statusText` for the HTTP-level success check, and `json()` for the body.
const jsonResponse = <T>(body: T) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: vi.fn().mockResolvedValue(body),
});

// HTTP-error response: `postRequest` short-circuits before calling `json()`, but reads
// `text()` for diagnostic body context.
const httpErrorResponse = (status: number, statusText: string, body = '') => ({
  ok: false,
  status,
  statusText,
  json: vi.fn(),
  text: vi.fn().mockResolvedValue(body),
});

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

  describe('happy paths', () => {
    it('POSTs JSON-stringified payload to apiUrl and returns ok:true wrapping the parsed body', async () => {
      const responseBody: SubmitTxResponse = { success: true, message: 'Transaction submitted' };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const payload: IntentRelayRequest<'submit'> = { action: 'submit', params: baseParams };
      const result = await submitTransaction(payload, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    });

    it('wraps an HTTP 5xx response as SUBMIT_TX_FAILED with the HTTP detail on .cause', async () => {
      // Asymmetry the SDK previously had: SolverApiService checked response.ok, the relay
      // layer didn't. A 5xx that returned `{ success: true }` body would be silently
      // accepted. postRequest now short-circuits on !response.ok; submitTransaction wraps
      // any postRequest failure as SUBMIT_TX_FAILED so the canonical contract holds.
      mockFetch.mockResolvedValueOnce(httpErrorResponse(500, 'Internal Server Error', 'gateway exploded'));

      const result = await submitTransaction({ action: 'submit', params: baseParams }, API_URL);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      const cause = (result.error as Error).cause as Error;
      expect(cause).toBeInstanceOf(Error);
      expect(cause.message).toContain('HTTP 500');
      expect(cause.message).toContain('Internal Server Error');
      expect(cause.message).toContain('gateway exploded');
    });

    it('wraps a network failure (fetch rejects after retries) as SUBMIT_TX_FAILED with cause', async () => {
      // Persistent fetch rejection: retry() exhausts attempts and rethrows; postRequest's
      // catch returns ok:false; submitTransaction now wraps as SUBMIT_TX_FAILED rather than
      // propagating raw (so swap's mapper sees the canonical code, not relayCode: 'UNKNOWN').
      vi.useFakeTimers();
      const networkError = new Error('socket hang up');
      mockFetch.mockRejectedValue(networkError);

      const promise = submitTransaction({ action: 'submit', params: baseParams }, API_URL);
      // retry() does 3 attempts × 2s back-off = 6s total before rethrowing.
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      expect((result.error as Error).cause).toBe(networkError);
    });

    it('wraps a relayer-side failure (success:false) into ok:false SUBMIT_TX_FAILED with cause', async () => {
      // The HTTP request itself succeeded (200 OK) but the relayer rejected the
      // submission. The service inspects `success` and surfaces a SUBMIT_TX_FAILED
      // error whose `.cause` carries the relayer's message.
      const responseBody: SubmitTxResponse = {
        success: false,
        message: 'Invalid input parameters. must contain source_chain_id and tx_hash',
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await submitTransaction({ action: 'submit', params: baseParams }, API_URL);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      expect(((result.error as Error).cause as Error).message).toBe(responseBody.message);
    });

    it('serializes the optional `data` field into the POST body when provided', async () => {
      // Used by Solana's split-tx flow — the on-chain tx carries only a hash,
      // and the full instruction blob is shipped off-chain via this `data` field.
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' }));

      const data = { address: '0xhub' as Hex, payload: '0xpayload' as Hex };
      const payload: IntentRelayRequest<'submit'> = {
        action: 'submit',
        params: { ...baseParams, data },
      };

      await submitTransaction(payload, API_URL);

      const body = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(body.params.data).toEqual(data);
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

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when chain_id is empty (invariant)', async () => {
      await expect(
        submitTransaction({ action: 'submit', params: { chain_id: '', tx_hash: SPOKE_TX_HASH } }, API_URL),
      ).rejects.toThrow('Invalid input parameters. source_chain_id empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when tx_hash is empty (invariant)', async () => {
      await expect(
        submitTransaction({ action: 'submit', params: { chain_id: CHAIN_ID, tx_hash: '' } }, API_URL),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// getTransactionPackets — POST + invariants on chain_id / tx_hash
// =========================================================================

describe('getTransactionPackets', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH };

  describe('happy paths', () => {
    it('POSTs and returns ok:true wrapping the parsed packets array', async () => {
      const responseBody: GetTransactionPacketsResponse = {
        success: true,
        data: [buildPacket()],
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

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
    });

    it('returns ok:true wrapping success:true with an empty data array (no packets yet)', async () => {
      // The relayer returns `{ success: true, data: [] }` while the tx is still
      // pending. The service must pass this through verbatim — `waitUntilIntentExecuted`
      // depends on the exact shape to drive its polling loop.
      const responseBody: GetTransactionPacketsResponse = { success: true, data: [] };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await getTransactionPackets({ action: 'get_transaction_packets', params: baseParams }, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
    });
  });

  // `timeoutMs` switches the read onto the deadline-aware path. The no-timeout tests above are the
  // other half of this contract: they assert the legacy request shape (no `signal`) is untouched.
  describe('bounded reads (timeoutMs)', () => {
    const payload: IntentRelayRequest<'get_transaction_packets'> = {
      action: 'get_transaction_packets',
      params: baseParams,
    };

    // Never settles on its own; rejects with an AbortError only once its signal aborts, mirroring
    // how the platform `fetch` reacts to an `AbortSignal`.
    const hungFetch = (_url: unknown, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        );
      });

    it('settles at the deadline when the connection hangs', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hungFetch);

      const promise = getTransactionPackets(payload, API_URL, 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).name).toBe('AbortError');
      // The budget caps the attempt AND is spent by it — one request, no retry overrun past it.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('settles at the deadline when the response body stalls after headers arrive', async () => {
      vi.useFakeTimers();
      // `fetch` resolves as soon as headers land; only a timer still armed over `json()` catches this.
      mockFetch.mockImplementation((_url: unknown, opts: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            new Promise((_resolve, reject) =>
              opts.signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              ),
            ),
        }),
      );

      const promise = getTransactionPackets(payload, API_URL, 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).name).toBe('AbortError');
    });

    // A caller who mistypes a budget asked for a bound, so they get this module's own per-request
    // one — not `DEFAULT_RELAY_TX_TIMEOUT`, which is sized for the packet wait loop and would buy
    // three 15s attempts before the retry cap ended it.
    it('falls back to the per-request budget when the value is non-finite', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hungFetch);

      const promise = getTransactionPackets(payload, API_URL, Number.NaN);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      // One attempt: the fallback budget equals the per-attempt cap, so it is spent in full by it.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('fails without issuing a request when the budget is non-positive', async () => {
      // No budget left to spend, so there is nothing to spend it on. Documented, not floored —
      // a floor would be a second timeout policy invented here.
      const result = await getTransactionPackets(payload, API_URL, 0);

      expect(result.ok).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('passes the abort signal through on the bounded path', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));

      await getTransactionPackets(payload, API_URL, 5_000);

      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: expect.any(AbortSignal),
      });
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when chain_id is empty (invariant)', async () => {
      await expect(
        getTransactionPackets(
          { action: 'get_transaction_packets', params: { chain_id: '', tx_hash: SPOKE_TX_HASH } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. source_chain_id empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws before consuming the budget when identifiers are empty', async () => {
      await expect(
        getTransactionPackets(
          { action: 'get_transaction_packets', params: { chain_id: CHAIN_ID, tx_hash: '' } },
          API_URL,
          5_000,
        ),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when tx_hash is empty (invariant)', async () => {
      await expect(
        getTransactionPackets(
          { action: 'get_transaction_packets', params: { chain_id: CHAIN_ID, tx_hash: '' } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// =========================================================================
// getPacket — POST + invariants on chain_id / tx_hash / conn_sn
// =========================================================================

describe('getPacket', () => {
  const baseParams = { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH, conn_sn: CONN_SN };

  describe('happy paths', () => {
    it('POSTs and returns ok:true wrapping success:true with packet data', async () => {
      const responseBody: GetPacketResponse = { success: true, data: buildPacket() };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const payload: IntentRelayRequest<'get_packet'> = { action: 'get_packet', params: baseParams };
      const result = await getPacket(payload, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
      expect(mockFetch).toHaveBeenCalledWith(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    });

    it('returns ok:true wrapping success:false with a message when the relayer cannot find the packet', async () => {
      // GetPacketResponse is a discriminated union — the failure variant carries
      // a `message` instead of `data`. The HTTP call still succeeded, so the
      // service forwards the body verbatim inside an ok:true Result.
      const responseBody: GetPacketResponse = { success: false, message: 'packet not found' };
      mockFetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await getPacket({ action: 'get_packet', params: baseParams }, API_URL);

      expect(result).toEqual({ ok: true, value: responseBody });
    });
  });

  describe('rejects on invalid inputs', () => {
    it('throws when chain_id is empty (invariant)', async () => {
      await expect(
        getPacket(
          { action: 'get_packet', params: { chain_id: '', tx_hash: SPOKE_TX_HASH, conn_sn: CONN_SN } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. source_chain_id empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when tx_hash is empty (invariant)', async () => {
      await expect(
        getPacket({ action: 'get_packet', params: { chain_id: CHAIN_ID, tx_hash: '', conn_sn: CONN_SN } }, API_URL),
      ).rejects.toThrow('Invalid input parameters. tx_hash empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when conn_sn is empty (invariant — distinct from the other two)', async () => {
      await expect(
        getPacket(
          { action: 'get_packet', params: { chain_id: CHAIN_ID, tx_hash: SPOKE_TX_HASH, conn_sn: '' } },
          API_URL,
        ),
      ).rejects.toThrow('Invalid input parameters. conn_sn empty');
      expect(mockFetch).not.toHaveBeenCalled();
    });
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
    it.each([
      { label: 'NaN', value: Number.NaN },
      { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    ])('polls normally on a $label timeout instead of giving up instantly', async ({ value }) => {
      const packet = buildPacket({ status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted({ ...baseInput, timeout: value });

      expect(result).toEqual({ ok: true, value: packet });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('still honours an explicit zero timeout as no budget', async () => {
      // 0 is finite and deliberate — it must keep meaning "do not wait", not fall back to the default.
      const result = await waitUntilIntentExecuted({ ...baseInput, timeout: 0 });

      expect(result.ok).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('happy paths', () => {
    it('returns ok:true with the executed packet on the first poll', async () => {
      const packet = buildPacket({ status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: packet });
      // First poll succeeded — no setTimeout / no second fetch.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('matches src_tx_hash case-insensitively (UPPERCASE relayer response, lowercase request)', async () => {
      // Relayers normalize hashes inconsistently; the service explicitly
      // lowercases both sides before comparing.
      const packet = buildPacket({
        src_tx_hash: SPOKE_TX_HASH.toUpperCase(),
        status: 'executed',
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted({ ...baseInput, srcTxHash: SPOKE_TX_HASH });

      expect(result).toEqual({ ok: true, value: packet });
    });

    it('selects the packet matching src_tx_hash, ignoring unrelated packets in the response', async () => {
      const unrelated = buildPacket({ src_tx_hash: `0x${'f'.repeat(64)}`, status: 'executed' });
      const target = buildPacket({ src_tx_hash: SPOKE_TX_HASH, status: 'executed' });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [unrelated, target],
        } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: target });
    });
  });

  describe('keeps polling until the packet is executed', () => {
    it('polls again when the relayer returns success:false', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: false, data: [] })).mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [buildPacket({ status: 'executed' })],
        } satisfies GetTransactionPacketsResponse),
      );

      const promise = waitUntilIntentExecuted(baseInput);
      // Drive the loop forward: first poll (no match) → 2s setTimeout → second poll (match).
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('polls again when data is an empty array (packet not yet indexed)', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse))
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('polls again when no packet matches src_tx_hash', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ src_tx_hash: `0x${'a'.repeat(64)}`, status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('polls again when the matching packet status is not "executed"', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'pending' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'validating' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed' })],
          } satisfies GetTransactionPacketsResponse),
        );

      const promise = waitUntilIntentExecuted(baseInput);
      // Three iterations → two 2s back-offs.
      await vi.advanceTimersByTimeAsync(4_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('emits RELAY_POLLING_FAILED with the sync exception on .cause when the loop body throws', async () => {
      // A caller-supplied `selectPacket` that throws is captured and surfaced as RELAY_POLLING_FAILED,
      // not a misleading RELAY_TIMEOUT after the wall-clock fires.
      vi.useFakeTimers();
      const boom = new Error('selectPacket blew up');
      mockFetch.mockResolvedValue(
        jsonResponse({
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

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_POLLING_FAILED');
      expect((result.error as Error).cause).toBe(boom);
    });

    it('skips malformed entries (null element or non-string src_tx_hash) and selects a valid packet', async () => {
      // Relay data is runtime-untrusted: a null array element or a bad-typed hash must be skipped,
      // not throw and stop polling — a valid packet later in the same response is still selected.
      const target = buildPacket({ status: 'executed' });
      const badHash = { src_chain_id: Number(CHAIN_ID), src_tx_hash: null, status: 'executed', dst_tx_hash: '0xabc' };
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [null, badHash, target] }));

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: target });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('emits RELAY_POLLING_FAILED when getTransactionPackets HTTP-errors (postRequest checks response.ok)', async () => {
      // The previous code path was silent: a 5xx response with a JSON body would have been
      // accepted as a successful poll. postRequest now short-circuits on !response.ok, and
      // waitUntilIntentExecuted records the HTTP error as lastPollingError → RELAY_POLLING_FAILED.
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(httpErrorResponse(503, 'Service Unavailable', 'upstream is down'));

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      // First poll HTTP-errors → break → POLLING_FAILED.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_POLLING_FAILED');
      const cause = (result.error as Error).cause as Error;
      expect(cause.message).toContain('HTTP 503');
      expect(cause.message).toContain('upstream is down');
    });

    it('emits RELAY_POLLING_FAILED with the underlying error on .cause when getTransactionPackets returns ok:false', async () => {
      vi.useFakeTimers();

      // postRequest wraps fetch in `retry` (3 attempts, 2s back-off). After all
      // attempts reject, `retry` rethrows, postRequest's catch returns
      // `{ ok: false, error }`, and waitUntilIntentExecuted breaks the polling
      // loop and surfaces RELAY_POLLING_FAILED so operators can distinguish
      // "polling endpoint outage" from "packet never delivered" (RELAY_TIMEOUT).
      const networkError = new Error('network down');
      mockFetch
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError);

      const promise = waitUntilIntentExecuted(baseInput);
      // 3 retry attempts × 2s back-off = 6s; loop exits before the 2s polling pause.
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_POLLING_FAILED');
      expect((result.error as Error).cause).toBe(networkError);
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
          httpErrorResponse(404, 'Not Found', '{"success":false,"message":"requested packet not found"}'),
        )
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

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
        httpErrorResponse(404, 'Not Found', '{"success":false,"message":"requested packet not found"}'),
      );

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      // First poll = 404 → continue → 2s sleep → loop check 2s ≥ 1s → exit via TIMEOUT.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
      // Crucial: no `cause` — 404s must not have been recorded as a polling error.
      expect((result.error as Error).cause).toBeUndefined();
    });

    it('emits RELAY_POLLING_FAILED with the 5xx cause when a 404 is followed by a real outage (5xx)', async () => {
      // Confirms the 404-tolerance does not mask genuine outages: if 404 polling is followed
      // by a 5xx, the 5xx still breaks the loop and is the recorded cause. Without this, a
      // regression that swallowed all HTTP errors would silently mask relayer downtime.
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(
          httpErrorResponse(404, 'Not Found', '{"success":false,"message":"requested packet not found"}'),
        )
        .mockResolvedValueOnce(httpErrorResponse(503, 'Service Unavailable', 'upstream is down'));

      const promise = waitUntilIntentExecuted(baseInput);
      // First poll = 404 → continue → 2s sleep → second poll = 503 → break.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_POLLING_FAILED');
      const cause = (result.error as Error).cause as Error;
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

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to DEFAULT_RELAY_TX_TIMEOUT when payload.timeout is omitted', async () => {
      vi.useFakeTimers();
      // Fail every poll so the loop exits via the timeout branch.
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

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

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
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

    it('uses the explicit timeout when provided (returns RELAY_TIMEOUT after one poll)', async () => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      // First poll succeeds (returns no packets), then a 2s setTimeout starts.
      // After advancing 2s, the loop check runs and 2s ≥ 1s → RELAY_TIMEOUT.
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // Deadline-aware timeout (#4 sdk-intent-relay:H-2) + packet attribution cross-check
  // (#3 sdk-intent-relay:H-1). The genuine-error → RELAY_POLLING_FAILED path and the
  // valid-packet taxonomy are already covered by the suites above.
  describe('deadline budget & attribution hardening (#3 + #4)', () => {
    // A fetch that never settles on its own; it rejects with an AbortError only when its signal
    // aborts, mirroring how the platform `fetch` reacts to an `AbortSignal`.
    const hungFetch = (_url: unknown, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        );
      });

    it('aborts a hung fetch at the per-request budget, then retries to success', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementationOnce(hungFetch).mockResolvedValueOnce(
        jsonResponse({
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

    it('stops at the deadline and emits RELAY_TIMEOUT (not RELAY_POLLING_FAILED) when fetches hang', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementation(hungFetch);

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
      // Per-request budget is capped at the time left to the deadline → one attempt, no retry overrun.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('aborts a stalled response body (not just a hung connection) and times out', async () => {
      vi.useFakeTimers();
      // Headers resolve, but the body read never settles unless aborted — the timer must cover it.
      mockFetch.mockImplementation((_url: unknown, opts: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () =>
            new Promise((_resolve, reject) =>
              opts.signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              ),
            ),
        }),
      );

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
    });

    it('classifies a failure once the deadline has elapsed as RELAY_TIMEOUT, not RELAY_POLLING_FAILED', async () => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(new Error('socket hang up')); // transport reject, retried until deadline

      const promise = waitUntilIntentExecuted({ ...baseInput, timeout: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
    });

    it('keeps polling when the executed packet is on a different src_chain_id', async () => {
      vi.useFakeTimers();
      const target = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed', src_chain_id: 999 })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [target] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result).toEqual({ ok: true, value: target });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('selects the correct packet when a wrong-chain packet precedes it in the same response', async () => {
      const target = buildPacket({ status: 'executed' }); // src_chain_id = Number(CHAIN_ID), matches
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: [buildPacket({ status: 'executed', src_chain_id: 999 }), target],
        } satisfies GetTransactionPacketsResponse),
      );

      const result = await waitUntilIntentExecuted(baseInput);

      expect(result).toEqual({ ok: true, value: target });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('keeps polling when the executed packet has an empty or non-string dst_tx_hash', async () => {
      vi.useFakeTimers();
      const target = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: [buildPacket({ status: 'executed', dst_tx_hash: '' })],
          } satisfies GetTransactionPacketsResponse),
        )
        .mockResolvedValueOnce(
          jsonResponse({ success: true, data: [{ ...buildPacket({ status: 'executed' }), dst_tx_hash: null }] }),
        )
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [target] } satisfies GetTransactionPacketsResponse));

      const promise = waitUntilIntentExecuted(baseInput);
      await vi.advanceTimersByTimeAsync(2_000); // empty dst_tx_hash → keep polling
      await vi.advanceTimersByTimeAsync(2_000); // non-string dst_tx_hash → keep polling
      const result = await promise;

      expect(result).toEqual({ ok: true, value: target });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });
});

// =========================================================================
// relayTxAndWaitPacket — orchestrates submitTransaction + waitUntilIntentExecuted
// =========================================================================

describe('relayTxAndWaitPacket', () => {
  describe('happy paths', () => {
    it('submits then resolves with the executed packet from waitUntilIntentExecuted', async () => {
      const packet = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'queued' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result).toEqual({ ok: true, value: packet });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('translates chainKey via getIntentRelayChainId and stringifies it for the submit payload', async () => {
      // BSC_MAINNET → RelayChainIdMap → 4n → '4'. A mutation that drops
      // `.toString()` would leave a bigint in the JSON body and surface here.
      const packet = buildPacket({ status: 'executed' });
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      const submitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(submitBody.action).toBe('submit');
      expect(submitBody.params).toEqual({ chain_id: '4', tx_hash: SPOKE_TX_HASH });
      // No `data` field when undefined was passed.
      expect(submitBody.params.data).toBeUndefined();
    });

    it('includes RelayExtraData in the submit body when provided (Solana split-tx flow)', async () => {
      const packet = buildPacket({ status: 'executed', src_chain_id: 1 }); // Solana → 1n
      const data = { address: '0xhub' as Hex, payload: '0xinstruction' as Hex };
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

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
    });

    it('submits under srcTxHash + JSON-object data but polls under pollTxHash (Bitcoin on-demand)', async () => {
      // Bitcoin on-demand borrow/withdraw submit the signed payload (JSON object) under the literal
      // "withdraw" tx_hash, but the relay tracks the packet under a derived id — so polling uses
      // `pollTxHash` (od:<keccak256(payload_hex)>), not "withdraw".
      const onDemandPayload = { payload_hex: '7b22737263', signature: 'aabbcc' };
      const packet = buildPacket({ status: 'executed', src_tx_hash: 'od:deadbeef', src_chain_id: 627463 }); // Bitcoin → 627463n
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        .mockResolvedValueOnce(jsonResponse({ success: true, data: [packet] } satisfies GetTransactionPacketsResponse));

      const result = await relayTxAndWaitPacket({
        srcTxHash: 'withdraw',
        data: onDemandPayload,
        chainKey: ChainKeys.BITCOIN_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
        pollTxHash: 'od:deadbeef',
      });

      expect(result).toEqual({ ok: true, value: packet });
      const submitBody = JSON.parse(mockFetch.mock.calls[0]?.[1].body);
      expect(submitBody.params).toEqual({ chain_id: '627463', tx_hash: 'withdraw', data: onDemandPayload });
      // polling uses the relay-derived id, NOT the submit "withdraw"
      const pollBody = JSON.parse(mockFetch.mock.calls[1]?.[1].body);
      expect(pollBody.params.tx_hash).toBe('od:deadbeef');
    });

    it('forwards the explicit timeout to waitUntilIntentExecuted', async () => {
      vi.useFakeTimers();
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ success: true, message: 'ok' } satisfies SubmitTxResponse))
        // No packet ever — force the inner loop to time out at the configured value.
        .mockResolvedValue(jsonResponse({ success: true, data: [] } satisfies GetTransactionPacketsResponse));

      const promise = relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: 1_000,
      });
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result.error as Error).message).toBe('RELAY_TIMEOUT');
    });
  });

  describe('error propagation', () => {
    it('returns ok:false SUBMIT_TX_FAILED with cause when the relayer rejects the submission', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: false, message: 'invalid tx_hash' } satisfies SubmitTxResponse),
      );

      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.BSC_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe('SUBMIT_TX_FAILED');
      // The failure message from the relayer is preserved on the underlying cause.
      expect(((result.error as Error).cause as Error).message).toBe('invalid tx_hash');
      // Critical: waitUntilIntentExecuted must NOT have been called.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('catches synchronous failures from getIntentRelayChainId and forwards as ok:false', async () => {
      // `getIntentRelayChainId` does a `RelayChainIdMap[chainKey]` lookup —
      // calling it on a key not in the map yields `undefined` and `.toString()`
      // throws synchronously. The outer try/catch in `relayTxAndWaitPacket`
      // captures this and returns ok:false with the raw error.
      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: 'unknown_chain' as never,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(Error);
      // No HTTP request issued — failure short-circuits before submitTransaction.
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('rejects on invalid inputs', () => {
    it('returns ok:false when chainKey is Solana and data is undefined (invariant)', async () => {
      // Solana/Bitcoin source chains use a split-tx flow where the on-chain tx
      // carries only a verification hash — the full instruction blob must be
      // shipped via the off-chain `data` field. Omitting `data` for these
      // chains trips an invariant inside `relayTxAndWaitPacket`; the outer
      // try/catch turns it into ok:false with the raw Error.
      const result = await relayTxAndWaitPacket({
        srcTxHash: SPOKE_TX_HASH,
        data: NO_DATA,
        chainKey: ChainKeys.SOLANA_MAINNET,
        relayerApiEndpoint: API_URL,
        timeout: undefined,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toMatch(/Data is required/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
