// Checks an amount against what its token's hub vault can pay out, so the money market modals can stop it early.

import { useQuery } from '@tanstack/react-query';
import { EvmVaultTokenService, useSodaxContext, type XToken } from '@sodax/dapp-kit';

/**
 * `unmet`: what `token`'s hub vault can pay out when `amount` exceeds it. A borrow or withdraw delivering more
 * reverts in the hub simulation with a bare "External call failed". `pending` while the first read is in flight.
 * Same read as the bridge's withdrawal limit; a Sonic vault token is paid out without a vault withdraw, so skipped.
 */
export function useUnmetDeliverableLiquidity({
  token,
  amount,
}: {
  token: XToken | undefined;
  amount: bigint | undefined;
}): { unmet: bigint | undefined; pending: boolean } {
  const { sodax } = useSodaxContext();
  const { data: deliverable, isLoading } = useQuery({
    queryKey: ['demo', 'deliverableLiquidity', token?.chainKey, token?.address],
    enabled: token !== undefined && !!amount && !sodax.config.isSodaVaultHubAsset(token.hubAsset),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!token) throw new Error('token is required');
      const reserves = await EvmVaultTokenService.getVaultReserves(token.vault, sodax.hubProvider.publicClient);
      // The hub asset carries the token's decimals, as the SDK's money market math assumes.
      return sodax.bridge.findTokenBalanceInReserves(reserves, token);
    },
  });
  const unmet = deliverable !== undefined && amount !== undefined && amount > deliverable ? deliverable : undefined;
  return { unmet, pending: isLoading };
}
