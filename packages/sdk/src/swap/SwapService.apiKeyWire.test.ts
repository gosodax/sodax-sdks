/**
 * Wire tests for the solver-backed SwapService consumer paths: a keyed `new Sodax({ apiKey })`
 * must put `x-api-key` on the actual outgoing fetch with `Content-Type` intact.
 *
 * Deliberately a separate file from SwapService.test.ts: that file hoists a
 * `vi.mock('./SolverApiService.js')`, which would replace the very transport these tests
 * exercise. Here the real solver client runs against a stubbed global fetch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainKeys, SolverIntentStatusCode, type Hex } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const sodax = new Sodax({ apiKey: 'instance-key', logger: 'silent' });

// Production-listed tokens (ETHB on BSC, WBTC on Arbitrum) so the real ConfigService validation passes.
const QUOTE_PAYLOAD = {
  token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  token_src_blockchain_id: ChainKeys.BSC_MAINNET,
  token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  amount: 1_000_000n,
  quote_type: 'exact_input',
} as const;

const INTENT_TX_HASH: Hex = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const okResponse = <T>(body: T) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  mockFetch.mockReset();
});

/** Headers of the single recorded call to (pathname, method) — read through `Headers` so any casing counts. */
const requestHeaders = (pathname: string, method: string): Headers => {
  const matches = mockFetch.mock.calls.filter(
    call => new URL(String(call[0])).pathname === pathname && (call[1]?.method ?? 'GET') === method,
  );
  expect(matches).toHaveLength(1);
  return new Headers(matches[0]?.[1]?.headers);
};

describe('SwapService solver consumer paths — API key on the wire', () => {
  it('getQuote sends x-api-key with Content-Type intact on POST /quote', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ quoted_amount: '954330' }));

    const result = await sodax.swaps.getQuote(QUOTE_PAYLOAD);

    expect(result).toEqual({ ok: true, value: { quoted_amount: 954_330n } });
    const headers = requestHeaders('/v1/intent/quote', 'POST');
    expect(headers.get('x-api-key')).toBe('instance-key');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('getStatus sends x-api-key with Content-Type intact on POST /status', async () => {
    // Terminal non-NOT_FOUND: the solver answer stands, so no durable-record reconcile follows.
    mockFetch.mockResolvedValueOnce(okResponse({ status: SolverIntentStatusCode.SOLVED, fill_tx_hash: '0xfill' }));

    const result = await sodax.swaps.getStatus({ intent_tx_hash: INTENT_TX_HASH });

    expect(result).toEqual({ ok: true, value: { status: SolverIntentStatusCode.SOLVED, fill_tx_hash: '0xfill' } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = requestHeaders('/v1/intent/status', 'POST');
    expect(headers.get('x-api-key')).toBe('instance-key');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('getDetailedStatus carries the key on BOTH the backend status read and the solver /status', async () => {
    mockFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/v1/swaps/submit-tx/status') {
        // Schema-valid "no usable record" (`success: false`): the backend answered, so the flow
        // proceeds straight to the solver — a Sonic source means no relay leg in between.
        return okResponse({
          success: false,
          data: {
            txHash: INTENT_TX_HASH,
            srcChainKey: ChainKeys.SONIC_MAINNET,
            status: 'pending',
            processingAttempts: 0,
          },
        });
      }
      if (pathname === '/v1/intent/status') {
        return okResponse({ status: SolverIntentStatusCode.SOLVED, fill_tx_hash: '0xfill' });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${String(url)}`);
    });

    const result = await sodax.swaps.getDetailedStatus({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      srcTxHash: INTENT_TX_HASH,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source).toBe('solver');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestHeaders('/v1/swaps/submit-tx/status', 'GET').get('x-api-key')).toBe('instance-key');
    const solverHeaders = requestHeaders('/v1/intent/status', 'POST');
    expect(solverHeaders.get('x-api-key')).toBe('instance-key');
    expect(solverHeaders.get('content-type')).toBe('application/json');
  });

  it('postExecution sends x-api-key with Content-Type intact on POST /execute', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ answer: 'OK', intent_hash: INTENT_TX_HASH }));

    const result = await sodax.swaps.postExecution({ intent_tx_hash: INTENT_TX_HASH });

    expect(result).toEqual({ ok: true, value: { answer: 'OK', intent_hash: INTENT_TX_HASH } });
    const headers = requestHeaders('/v1/intent/execute', 'POST');
    expect(headers.get('x-api-key')).toBe('instance-key');
    expect(headers.get('content-type')).toBe('application/json');
  });
});
