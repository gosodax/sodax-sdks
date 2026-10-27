import { useBalances } from '@sodax/dapp-kit';
import type { SpokeChainKey, XToken } from '@sodax/sdk';
import { formatAmount } from './cross-network-balances.js';

/** One per connected network; idle until chainKey and address are set and tokens is non-empty. */
export function NetworkBalances({
  chainKey,
  address,
  tokens,
}: {
  chainKey: SpokeChainKey | undefined;
  address: string | undefined;
  tokens: readonly XToken[];
}) {
  const { data: balances, isLoading, error } = useBalances({ params: { chainKey, address, tokens } });

  if (isLoading) return <p>Loading balances…</p>;
  if (error) return <p>Could not read balances.</p>;

  return (
    <ul>
      {tokens.map(token => (
        <li key={token.address}>
          {token.symbol}: {formatAmount(balances?.[token.address] ?? 0n, token.decimals)}
        </li>
      ))}
    </ul>
  );
}
