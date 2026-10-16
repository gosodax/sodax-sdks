import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ChainKeys } from '@sodax/sdk';
import { invalidateBalances } from './invalidateBalances.js';

const ARB = ChainKeys.ARBITRUM_MAINNET;
const SONIC = ChainKeys.SONIC_MAINNET;

describe('invalidateBalances', () => {
  it('invalidates both balance query families for a chain', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBalances(queryClient, ARB);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['shared', 'balances', ARB] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['shared', 'xBalances', ARB] });
  });

  it('collapses duplicate chain keys so src === dst does not double-invalidate', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBalances(queryClient, ARB, ARB);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('skips undefined chain keys so callers need not guard an optional dst', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBalances(queryClient, ARB, undefined);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['shared', 'balances', undefined] });
  });

  it('handles several chains in one call', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateBalances(queryClient, ARB, SONIC);

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('marks a cached useBalances query stale through the 3-segment prefix', async () => {
    const queryClient = new QueryClient();
    // The full key useBalances builds — the prefix must still match it, so this fails if the
    // helper ever switches to `exact: true`.
    const fullKey = ['shared', 'balances', ARB, [['USDC', '0xaf88']], '0xuser'] as const;
    queryClient.setQueryData(fullKey, { '0xaf88': 1n });
    expect(queryClient.getQueryState(fullKey)?.isInvalidated).toBe(false);

    invalidateBalances(queryClient, ARB);

    expect(queryClient.getQueryState(fullKey)?.isInvalidated).toBe(true);
  });

  it('leaves other chains untouched', () => {
    const queryClient = new QueryClient();
    const otherChainKey = ['shared', 'balances', SONIC, [], '0xuser'] as const;
    queryClient.setQueryData(otherChainKey, {});

    invalidateBalances(queryClient, ARB);

    expect(queryClient.getQueryState(otherChainKey)?.isInvalidated).toBe(false);
  });
});
