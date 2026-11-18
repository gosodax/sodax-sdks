// #region use-balances
import { useBalances } from '@sodax/dapp-kit';
import type { SpokeChainKey, XToken } from '@sodax/sdk';

export function Balances({
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
          {token.symbol}: {(balances?.[token.address] ?? 0n).toString()}
        </li>
      ))}
    </ul>
  );
}
// #endregion use-balances
