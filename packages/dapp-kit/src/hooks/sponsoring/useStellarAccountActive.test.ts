import { SodaxError, type Result, type SponsoringLookupError } from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { getStellarAccountActiveQueryOptions } from './useStellarAccountActive.js';

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const makeSodax = (result: Result<boolean, SponsoringLookupError>) => {
  const isStellarAccountActive = vi.fn(async () => result);
  return { sodax: { sponsoring: { isStellarAccountActive } }, isStellarAccountActive };
};

const lookupError = new SodaxError('LOOKUP_FAILED', 'Horizon unreachable', { feature: 'sponsoring' });

describe('getStellarAccountActiveQueryOptions — query key', () => {
  it('keys on the address', () => {
    const { sodax } = makeSodax({ ok: true, value: true });
    expect(getStellarAccountActiveQueryOptions({ sodax, address: ADDRESS }).queryKey).toEqual([
      'sponsoring',
      'stellarAccountActive',
      ADDRESS,
    ]);
  });

  it('produces independent keys per account', () => {
    const { sodax } = makeSodax({ ok: true, value: true });
    expect(getStellarAccountActiveQueryOptions({ sodax, address: ADDRESS }).queryKey).not.toEqual(
      getStellarAccountActiveQueryOptions({ sodax, address: OTHER }).queryKey,
    );
  });
});

describe('getStellarAccountActiveQueryOptions — enablement and fetching', () => {
  it('is disabled without an address', () => {
    const { sodax } = makeSodax({ ok: true, value: true });
    expect(getStellarAccountActiveQueryOptions({ sodax, address: undefined }).enabled).toBe(false);
    expect(getStellarAccountActiveQueryOptions({ sodax, address: ADDRESS }).enabled).toBe(true);
  });

  it.each([true, false])('returns the SDK result (%s)', async value => {
    const { sodax, isStellarAccountActive } = makeSodax({ ok: true, value });
    await expect(getStellarAccountActiveQueryOptions({ sodax, address: ADDRESS }).queryFn()).resolves.toBe(value);
    expect(isStellarAccountActive).toHaveBeenCalledWith({ address: ADDRESS });
  });

  it('THROWS on a lookup failure rather than reporting "not active"', async () => {
    const { sodax } = makeSodax({ ok: false, error: lookupError });
    await expect(getStellarAccountActiveQueryOptions({ sodax, address: ADDRESS }).queryFn()).rejects.toBe(lookupError);
  });
});
