import type { Sodax } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseStellarAccountActiveParams = ReadHookParams<
  boolean,
  {
    address: string | undefined;
  }
>;

type StellarAccountReader = { sponsoring: Pick<Sodax['sponsoring'], 'isStellarAccountActive'> };

export function getStellarAccountActiveQueryOptions({
  sodax,
  address,
}: {
  sodax: StellarAccountReader;
  address: string | undefined;
}) {
  return {
    queryKey: ['sponsoring', 'stellarAccountActive', address] as const,
    queryFn: async (): Promise<boolean> => {
      if (!address) return false;
      const result = await sodax.sponsoring.isStellarAccountActive({ address });
      // A read failure is not evidence that the account is inactive.
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!address,
  };
}

export function useStellarAccountActive({
  params,
  queryOptions,
}: UseStellarAccountActiveParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<boolean, Error>({
    ...getStellarAccountActiveQueryOptions({ sodax, address: params?.address }),
    ...queryOptions,
  });
}
