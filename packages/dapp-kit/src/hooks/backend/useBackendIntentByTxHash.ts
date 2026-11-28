import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IntentResponse } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseBackendIntentByTxHashParams = ReadHookParams<
  IntentResponse | undefined,
  {
    txHash: string | undefined;
  }
>;

/** `txHash` must be a hub-chain tx: intents are only created there. */
export const useBackendIntentByTxHash = ({
  params,
  queryOptions,
}: UseBackendIntentByTxHashParams = {}): UseQueryResult<IntentResponse | undefined, Error> => {
  const { sodax } = useSodaxContext();
  const txHash = params?.txHash;

  return useQuery({
    queryKey: ['backend', 'intent', 'txHash', txHash],
    queryFn: async (): Promise<IntentResponse | undefined> => {
      if (!txHash) return undefined;
      const result = await sodax.backendApi.getIntentByTxHash(txHash);
      return result.ok ? result.value : undefined;
    },
    enabled: !!txHash && txHash.length > 0,
    retry: 3,
    refetchInterval: 1000,
    ...queryOptions,
  });
};
