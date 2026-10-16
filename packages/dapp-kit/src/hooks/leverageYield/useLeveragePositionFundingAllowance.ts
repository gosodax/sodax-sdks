import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { ReadHookParams } from '../shared/types.js';

/** Params for {@link useLeveragePositionFundingAllowance}. */
export type UseLeveragePositionFundingAllowanceParams = ReadHookParams<
  boolean,
  {
    srcChainKey: SpokeChainKey;
    /** The user's address on `srcChainKey`. */
    srcAddress: string | undefined;
    /** Funding token, from `resolvePositionFunding` — not the reserve and not the vault. */
    token: string | undefined;
    amount: bigint | undefined;
  }
>;

/**
 * Whether the funding token is already approved for an open from `srcChainKey`.
 *
 * THE SPENDER IS CHAIN-DEPENDENT — the hub wallet on the hub, the spoke asset manager elsewhere —
 * so a hand-rolled `allowance` call against a guessed spender is right half the time. The SDK
 * resolves it; this only supplies React Query.
 *
 * Returns the SDK's answer as data. A chain with no allowance concept answers `true` without a call.
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
