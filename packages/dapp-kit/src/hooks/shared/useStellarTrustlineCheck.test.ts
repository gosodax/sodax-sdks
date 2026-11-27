import { ChainKeys } from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { getStellarTrustlineCheckQueryOptions } from './useStellarTrustlineCheck.js';

const TOKEN = 'CTOKEN';
const STELLAR = ChainKeys.STELLAR_MAINNET;
const WALLET_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WALLET_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const makeSodax = (result: boolean) => {
  const hasSufficientTrustline = vi.fn(async () => result);
  return { sodax: { spoke: { stellar: { hasSufficientTrustline } } }, hasSufficientTrustline };
};

const optionsFor = (overrides: Partial<Parameters<typeof getStellarTrustlineCheckQueryOptions>[0]> = {}) =>
  getStellarTrustlineCheckQueryOptions({
    sodax: makeSodax(true).sodax,
    token: TOKEN,
    amount: 100n,
    chainId: STELLAR,
    walletAddress: WALLET_A,
    ...overrides,
  });

describe('getStellarTrustlineCheckQueryOptions — query key', () => {
  it('keys on chain, token, account, and stringified amount', () => {
    expect(optionsFor().queryKey).toEqual(['shared', 'stellarTrustlineCheck', STELLAR, TOKEN, WALLET_A, '100']);
  });

  it('re-keys when the account, amount, or chain changes', () => {
    const base = optionsFor().queryKey;
    expect(optionsFor({ walletAddress: WALLET_B }).queryKey).not.toEqual(base);
    expect(optionsFor({ amount: 10_000n }).queryKey).not.toEqual(base);
    expect(optionsFor({ chainId: ChainKeys.SONIC_MAINNET }).queryKey).not.toEqual(base);
  });

  it('shares the useEstablishTrustline invalidation prefix (chain, token, account) across every amount', () => {
    // useEstablishTrustline invalidates ['shared','stellarTrustlineCheck', srcChainKey, token, srcAddress];
    // amount sits after that prefix, so the invalidation covers the account's checks at any amount.
    const invalidationKey = ['shared', 'stellarTrustlineCheck', STELLAR, TOKEN, WALLET_A];
    for (const amount of [100n, 10_000n]) {
      expect(optionsFor({ amount }).queryKey.slice(0, invalidationKey.length)).toEqual(invalidationKey);
    }
  });
});

describe('getStellarTrustlineCheckQueryOptions — enabled + queryFn', () => {
  it('is enabled only when walletAddress, token, and amount are present', () => {
    expect(optionsFor({ walletAddress: WALLET_A }).enabled).toBe(true);
    expect(optionsFor({ walletAddress: undefined }).enabled).toBe(false);
    expect(optionsFor({ token: undefined }).enabled).toBe(false);
    expect(optionsFor({ amount: undefined }).enabled).toBe(false);
  });

  it('checks the trustline for the given account address', async () => {
    const { sodax, hasSufficientTrustline } = makeSodax(false);
    const result = await optionsFor({ sodax, walletAddress: WALLET_A }).queryFn();
    expect(hasSufficientTrustline).toHaveBeenCalledWith(TOKEN, 100n, WALLET_A);
    expect(result).toBe(false);
  });

  it('returns true (no trustline needed) for a non-Stellar chain', async () => {
    expect(await optionsFor({ chainId: ChainKeys.SONIC_MAINNET }).queryFn()).toBe(true);
  });
});
