// apps/demo/src/hooks/useSodaBalance.ts
import { useSodaxContext, useBalances, type SpokeChainKey } from '@sodax/dapp-kit';

/**
 * Hook for getting the SODA token balance of the connected wallet on a specific chain. Wraps
 * `useBalances` and looks up the SODA token via `sodax.config.findSupportedTokenBySymbol`.
 */
export function useSodaBalance(chainKey: SpokeChainKey, userAddress: string | undefined): bigint | undefined {
  const { sodax } = useSodaxContext();
  const sodaToken = sodax.config.findSupportedTokenBySymbol(chainKey, 'SODA');

  const { data: balances } = useBalances({
    params: {
      chainKey,
      tokens: sodaToken ? [sodaToken] : [],
      address: userAddress,
    },
  });

  return sodaToken ? balances?.[sodaToken.address] : undefined;
}
