import { SPONSOR_CONFIG_TTL_MS, type Sodax, type StellarSponsorConfig } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseSponsorConfigParams = ReadHookParams<StellarSponsorConfig>;

type SponsorConfigReader = { sponsoring: Pick<Sodax['sponsoring'], 'getStellarSponsorConfig'> };

export function getSponsorConfigQueryOptions({ sodax }: { sodax: SponsorConfigReader }) {
  return {
    queryKey: ['sponsoring', 'sponsorConfig'] as const,
    queryFn: async (): Promise<StellarSponsorConfig> => {
      const result = await sodax.sponsoring.getStellarSponsorConfig();
      if (!result.ok) throw result.error;
      return result.value;
    },
    staleTime: SPONSOR_CONFIG_TTL_MS,
  };
}

export function useSponsorConfig({
  queryOptions,
}: UseSponsorConfigParams = {}): UseQueryResult<StellarSponsorConfig, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<StellarSponsorConfig, Error>({
    ...getSponsorConfigQueryOptions({ sodax }),
    ...queryOptions,
  });
}
