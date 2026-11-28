import type { Erc20Token } from '@sodax/sdk';
import type { ChainKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { type Address, isAddress } from 'viem';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type ATokenData = Erc20Token & { chainKey: ChainKey };

export type UseATokenParams = ReadHookParams<
  ATokenData,
  {
    aToken: Address | string | undefined;
  }
>;

/** Returns ERC-20 metadata plus hub `chainKey` only; `hubAsset` and `vault` are not resolved. */
export function useAToken({ params, queryOptions }: UseATokenParams = {}): UseQueryResult<ATokenData, Error> {
  const { sodax } = useSodaxContext();
  const aToken = params?.aToken;

  return useQuery({
    queryKey: ['mm', 'aToken', aToken],
    queryFn: async () => {
      if (!aToken) {
        throw new Error('aToken address is required');
      }
      if (!isAddress(aToken)) {
        throw new Error('aToken address is not a valid address');
      }

      const aTokenData = await sodax.moneyMarket.data.getATokenData(aToken);
      return {
        ...aTokenData,
        chainKey: sodax.hubProvider.chainConfig.chain.key,
      };
    },
    enabled: !!aToken && isAddress(aToken ?? ''),
    ...queryOptions,
  });
}
