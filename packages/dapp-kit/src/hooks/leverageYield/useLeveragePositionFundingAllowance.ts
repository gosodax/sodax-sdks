import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

export type UseLeveragePositionFundingAllowanceParams = ReadHookParams<
  boolean,
  {
    srcChainKey: SpokeChainKey;
    srcAddress: string | undefined;
    /** Funding token, from `resolvePositionFunding` — not the reserve and not the vault. */
    token: string | undefined;
    amount: bigint | undefined;
  }
>;

/**
 * Whether the funding token is approved for an open; the SDK resolves the chain-dependent spender.
 * Chains with no allowance concept answer `true`.
 */
export function useLeveragePositionFundingAllowance({
  params,
  queryOptions,
}: UseLeveragePositionFundingAllowanceParams = {}): UseQueryResult<boolean, Error> {
  const { sodax } = useSodaxContext();
  const { srcChainKey, srcAddress, token, amount } = params ?? {};

  return useQuery<boolean, Error>({
    queryKey: ['leverageYield', 'positionFundingAllowance', srcChainKey, srcAddress, token, amount?.toString()],
    queryFn: async () => {
      if (!srcChainKey || !srcAddress || !token || !amount) throw new Error('allowance params are incomplete');
      const result = await sodax.leverageYield.isPositionFundingAllowanceValid({
        srcChainKey,
        srcAddress,
        token,
        amount,
      });
      if (!result.ok) throw result.error;
      return result.value;
    },
    enabled: !!srcChainKey && !!srcAddress && !!token && !!amount && amount > 0n,
    ...queryOptions,
  });
}
