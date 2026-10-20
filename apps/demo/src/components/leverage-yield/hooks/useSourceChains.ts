import { useMemo } from 'react';
import { getSupportedSolverTokens, type SpokeChainKey, useSodaxContext } from '@sodax/dapp-kit';
import { getXChainType, useXAccounts } from '@sodax/wallet-sdk-react';

/** Every spoke chain a vault can be deposited from (and withdrawn to): the ones with solver tokens. */
export function useSourceChains(): readonly SpokeChainKey[] {
  const { sodax } = useSodaxContext();
  return useMemo(
    () => sodax.config.getSupportedSpokeChains().filter(chainKey => getSupportedSolverTokens(chainKey).length > 0),
    [sodax],
  );
}

/** One connected address per source chain: each chain deposits into its own hub wallet on Sonic. */
export type Holder = { chainKey: SpokeChainKey; address: string };

export function useConnectedHolders(): Holder[] {
  const chains = useSourceChains();
  const xAccounts = useXAccounts();
  return useMemo(
    () =>
      chains.flatMap(chainKey => {
        const chainType = getXChainType(chainKey);
        const address = chainType ? xAccounts[chainType]?.address : undefined;
        return address ? [{ chainKey, address }] : [];
      }),
    [chains, xAccounts],
  );
}
