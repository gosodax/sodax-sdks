import {
  ChainKeys,
  type PartnerFee,
  type Sodax,
  type SolverIntentQuoteRequest,
  SolverIntentErrorCode,
} from '@sodax/sdk';
import { hashKey } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { getSwapQuoteQueryOptions } from './useQuote.js';

const TOKEN_SRC = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';
const TOKEN_DST = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
const FEE_RECIPIENT = '0x4444444444444444444444444444444444444444' as const;

const PAYLOAD: SolverIntentQuoteRequest = {
  token_src: TOKEN_SRC,
  token_src_blockchain_id: ChainKeys.BSC_MAINNET,
  token_dst: TOKEN_DST,
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  amount: 1_000_000n,
  quote_type: 'exact_input',
};

/** The SDK's own quote Result, derived so the doubles stay honest without an unsafe cast. */
type QuoteResult = Awaited<ReturnType<Sodax['swaps']['getQuote']>>;

const QUOTE: QuoteResult = { ok: true, value: { quoted_amount: 990_000n } };

const makeSodax = (result: QuoteResult = QUOTE, partnerFee?: PartnerFee) => {
  const getQuote = vi.fn(async () => result);
  return { sodax: { swaps: { getQuote, partnerFee } }, getQuote };
};

describe('getSwapQuoteQueryOptions', () => {
  it('returns the SDK Result as data so callers can branch on `ok`', async () => {
    const { sodax, getQuote } = makeSodax();
    await expect(getSwapQuoteQueryOptions({ sodax, payload: PAYLOAD }).queryFn()).resolves.toEqual(QUOTE);
    expect(getQuote).toHaveBeenCalledWith(PAYLOAD);
  });

  it('passes a solver failure through as data rather than throwing', async () => {
    const error = { detail: { code: SolverIntentErrorCode.NO_PATH_FOUND, message: 'no path' } };
    const { sodax } = makeSodax({ ok: false, error });
    await expect(getSwapQuoteQueryOptions({ sodax, payload: PAYLOAD }).queryFn()).resolves.toEqual({
      ok: false,
      error,
    });
  });

  it('is disabled and resolves undefined without calling the SDK when payload is undefined', async () => {
    const { sodax, getQuote } = makeSodax();
    const options = getSwapQuoteQueryOptions({ sodax, payload: undefined });
    expect(options.enabled).toBe(false);
    await expect(options.queryFn()).resolves.toBeUndefined();
    expect(getQuote).not.toHaveBeenCalled();
  });

  // `getQuote` deducts the configured fee from `amount` before quoting, so it is an input to the
  // result even though it never appears in `payload`. Two providers with different swap fees must
  // not share a cache entry, and a reconfigured provider must not serve the old fee's quote.
  it('keys the configured swap partner fee, so differently-configured providers never share a quote', () => {
    const noFee = getSwapQuoteQueryOptions({ sodax: makeSodax().sodax, payload: PAYLOAD }).queryKey;
    const a = getSwapQuoteQueryOptions({
      sodax: makeSodax(QUOTE, { address: FEE_RECIPIENT, percentage: 100 }).sodax,
      payload: PAYLOAD,
    }).queryKey;
    const b = getSwapQuoteQueryOptions({
      sodax: makeSodax(QUOTE, { address: FEE_RECIPIENT, percentage: 25 }).sodax,
      payload: PAYLOAD,
    }).queryKey;

    expect(hashKey(noFee)).not.toBe(hashKey(a));
    expect(hashKey(a)).not.toBe(hashKey(b));
  });

  it('keys a bigint configured fee without throwing', () => {
    const { sodax } = makeSodax(QUOTE, { address: FEE_RECIPIENT, amount: 7_000n });
    const { queryKey } = getSwapQuoteQueryOptions({ sodax, payload: PAYLOAD });
    expect(() => hashKey(queryKey)).not.toThrow();
    expect(hashKey(queryKey)).toContain('7000');
  });

  // Pins the allow-list. If `SolverIntentQuoteRequest` gains a field, this fails and forces a
  // decision about whether it belongs in the key — rather than a spread silently carrying a new
  // bigint in and crashing `hashKey` at render time.
  it('keys swap/quote on exactly the known request fields, with the amount stringified for hashing', () => {
    const { sodax } = makeSodax();
    const { queryKey } = getSwapQuoteQueryOptions({ sodax, payload: PAYLOAD });

    expect(queryKey.slice(0, 2)).toEqual(['swap', 'quote']);
    expect(hashKey(queryKey)).toContain('"amount":"1000000"');
    expect(Object.keys(queryKey[2] as object).sort()).toEqual(
      [
        'amount',
        'partnerFee',
        'quote_type',
        'token_dst',
        'token_dst_blockchain_id',
        'token_src',
        'token_src_blockchain_id',
      ].sort(),
    );
  });

  // Key derivation runs during render, so it must not throw on a payload assembled from
  // partially-validated form state.
  it('derives a hashable key even when amount is missing', () => {
    const { sodax } = makeSodax();
    const malformed = { ...PAYLOAD, amount: undefined } as unknown as SolverIntentQuoteRequest;

    const { queryKey } = getSwapQuoteQueryOptions({ sodax, payload: malformed });

    expect(() => hashKey(queryKey)).not.toThrow();
    expect(hashKey(queryKey)).toContain('"amount":"undefined"');
  });
});
