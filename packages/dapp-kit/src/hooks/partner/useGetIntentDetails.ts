import type { Hex, Intent } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

export type UseGetIntentDetailsParams = ReadHookParams<Intent, { intentHash: Hex | undefined }>;

/** Disabled for a missing or zero hash; pair with {@link useGetUserIntent} to inspect a stuck intent. */
export function useGetIntentDetails({
  params,
  queryOptions,
}: UseGetIntentDetailsParams = {}): UseQueryResult<Intent, Error> {
  const { sodax } = useSodaxContext();
  const intentHash = params?.intentHash;
  const hasIntent = !!intentHash && intentHash !== ZERO_HASH;

  return useQuery<Intent, Error>({
    queryKey: ['partner', 'feeClaim', 'intentDetails', intentHash],
    queryFn: async () => {
      if (!intentHash) {
        throw new Error('intentHash is required');
      }
      const result = await sodax.partners.feeClaim.getIntentDetails(intentHash);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: hasIntent,
    ...queryOptions,
  });
}
