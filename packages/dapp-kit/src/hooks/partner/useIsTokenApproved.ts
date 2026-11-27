import type { FeeTokenApproveParams } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseIsTokenApprovedParams = ReadHookParams<
  boolean,
  {
    payload: FeeTokenApproveParams | undefined;
  }
>;

export function useIsTokenApproved({
  params,
  queryOptions,
}: UseIsTokenApprovedParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const payload = params?.payload;

  return useQuery<boolean, Error>({
    queryKey: ['partner', 'feeClaim', 'isTokenApproved', payload?.srcChainKey, payload?.srcAddress, payload?.token],
    queryFn: async () => {
      if (!payload) {
        throw new Error('params are required');
      }
      const result = await sodax.partners.feeClaim.isTokenApproved(payload);
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!payload,
    refetchInterval: 5_000,
    gcTime: 0,
    ...queryOptions,
  });
}
