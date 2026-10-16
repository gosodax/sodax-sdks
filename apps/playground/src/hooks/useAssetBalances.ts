import {
  baseChainInfo,
  getBalancesQueryOptions,
  spokeChainConfig,
  useSodaxContext,
  type ChainKey,
  type SpokeChainKey,
  type XToken,
} from '@sodax/dapp-kit';
import { useXAccounts } from '@sodax/wallet-sdk-react';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { BalanceMap } from '../lib/balances';
import type { AssetGroup } from '../lib/pickerOptions';

/**
 * What the connected wallets hold of every asset in the picker: one batched read per chain, as the
 * exchange's asset dialog does. Chains no connected family can address are never queried, and the
 * whole set is gated on the dialog being open — an embedded widget must not poll twenty chains
 * behind a closed picker.
 */
export function useAssetBalances<K extends ChainKey>(groups: readonly AssetGroup<K>[], open: boolean): BalanceMap {
  const { sodax } = useSodaxContext();
  const accounts = useXAccounts();

  const reads = useMemo(() => {
    const byChain = new Map<SpokeChainKey, XToken[]>();

    for (const group of groups) {
      for (const { chain, token } of group.choices) {
        if (!Object.hasOwn(spokeChainConfig, chain)) continue;
        const key = chain as SpokeChainKey;
        const tokens = byChain.get(key);
        if (tokens) tokens.push(token);
        else byChain.set(key, [token]);
      }
    }

    return [...byChain].map(([chain, tokens]) => ({
      chain,
      tokens,
      address: accounts[baseChainInfo[chain].type]?.address,
    }));
  }, [groups, accounts]);

  const results = useQueries({
    queries: reads.map(({ chain, tokens, address }) => ({
      ...getBalancesQueryOptions(sodax, { chainKey: chain, tokens, address }),
      enabled: open && !!address,
      // Read on open rather than on a timer: the shared five-second poll is one request per chain.
      refetchInterval: false as const,
    })),
  });

  // Rebuilt each render rather than memoised: the results array is new every render anyway, and the
  // map is only ever read during one.
  const balances: Record<string, Record<string, bigint>> = {};
  reads.forEach(({ chain }, index) => {
    const data = results[index]?.data;
    if (data) balances[chain] = data;
  });

  return balances;
}
