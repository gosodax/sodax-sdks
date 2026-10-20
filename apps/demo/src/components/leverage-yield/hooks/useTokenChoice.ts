import { useMemo, useState } from 'react';
import {
  getSupportedSolverTokens,
  type SpokeChainKey,
  type XToken,
  useBalances,
  useSodaxContext,
} from '@sodax/dapp-kit';

const DEFAULT_TOKEN_SYMBOL = 'USDC';
const BALANCE_REFETCH_MS = 10_000;

/**
 * Token picker state for one chain: the user's pick while it's on this chain, else USDC, else the first token. The
 * token is derived during render, so it always lives on `chainKey` (a mismatch reads as a phantom `0n` balance).
 * Offers the chain's solver tokens minus the lsoda* vault shares themselves.
 */
export function useTokenChoice(chainKey: SpokeChainKey) {
  const { sodax } = useSodaxContext();
  const tokens = useMemo(() => {
    const shareTokens = new Set(sodax.leverageYield.listVaults().map(vault => vault.vault.toLowerCase()));
    return getSupportedSolverTokens(chainKey).filter(token => !shareTokens.has(token.address.toLowerCase()));
  }, [sodax, chainKey]);
  const [picked, setPicked] = useState<{ chainKey: SpokeChainKey; address: string }>();
  const token: XToken | undefined =
    (picked?.chainKey === chainKey ? tokens.find(t => t.address === picked.address) : undefined) ??
    tokens.find(t => t.symbol === DEFAULT_TOKEN_SYMBOL) ??
    tokens[0];
  return { tokens, token, pickToken: (address: string) => setPicked({ chainKey, address }) };
}

/** Wallet balance of one token on one chain (smallest units). */
export function useTokenBalance(chainKey: SpokeChainKey, token: XToken | undefined, address: string | undefined) {
  const query = useBalances({
    params: { chainKey, tokens: token ? [token] : [], address },
    queryOptions: { refetchInterval: BALANCE_REFETCH_MS },
  });
  return { balance: token ? query.data?.[token.address] : undefined, isLoading: query.isLoading };
}
