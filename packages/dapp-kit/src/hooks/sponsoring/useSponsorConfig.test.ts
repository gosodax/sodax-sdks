import {
  SodaxError,
  SPONSOR_CONFIG_TTL_MS,
  type Result,
  type SponsoringConfigError,
  type StellarSponsorConfig,
} from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { getSponsorConfigQueryOptions } from './useSponsorConfig.js';

const CONFIG: StellarSponsorConfig = {
  sponsorAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
  minTotalFeeStroops: '3000',
  maxTotalFeeStroops: '10000',
  operationCount: 3,
  minPerOperationFeeStroops: '1000',
  maxPerOperationFeeStroops: '3333',
  recommendedPerOperationFeeStroops: '1000',
  maxTimeboundSeconds: 3600,
  requiredStartingBalance: '0',
};

const makeSodax = (result: Result<StellarSponsorConfig, SponsoringConfigError>) => {
  const getStellarSponsorConfig = vi.fn(async () => result);
  return { sodax: { sponsoring: { getStellarSponsorConfig } }, getStellarSponsorConfig };
};

const configError = new SodaxError('EXTERNAL_API_ERROR', 'sponsoring API unreachable', { feature: 'backend' });

describe('getSponsorConfigQueryOptions', () => {
  it('uses a fixed key — the config is not parameterised', () => {
    const { sodax } = makeSodax({ ok: true, value: CONFIG });
    expect(getSponsorConfigQueryOptions({ sodax }).queryKey).toEqual(['sponsoring', 'sponsorConfig']);
  });

  it("reuses the SDK's TTL so both mirror the server's max-age=60", () => {
    const { sodax } = makeSodax({ ok: true, value: CONFIG });
    expect(getSponsorConfigQueryOptions({ sodax }).staleTime).toBe(SPONSOR_CONFIG_TTL_MS);
  });

  it('returns the published build parameters', async () => {
    const { sodax, getStellarSponsorConfig } = makeSodax({ ok: true, value: CONFIG });
    await expect(getSponsorConfigQueryOptions({ sodax }).queryFn()).resolves.toEqual(CONFIG);
    expect(getStellarSponsorConfig).toHaveBeenCalledOnce();
  });

  it('THROWS on failure so React Query reports isError and caches nothing', async () => {
    const { sodax } = makeSodax({ ok: false, error: configError });
    await expect(getSponsorConfigQueryOptions({ sodax }).queryFn()).rejects.toBe(configError);
  });
});
