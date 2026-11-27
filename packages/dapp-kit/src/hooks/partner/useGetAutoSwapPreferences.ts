import type { AutoSwapPreferences } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseGetAutoSwapPreferencesParams = ReadHookParams<
  AutoSwapPreferences,
  {
    queryAddress: string | undefined;
  }
>;

export function useGetAutoSwapPreferences({
  params,
  queryOptions,
}: UseGetAutoSwapPreferencesParams = {}): UseQueryResult<AutoSwapPreferences, Error> {
  const { sodax } = useSodaxContext();
  const queryAddress = params?.queryAddress;

  return useQuery<AutoSwapPreferences, Error>({
    queryKey: ['partner', 'feeClaim', 'autoSwapPreferences', queryAddress],
    queryFn: async () => {
      if (!queryAddress) {
        throw new Error('queryAddress is required');
      }
      const result = await sodax.partners.feeClaim.getAutoSwapPreferences(queryAddress);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!queryAddress,
    ...queryOptions,
  });
}
