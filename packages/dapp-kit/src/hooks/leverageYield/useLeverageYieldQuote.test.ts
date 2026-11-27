import {
  ChainKeys,
  type LeverageYieldQuoteParams,
  type PartnerFee,
  type Sodax,
  SolverIntentErrorCode,
} from '@sodax/sdk';
import { hashKey } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { getLeverageYieldQuoteQueryOptions } from './useLeverageYieldQuote.js';

const VAULT = '0xD09de2f5070699A909c0FD32fb5A909d3886701D';
const INPUT_TOKEN = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe';
const FEE_RECIPIENT = '0x4444444444444444444444444444444444444444' as const;

const PAYLOAD: LeverageYieldQuoteParams = {
  token_src: INPUT_TOKEN,
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst: VAULT,
  token_dst_blockchain_id: ChainKeys.SONIC_MAINNET,
  amount: 1_000_000n,
  quote_type: 'exact_input',
};

type QuoteResult = Awaited<ReturnType<Sodax['leverageYield']['getQuote']>>;

const QUOTE: QuoteResult = { ok: true, value: { quoted_amount: 990_000n } };

const makeSodax = (result: QuoteResult = QUOTE, leverageYieldPartnerFee?: PartnerFee) => {
  const getQuote = vi.fn(async () => result);
  return { sodax: { config: { leverageYieldPartnerFee }, leverageYield: { getQuote } }, getQuote };
};

describe('getLeverageYieldQuoteQueryOptions', () => {
  it('keys on the leverageYield feature and the quote action', () => {
    const { sodax } = makeSodax();
    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD });
    expect(queryKey[0]).toBe('leverageYield');
    expect(queryKey[1]).toBe('quote');
  });

  it('returns the SDK Result unwrapped-free so callers can branch on `ok`', async () => {
    const { sodax, getQuote } = makeSodax();
    await expect(getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD }).queryFn()).resolves.toEqual(QUOTE);
    expect(getQuote).toHaveBeenCalledWith(PAYLOAD);
  });

  it('passes a solver failure through as data rather than throwing', async () => {
    const error = { detail: { code: SolverIntentErrorCode.NO_PATH_FOUND, message: 'no path' } };
    const { sodax } = makeSodax({ ok: false, error });
    await expect(getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD }).queryFn()).resolves.toEqual({
      ok: false,
      error,
    });
  });

  it('is disabled and resolves undefined without calling the SDK when payload is undefined', async () => {
    const { sodax, getQuote } = makeSodax();
    const options = getLeverageYieldQuoteQueryOptions({ sodax, payload: undefined });
    expect(options.enabled).toBe(false);
    await expect(options.queryFn()).resolves.toBeUndefined();
    expect(getQuote).not.toHaveBeenCalled();
  });

  // React Query hashes keys with JSON.stringify, which throws on bigint.
  it('produces a hashable key for a percentage partner fee', () => {
    const partnerFee = { address: FEE_RECIPIENT, percentage: 100 } satisfies PartnerFee;
    const { sodax } = makeSodax();
    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: { ...PAYLOAD, partnerFee } });
    expect(() => hashKey(queryKey)).not.toThrow();
  });

  it('produces a hashable key for a fixed-amount (bigint) partner fee', () => {
    const partnerFee = { address: FEE_RECIPIENT, amount: 5_000n } satisfies PartnerFee;
    const { sodax } = makeSodax();
    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: { ...PAYLOAD, partnerFee } });
    expect(() => hashKey(queryKey)).not.toThrow();
    expect(hashKey(queryKey)).toContain('5000');
  });

  it('keys two quotes that differ only by partner fee separately', () => {
    const { sodax } = makeSodax();
    const base = getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD }).queryKey;
    const withFee = getLeverageYieldQuoteQueryOptions({
      sodax,
      payload: { ...PAYLOAD, partnerFee: { address: FEE_RECIPIENT, percentage: 100 } },
    }).queryKey;
    expect(hashKey(base)).not.toBe(hashKey(withFee));
  });

  it('keys the amount as a string so it survives hashing', () => {
    const { sodax } = makeSodax();
    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD });
    expect(hashKey(queryKey)).toContain('"amount":"1000000"');
  });

  it('keys the configured leverageYield fee when the payload omits partnerFee', () => {
    const noFee = getLeverageYieldQuoteQueryOptions({ sodax: makeSodax().sodax, payload: PAYLOAD }).queryKey;
    const withConfigFee = getLeverageYieldQuoteQueryOptions({
      sodax: makeSodax(QUOTE, { address: FEE_RECIPIENT, percentage: 100 }).sodax,
      payload: PAYLOAD,
    }).queryKey;

    expect(hashKey(noFee)).not.toBe(hashKey(withConfigFee));
  });

  it('keys two differently-configured providers apart for an identical payload', () => {
    const a = getLeverageYieldQuoteQueryOptions({
      sodax: makeSodax(QUOTE, { address: FEE_RECIPIENT, percentage: 100 }).sodax,
      payload: PAYLOAD,
    }).queryKey;
    const b = getLeverageYieldQuoteQueryOptions({
      sodax: makeSodax(QUOTE, { address: FEE_RECIPIENT, percentage: 25 }).sodax,
      payload: PAYLOAD,
    }).queryKey;

    expect(hashKey(a)).not.toBe(hashKey(b));
  });

  it('keys a bigint configured fee without throwing', () => {
    const { sodax } = makeSodax(QUOTE, { address: FEE_RECIPIENT, amount: 7_000n });
    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD });
    expect(() => hashKey(queryKey)).not.toThrow();
    expect(hashKey(queryKey)).toContain('7000');
  });

  // Fails when `LeverageYieldQuoteParams` gains a field, forcing a decision on whether it belongs in the key.
  it('keys exactly the known request fields', () => {
    const { sodax } = makeSodax();
    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: PAYLOAD });

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

  it('derives a hashable key even when amount is missing', () => {
    const { sodax } = makeSodax();
    // Simulates half-filled form state that the type forbids; key derivation must not throw during render.
    const malformed = { ...PAYLOAD, amount: undefined } as unknown as LeverageYieldQuoteParams;

    const { queryKey } = getLeverageYieldQuoteQueryOptions({ sodax, payload: malformed });

    expect(() => hashKey(queryKey)).not.toThrow();
    expect(hashKey(queryKey)).toContain('"amount":"undefined"');
  });

  it('lets an explicit payload partnerFee win over the configured fee in the key', () => {
    const explicitFee = { address: FEE_RECIPIENT, percentage: 10 } satisfies PartnerFee;
    const { sodax } = makeSodax(QUOTE, { address: FEE_RECIPIENT, percentage: 100 });
    const { queryKey } = getLeverageYieldQuoteQueryOptions({
      sodax,
      payload: { ...PAYLOAD, partnerFee: explicitFee },
    });
    expect(hashKey(queryKey)).toContain('"percentage":10');
  });
});
