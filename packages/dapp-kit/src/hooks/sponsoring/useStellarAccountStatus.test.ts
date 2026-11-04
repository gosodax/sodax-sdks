import {
  SodaxError,
  STELLAR_TRUSTLINE_MIN_XLM_STROOPS,
  type Result,
  type SponsoringLookupError,
  type StellarAccountStatus,
} from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { getStellarAccountStatusQueryOptions } from './useStellarAccountStatus.js';

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const FUNDED: StellarAccountStatus = {
  exists: true,
  nativeBalanceStroops: 50_000_000n,
  availableBalanceStroops: 40_000_000n,
  canAffordTrustline: true,
  trustlineMinXlmStroops: STELLAR_TRUSTLINE_MIN_XLM_STROOPS,
};

const makeSodax = (result: Result<StellarAccountStatus, SponsoringLookupError>) => {
  const getStellarAccountStatus = vi.fn(async () => result);
  return { sodax: { sponsoring: { getStellarAccountStatus } }, getStellarAccountStatus };
};

const lookupError = new SodaxError('LOOKUP_FAILED', 'Horizon unreachable', { feature: 'sponsoring' });

describe('getStellarAccountStatusQueryOptions — query key', () => {
  it('keys on the address', () => {
    const { sodax } = makeSodax({ ok: true, value: FUNDED });
    expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryKey).toEqual([
      'sponsoring',
      'stellarAccountStatus',
      ADDRESS,
    ]);
  });

  it('produces independent keys per account', () => {
    const { sodax } = makeSodax({ ok: true, value: FUNDED });
    expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryKey).not.toEqual(
      getStellarAccountStatusQueryOptions({ sodax, address: OTHER }).queryKey,
    );
  });

  it('uses a key distinct from the boolean active-check, so the two do not share a cache entry', () => {
    const { sodax } = makeSodax({ ok: true, value: FUNDED });
    expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryKey[1]).toBe('stellarAccountStatus');
  });
});

describe('getStellarAccountStatusQueryOptions — enablement and fetching', () => {
  it('is disabled without an address', () => {
    const { sodax } = makeSodax({ ok: true, value: FUNDED });
    expect(getStellarAccountStatusQueryOptions({ sodax, address: undefined }).enabled).toBe(false);
    expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).enabled).toBe(true);
  });

  it('returns the SDK status verbatim', async () => {
    const { sodax, getStellarAccountStatus } = makeSodax({ ok: true, value: FUNDED });
    await expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryFn()).resolves.toEqual(FUNDED);
    expect(getStellarAccountStatus).toHaveBeenCalledWith({ address: ADDRESS });
  });

  it('resolves to a zero-value without an address instead of throwing', async () => {
    // Manual fetches can execute this query even while React Query marks it disabled.
    const { sodax, getStellarAccountStatus } = makeSodax({ ok: true, value: FUNDED });
    await expect(getStellarAccountStatusQueryOptions({ sodax, address: undefined }).queryFn()).resolves.toEqual({
      exists: false,
      nativeBalanceStroops: 0n,
      availableBalanceStroops: 0n,
      canAffordTrustline: false,
      trustlineMinXlmStroops: STELLAR_TRUSTLINE_MIN_XLM_STROOPS,
    });
    expect(getStellarAccountStatus).not.toHaveBeenCalled();
  });

  it('THROWS on a lookup failure rather than reporting the account absent', async () => {
    const { sodax } = makeSodax({ ok: false, error: lookupError });
    await expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryFn()).rejects.toBe(lookupError);
  });

  it('reports an existing account that cannot afford a trustline — the post-activation state', async () => {
    const sponsoredEmpty: StellarAccountStatus = {
      exists: true,
      nativeBalanceStroops: 0n,
      availableBalanceStroops: 0n,
      canAffordTrustline: false,
      trustlineMinXlmStroops: STELLAR_TRUSTLINE_MIN_XLM_STROOPS,
    };
    const { sodax } = makeSodax({ ok: true, value: sponsoredEmpty });
    await expect(getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryFn()).resolves.toEqual(
      sponsoredEmpty,
    );
  });
});
