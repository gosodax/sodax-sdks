/**
 * Wire tests for the solver-backed LeverageYieldService consumer paths: a keyed
 * `new Sodax({ apiKey })` must put `x-api-key` on the actual outgoing fetch with
 * `Content-Type` intact. No SolverApiService module mock — the real solver transport
 * runs against a stubbed global fetch.
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

describe('LeverageYieldService solver consumer paths — API key on the wire', () => {
  it('getQuote sends x-api-key with Content-Type intact on POST /quote', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ quoted_amount: '954330' }));

    const result = await sodax.leverageYield.getQuote(QUOTE_PAYLOAD);

    expect(result).toEqual({ ok: true, value: { quoted_amount: 954_330n } });
    const headers = requestHeaders('/v1/intent/quote', 'POST');
    expect(headers.get('x-api-key')).toBe('instance-key');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('getDetailedStatus keys both legs: the backend status read and the solver /status', async () => {
    mockFetch.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/v1/leverage-yield/submit-tx/status') {
        // `success: false` is the wire contract's "no record" — so the router falls through and
        // proceeds straight to the solver. A Sonic source means no relay leg in between.
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

    const result = await sodax.leverageYield.getDetailedStatus({
      srcChainKey: ChainKeys.SONIC_MAINNET,
      srcTxHash: INTENT_TX_HASH,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.source).toBe('solver');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // The leverage-yield status route is ungated server-side, but the configured key still rides it —
    // a partner should not have to reason about which of the three features happens to require one.
    expect(requestHeaders('/v1/leverage-yield/submit-tx/status', 'GET').get('x-api-key')).toBe('instance-key');
    const solverHeaders = requestHeaders('/v1/intent/status', 'POST');
    expect(solverHeaders.get('x-api-key')).toBe('instance-key');
    expect(solverHeaders.get('content-type')).toBe('application/json');
  });

  it('notifySolver sends x-api-key with Content-Type intact on POST /execute', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ answer: 'OK', intent_hash: INTENT_TX_HASH }));

    const result = await sodax.leverageYield.notifySolver({ intent_tx_hash: INTENT_TX_HASH });

    expect(result).toEqual({ ok: true, value: { answer: 'OK', intent_hash: INTENT_TX_HASH } });
    const headers = requestHeaders('/v1/intent/execute', 'POST');
    expect(headers.get('x-api-key')).toBe('instance-key');
    expect(headers.get('content-type')).toBe('application/json');
  });
});
