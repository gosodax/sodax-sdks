import { describe, expect, it } from 'vitest';
import { ChainKeys } from './chains.js';
import { SodaTokens, solanaSupportedTokens, supportedTokensByChain, type XToken } from './tokens.js';
import { swapSupportedTokens, stagingSwapSupportedTokens } from '../swap/swap.js';
import { moneyMarketSupportedTokens, moneyMarketReserveAssets } from '../moneyMarket/moneyMarket.js';

const hubVaults = Object.values(SodaTokens);
const hubVaultAddresses = new Set<XToken['vault']>(hubVaults.map(token => token.address));
const stagingTokens: readonly XToken[] = Object.values(stagingSwapSupportedTokens).flat();

describe('canonical hub vaults', () => {
  it.each(hubVaults)('$symbol is its own Sonic hub asset and vault', token => {
    expect(token.chainKey).toBe(ChainKeys.SONIC_MAINNET);
    expect(token.hubAsset).toBe(token.address);
    expect(token.vault).toBe(token.address);
  });
});

describe('staging swap token references', () => {
  it.each(stagingTokens)('$symbol on $chainKey uses canonical registry metadata', token => {
    expect(Object.values(supportedTokensByChain[token.chainKey])).toContain(token);
    expect(token.vault === token.hubAsset || hubVaultAddresses.has(token.vault)).toBe(true);
  });
});

describe('ADA and ZEC vault feature membership', () => {
  it('enables the ADA vault only for staging swaps', () => {
    const token = SodaTokens.sodaADA;
    expect(stagingSwapSupportedTokens[token.chainKey]).toContain(token);
    expect(swapSupportedTokens[token.chainKey]).not.toContainEqual(token);
  });

  it('uses the ZEC vault to back Solana ZEC without enabling hub swaps', () => {
    const token = SodaTokens.sodaZEC;
    expect(solanaSupportedTokens.ZEC.vault).toBe(token.address);
    expect(stagingSwapSupportedTokens[token.chainKey]).not.toContainEqual(token);
    expect(swapSupportedTokens[token.chainKey]).not.toContainEqual(token);
  });

  it.each([SodaTokens.sodaADA, SodaTokens.sodaZEC])('$symbol has no money-market listing or reserve', token => {
    expect(moneyMarketSupportedTokens[token.chainKey]).not.toContainEqual(token);
    expect(moneyMarketReserveAssets).not.toContain(token.address);
  });
});
