import { describe, expect, it } from 'vitest';
import { moneyMarketReserveAssets, moneyMarketSupportedTokens } from './moneyMarket.js';

describe('moneyMarketSupportedTokens', () => {
  // A supply is `Pool.supply(token.vault)`, so a listed token whose vault is no reserve can only revert on the hub.
  it('lists only tokens whose vault is a money-market reserve', () => {
    const reserves = new Set<string>(moneyMarketReserveAssets.map(asset => asset.toLowerCase()));
    const unbacked = Object.entries(moneyMarketSupportedTokens).flatMap(([chainKey, tokens]) =>
      tokens.filter(token => !reserves.has(token.vault.toLowerCase())).map(token => `${chainKey}:${token.symbol}`),
    );

    expect(unbacked).toEqual([]);
  });
});
