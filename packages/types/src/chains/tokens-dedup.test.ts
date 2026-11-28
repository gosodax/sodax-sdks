import { describe, it, expect } from 'vitest';
import type { XToken } from './tokens.js';
import type { SpokeChainKey } from './chains.js';
import { swapSupportedTokens, stagingSwapSupportedTokens } from '../swap/swap.js';
import { moneyMarketSupportedTokens } from '../moneyMarket/moneyMarket.js';

type TokenList = Record<SpokeChainKey, readonly XToken[]>;

function findDuplicates(tokens: readonly XToken[], by: (t: XToken) => string): Map<string, XToken[]> {
  const groups = new Map<string, XToken[]>();
  for (const token of tokens) {
    const key = by(token);
    const existing = groups.get(key);
    if (existing) {
      existing.push(token);
    } else {
      groups.set(key, [token]);
    }
  }
  return new Map([...groups].filter(([, list]) => list.length > 1));
}

function describeTable(table: TokenList, label: string) {
  describe(`${label}: per-chain token list has no duplicates`, () => {
    for (const [chainKey, tokens] of Object.entries(table) as [SpokeChainKey, readonly XToken[]][]) {
      it(`${chainKey}: unique by (symbol, address) — restricted entries may share an address with a different symbol`, () => {
        // Restricted entries (e.g. `WBTC.legacy`) share an address with their full-access counterpart under a distinct
        // symbol; keying on (symbol, address), as UIs do, lets those pass while accidental duplicates fail.
        const dups = findDuplicates(tokens, t => `${t.symbol}:${t.address.toLowerCase()}`);
        expect(
          dups,
          `duplicate address(es) on ${chainKey}: ${[...dups.entries()]
            .map(([addr, list]) => `${addr} -> ${list.map(t => t.symbol).join(',')}`)
            .join(' | ')}`,
        ).toEqual(new Map());
      });

      it(`${chainKey}: unique by symbol`, () => {
        const dups = findDuplicates(tokens, t => t.symbol);
        expect(dups, `duplicate symbol(s) on ${chainKey}: ${[...dups.keys()].join(', ')}`).toEqual(new Map());
      });
    }
  });
}

describeTable(swapSupportedTokens, 'swapSupportedTokens');
describeTable(stagingSwapSupportedTokens, 'stagingSwapSupportedTokens');
describeTable(moneyMarketSupportedTokens, 'moneyMarketSupportedTokens');
