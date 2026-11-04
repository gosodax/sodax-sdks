/**
 * Tests for SolverApiService — the stateless HTTP client for the SODAX solver API.
 *
 * Mirrors the pattern from EvmVaultTokenService.test.ts and SonicSpokeService.test.ts (PR #1241):
 *   1. Each public static method has a top-level `describe` covering every branch (invariant
 *      guards, happy path, !response.ok branch, fetch-throws catch branch, falsy-error catch).
 *   2. Wire-format is asserted against the real fetch URL/headers/body — a mutation that flips
 *      the endpoint path or HTTP method changes the observable call and fails the assertion.
 *   3. Collaborators reduce to a stubbed `fetch` (replaced on `globalThis`), a stubbed
 *      `ConfigService` (`isValidOriginalAssetAddress` / `getSpokeTokenFromOriginalAssetAddress`),
 *      and the real `retry` helper replaced by a pass-through so the postExecution failure path
 *      doesn't sit through DEFAULT_RETRY_DELAY_MS * DEFAULT_MAX_RETRY of real timer waits.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SolverIntentErrorCode,
  type Hex,
  type SolverConfig,
  type SolverExecutionRequest,
  type SolverIntentQuoteRequest,
  type SolverIntentStatusRequest,
  type XToken,
} from '@sodax/types';

// `retry` is the only collaborator from shared-utils used by SolverApiService. Replace it with a
// single-pass invocation so the postExecution catch path resolves immediately instead of waiting
// 3 * 2_000ms for the real retry loop. Other exports keep their real implementations.
vi.mock('../shared/utils/shared-utils.js', async () => {
  const actual = await vi.importActual<object>('../shared/utils/shared-utils.js');
  return {
    ...actual,
    retry: <T>(action: (retryCount: number) => Promise<T>): Promise<T> => action(1),
  };
});

import type { ConfigService } from '../shared/config/ConfigService.js';
import { silentLogger } from '../shared/logger.js';
import { SolverApiService } from './SolverApiService.js';

// --- fixtures -------------------------------------------------------------

const SOLVER_CONFIG: SolverConfig = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://solver.example.test/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5',
};

const SRC_TOKEN_ADDRESS = '0xaaaa000000000000000000000000000000000001';
const DST_TOKEN_ADDRESS = '0xbbbb000000000000000000000000000000000002';
const SRC_HUB_ASSET = '0xcccc000000000000000000000000000000000003';
const DST_HUB_ASSET = '0xdddd000000000000000000000000000000000004';
const INTENT_TX_HASH: Hex = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const FILL_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const QUOTE_REQUEST: SolverIntentQuoteRequest = {
  token_src: SRC_TOKEN_ADDRESS,
  token_src_blockchain_id: 'sonic',
  token_dst: DST_TOKEN_ADDRESS,
  token_dst_blockchain_id: '0xa4b1.arbitrum',
  amount: 1_000_000n,
  quote_type: 'exact_input',
};

// XToken fixtures used to seed `getSpokeTokenFromOriginalAssetAddress` — only `hubAsset` is read.
const srcXToken = { hubAsset: SRC_HUB_ASSET } as unknown as XToken;
const dstXToken = { hubAsset: DST_HUB_ASSET } as unknown as XToken;

const mockConfigService = {
  isValidOriginalAssetAddress: vi.fn(),
  getSpokeTokenFromOriginalAssetAddress: vi.fn(),
  logger: silentLogger,
} as unknown as ConfigService;

const realFetch = globalThis.fetch;
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every token address is supported, and resolves to the matching hub asset. Individual
  // tests override these to drive the invariant branches.
  vi.mocked(mockConfigService.isValidOriginalAssetAddress).mockReturnValue(true);
  vi.mocked(mockConfigService.getSpokeTokenFromOriginalAssetAddress).mockImplementation((_chainId, asset) => {
    if (asset === SRC_TOKEN_ADDRESS) return srcXToken;
    if (asset === DST_TOKEN_ADDRESS) return dstXToken;
    return undefined;
  });
});

// Helpers — small Response-like fakes so we don't depend on `undici`.
const okResponse = (body: unknown): Response => ({ ok: true, json: async () => body }) as unknown as Response;
const errorResponse = (body: unknown): Response => ({ ok: false, json: async () => body }) as unknown as Response;

// =========================================================================
// getQuote — invariant guards + happy path + error branches
// =========================================================================

describe('SolverApiService.getQuote', () => {
  describe('invariant guards (thrown synchronously, no fetch)', () => {
    it.each([
      ['empty token_src', { token_src: '' }, 'Empty token_src'],
      ['empty token_src_blockchain_id', { token_src_blockchain_id: '' }, 'Empty token_src_blockchain_id'],
      ['empty token_dst', { token_dst: '' }, 'Empty token_dst'],
      ['empty token_dst_blockchain_id', { token_dst_blockchain_id: '' }, 'Empty token_dst_blockchain_id'],
      ['zero amount', { amount: 0n }, 'amount must be greater than 0'],
    ])('rejects %s', async (_label, override, message) => {
      const payload = { ...QUOTE_REQUEST, ...override } as SolverIntentQuoteRequest;
      await expect(SolverApiService.getQuote(payload, SOLVER_CONFIG, mockConfigService)).rejects.toThrow(message);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects unsupported token_src for src chain', async () => {
      vi.mocked(mockConfigService.isValidOriginalAssetAddress).mockImplementation(
        (_chain, asset) => asset !== SRC_TOKEN_ADDRESS,
      );

      await expect(SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService)).rejects.toThrow(
        'unsupported token_src for src chain',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects unsupported token_dst for dst chain', async () => {
      vi.mocked(mockConfigService.isValidOriginalAssetAddress).mockImplementation(
        (_chain, asset) => asset !== DST_TOKEN_ADDRESS,
      );

      await expect(SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService)).rejects.toThrow(
        'unsupported token_dst for dst chain',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when hub asset for token_src is missing (spoke-token lookup returns undefined)', async () => {
      vi.mocked(mockConfigService.getSpokeTokenFromOriginalAssetAddress).mockImplementation((_chain, asset) =>
        asset === DST_TOKEN_ADDRESS ? dstXToken : undefined,
      );

      await expect(SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService)).rejects.toThrow(
        'hub asset not found for token_src',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects when hub asset for token_dst is missing', async () => {
      vi.mocked(mockConfigService.getSpokeTokenFromOriginalAssetAddress).mockImplementation((_chain, asset) =>
        asset === SRC_TOKEN_ADDRESS ? srcXToken : undefined,
      );

      await expect(SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService)).rejects.toThrow(
        'hub asset not found for token_dst',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('POSTs JSON to {endpoint}/quote with hub-translated tokens, stringified amount, quote_type', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ quoted_amount: '987654321' }));

      const result = await SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService);

      expect(result).toEqual({ ok: true, value: { quoted_amount: 987_654_321n } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe('https://solver.example.test/v1/intent/quote');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init?.body as string)).toEqual({
        token_src: SRC_HUB_ASSET,
        token_dst: DST_HUB_ASSET,
        amount: '1000000',
        quote_type: 'exact_input',
      });
    });

    it('coerces a string `quoted_amount` to bigint', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ quoted_amount: '0' }));

      const result = await SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService);

      expect(result).toEqual({ ok: true, value: { quoted_amount: 0n } });
    });
  });

  describe('failure branches', () => {
    it('forwards a non-OK response body verbatim as the error', async () => {
      const body = { detail: { code: SolverIntentErrorCode.NO_PATH_FOUND, message: 'no route' } };
      fetchMock.mockResolvedValueOnce(errorResponse(body));

      const result = await SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService);

      expect(result).toEqual({ ok: false, error: body });
    });

    it('returns UNKNOWN with stringified error when fetch throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const networkError = { kind: 'NetworkDown' };
      fetchMock.mockRejectedValueOnce(networkError);

      const result = await SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService);

      expect(result).toEqual({
        ok: false,
        error: {
          detail: {
            code: SolverIntentErrorCode.UNKNOWN,
            message: JSON.stringify(networkError),
          },
        },
      });
      consoleSpy.mockRestore();
    });

    it('returns UNKNOWN with "Unknown error" message when fetch throws a falsy value', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // `undefined` is falsy → the `e ? JSON.stringify(e) : 'Unknown error'` branch picks the
      // fallback string. This kills the mutant that flips the ternary.
      fetchMock.mockRejectedValueOnce(undefined);

      const result = await SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, mockConfigService);

      expect(result).toEqual({
        ok: false,
        error: {
          detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'Unknown error' },
        },
      });
      consoleSpy.mockRestore();
    });
  });
});

// =========================================================================
// postExecution — retry-wrapped fetch + happy path + error branches
// =========================================================================

describe('SolverApiService.postExecution', () => {
  const request: SolverExecutionRequest = { intent_tx_hash: INTENT_TX_HASH };
  const successBody = { answer: 'OK', intent_hash: INTENT_TX_HASH } as const;

  it('POSTs JSON to {endpoint}/execute with the intent_tx_hash and returns the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(successBody));

    const result = await SolverApiService.postExecution(request, SOLVER_CONFIG);

    expect(result).toEqual({ ok: true, value: successBody });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://solver.example.test/v1/intent/execute');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({ intent_tx_hash: INTENT_TX_HASH });
  });

  it('forwards a non-OK response body verbatim as the error', async () => {
    const body = { detail: { code: SolverIntentErrorCode.INTENT_NOT_FOUND, message: 'gone' } };
    fetchMock.mockResolvedValueOnce(errorResponse(body));

    const result = await SolverApiService.postExecution(request, SOLVER_CONFIG);

    expect(result).toEqual({ ok: false, error: body });
  });

  it('returns UNKNOWN with stringified error when retry-wrapped fetch ultimately throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('boom');
    fetchMock.mockRejectedValueOnce(failure);

    const result = await SolverApiService.postExecution(request, SOLVER_CONFIG);

    expect(result).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: JSON.stringify(failure) },
      },
    });
    consoleSpy.mockRestore();
  });

  it('returns UNKNOWN with "Unknown error" when retry-wrapped fetch throws a falsy value', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(undefined);

    const result = await SolverApiService.postExecution(request, SOLVER_CONFIG);

    expect(result).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'Unknown error' },
      },
    });
    consoleSpy.mockRestore();
  });
});

// =========================================================================
// getStatus — invariant guard + happy path + error branches
// =========================================================================

describe('SolverApiService.getStatus', () => {
  const request: SolverIntentStatusRequest = { intent_tx_hash: INTENT_TX_HASH };

  it('rejects an empty intent_tx_hash before issuing any fetch', async () => {
    await expect(SolverApiService.getStatus({ intent_tx_hash: '' as Hex }, SOLVER_CONFIG)).rejects.toThrow(
      'Empty intent_tx_hash',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs JSON to {endpoint}/status with the request body and returns the parsed body', async () => {
    const body = { status: 3, fill_tx_hash: FILL_TX_HASH };
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const result = await SolverApiService.getStatus(request, SOLVER_CONFIG);

    expect(result).toEqual({ ok: true, value: body });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://solver.example.test/v1/intent/status');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({ intent_tx_hash: INTENT_TX_HASH });
  });

  it('forwards a non-OK response body verbatim as the error', async () => {
    const body = { detail: { code: SolverIntentErrorCode.INTENT_NOT_FOUND, message: 'missing' } };
    fetchMock.mockResolvedValueOnce(errorResponse(body));

    const result = await SolverApiService.getStatus(request, SOLVER_CONFIG);

    expect(result).toEqual({ ok: false, error: body });
  });

  it('returns UNKNOWN with stringified error when fetch throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = { reason: 'timeout' };
    fetchMock.mockRejectedValueOnce(failure);

    const result = await SolverApiService.getStatus(request, SOLVER_CONFIG);

    expect(result).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: JSON.stringify(failure) },
      },
    });
    consoleSpy.mockRestore();
  });

  it('returns UNKNOWN with "Unknown error" when fetch throws a falsy value', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(undefined);

    const result = await SolverApiService.getStatus(request, SOLVER_CONFIG);

    expect(result).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'Unknown error' },
      },
    });
    consoleSpy.mockRestore();
  });
});

// =========================================================================
// getStatus — optional request budget
// =========================================================================
//
// `timeoutMs` is opt-in: every test above calls without it and asserts the unbounded behavior,
// including the wire format, which carries no `signal`. These cover the bounded path — a status read
// polled on a short interval must not be held open by a solver that never answers.

describe('SolverApiService.getStatus with a timeout budget', () => {
  const request: SolverIntentStatusRequest = { intent_tx_hash: INTENT_TX_HASH };

  // Never settles on its own; rejects with an AbortError only once its signal aborts.
  const hungFetch = (_url: unknown, opts: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
      );
    });

  afterEach(() => {
    vi.useRealTimers();
    // Not `vi.clearAllMocks()`'s job: it clears recorded calls, not implementations. A leaked
    // `hungFetch` would hang the next test in this file that relies on the default fetch mock.
    fetchMock.mockReset();
  });

  it('gives up at the budget when the connection hangs', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    fetchMock.mockImplementation(hungFetch);

    const promise = SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await promise).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'solver /status timed out after 5000ms' },
      },
    });
    consoleSpy.mockRestore();
  });

  it('gives up at the budget when the response body stalls after headers arrive', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    // `fetch` resolves as soon as headers land, so only a timer still armed over `json()` catches this.
    fetchMock.mockImplementation((_url: unknown, opts: { signal: AbortSignal }) =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) =>
            opts.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            ),
          ),
      }),
    );

    const promise = SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, 5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await promise).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'solver /status timed out after 5000ms' },
      },
    });
    consoleSpy.mockRestore();
  });

  it('answers normally inside the budget, forwarding the abort signal', async () => {
    const body = { status: 3, fill_tx_hash: FILL_TX_HASH };
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const result = await SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, 5_000);

    expect(result).toEqual({ ok: true, value: body });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  // `setTimeout` coerces these to ~0, so arming a timer with one would abort a perfectly healthy
  // request on the next tick and report it as a timeout — every call failing, not just slow ones.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('answers normally when the budget is %s, rather than aborting instantly', async (_label, budget) => {
    vi.useFakeTimers();
    const body = { status: 3, fill_tx_hash: FILL_TX_HASH };
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const promise = SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, budget);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await promise).toEqual({ ok: true, value: body });
    // No usable budget means no bound at all — the same call omitting the argument would make.
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.signal).toBeUndefined();
  });

  it('aborts immediately on a non-positive budget', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockImplementation(hungFetch);

    const result = await SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, 0);

    expect(result).toEqual({
      ok: false,
      error: {
        detail: { code: SolverIntentErrorCode.UNKNOWN, message: 'solver /status timed out after 0ms' },
      },
    });
    consoleSpy.mockRestore();
  });
});

// =========================================================================
// API key — the configured instance key (`new Sodax({ apiKey })`) rides every solver request.
// =========================================================================
//
// The solver transport has no per-request override surface, so this config-level tier is the only
// one. Every case asserts the whole header record: the key must be added to `Content-Type`, never
// replace it, and an unset or empty key must send no `x-api-key` at all.

describe('SolverApiService API key', () => {
  /** The shared double plus a configured key — the field `getQuote` reads for its `x-api-key`. */
  const withApiKey = (apiKey: string | undefined): ConfigService =>
    ({ ...mockConfigService, apiKey }) as unknown as ConfigService;

  const sentHeaders = (): Record<string, string> => fetchMock.mock.calls[0]?.[1]?.headers;
  const JSON_HEADER = { 'Content-Type': 'application/json' };
  const request: SolverExecutionRequest = { intent_tx_hash: INTENT_TX_HASH };

  it('sends the configured key on /quote', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ quoted_amount: '1' }));

    await SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, withApiKey('instance-key'));

    expect(sentHeaders()).toEqual({ ...JSON_HEADER, 'x-api-key': 'instance-key' });
  });

  it('sends the configured key on /execute', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ answer: 'OK', intent_hash: INTENT_TX_HASH }));

    await SolverApiService.postExecution(request, SOLVER_CONFIG, silentLogger, 'instance-key');

    expect(sentHeaders()).toEqual({ ...JSON_HEADER, 'x-api-key': 'instance-key' });
  });

  it('sends the configured key on /status', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ status: 3 }));

    await SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, undefined, 'instance-key');

    expect(sentHeaders()).toEqual({ ...JSON_HEADER, 'x-api-key': 'instance-key' });
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('sends no x-api-key on any endpoint when the key is %s', async (_label, apiKey) => {
    for (const call of [
      () => SolverApiService.getQuote(QUOTE_REQUEST, SOLVER_CONFIG, withApiKey(apiKey)),
      () => SolverApiService.postExecution(request, SOLVER_CONFIG, silentLogger, apiKey),
      () => SolverApiService.getStatus(request, SOLVER_CONFIG, silentLogger, undefined, apiKey),
    ]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(okResponse({ quoted_amount: '1', status: 3, answer: 'OK' }));
      await call();
      expect(sentHeaders()).toEqual(JSON_HEADER);
    }
  });
});
