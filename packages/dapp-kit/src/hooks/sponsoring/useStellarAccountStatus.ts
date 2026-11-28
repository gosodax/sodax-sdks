import { STELLAR_TRUSTLINE_MIN_XLM_STROOPS, type Sodax, type StellarAccountStatus } from '@sodax/sdk';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { ReadHookParams } from '../shared/types.js';
import { useSodaxContext } from '../shared/useSodaxContext.js';

export type UseStellarAccountStatusParams = ReadHookParams<
  StellarAccountStatus,
  {
    address: string | undefined;
  }
>;

type StellarAccountStatusReader = { sponsoring: Pick<Sodax['sponsoring'], 'getStellarAccountStatus'> };

export function getStellarAccountStatusQueryOptions({
  sodax,
  address,
}: {
  sodax: StellarAccountStatusReader;
  address: string | undefined;
}) {
  return {
    queryKey: ['sponsoring', 'stellarAccountStatus', address] as const,
    queryFn: async (): Promise<StellarAccountStatus> => {
      if (!address) {
        return {
          exists: false,
          nativeBalanceStroops: 0n,
          availableBalanceStroops: 0n,
          canAffordTrustline: false,
          // No account to read the network reserve for; the published value is the best guess.
          trustlineMinXlmStroops: STELLAR_TRUSTLINE_MIN_XLM_STROOPS,
        };
      }
      const result = await sodax.sponsoring.getStellarAccountStatus({ address });
      // A read failure is not evidence that the account is absent.
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!address,
  };
}

/** One Horizon request; prefer {@link useStellarGate} for destination gating. */
export function useStellarAccountStatus({
  params,
  queryOptions,
}: UseStellarAccountStatusParams = {}): UseQueryResult<StellarAccountStatus, Error> {
  const { sodax } = useSodaxContext();
  return useQuery<StellarAccountStatus, Error>({
    ...getStellarAccountStatusQueryOptions({ sodax, address: params?.address }),
    ...queryOptions,
  });
}
