import type { GetUserIntentParams, Hex } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseGetUserIntentParams = ReadHookParams<Hex, Partial<GetUserIntentParams>>;

/** A non-zero hash is an open auto-swap intent, recoverable via {@link usePartnerCancelIntent}. */
export function useGetUserIntent({ params, queryOptions }: UseGetUserIntentParams = {}): UseQueryResult<Hex, Error> {
  const { sodax } = useSodaxContext();
  const user = params?.user;
  const fromToken = params?.fromToken;
  const toToken = params?.toToken;

  return useQuery<Hex, Error>({
    queryKey: ['partner', 'feeClaim', 'userIntent', user, fromToken, toToken],
    queryFn: async () => {
      if (!user || !fromToken || !toToken) {
        throw new Error('user, fromToken and toToken are required');
      }
      const result = await sodax.partners.feeClaim.getUserIntent({ user, fromToken, toToken });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!user && !!fromToken && !!toToken,
    ...queryOptions,
  });
}
