import { describe, it, expect } from 'vitest';
import type { XToken } from './tokens.js';
import { supportedTokensByChain } from './tokens.js';
import type { SpokeChainKey } from './chains.js';
import { swapSupportedTokens, stagingSwapSupportedTokens } from '../swap/swap.js';
import { moneyMarketSupportedTokens } from '../moneyMarket/moneyMarket.js';

// Consumers route on `token.chainKey`, so a token filed under a different chain list silently sends reads to a
// chain where its address does not exist.
function describeTable(table: Record<string, readonly XToken[]>, label: string) {
  describe(`${label}: token.chainKey matches the chain it is listed under`, () => {
    for (const [chainKey, tokens] of Object.entries(table)) {
      it(`${chainKey}: every entry declares chainKey '${chainKey}'`, () => {
        const mismatched = tokens.filter(token => token.chainKey !== chainKey);
        expect(
          mismatched,
          `token(s) listed on ${chainKey} declaring a different chainKey: ${mismatched
            .map(token => `${token.symbol} -> ${token.chainKey}`)
            .join(', ')}`,
        ).toEqual([]);
      });
    }
  });
}

// Deliberate cast: Object.fromEntries widens keys to string, but the source record is keyed by
// every SpokeChainKey, so the Record shape is guaranteed by construction.
const supportedTokenLists = Object.fromEntries(
  Object.entries(supportedTokensByChain).map(([chainKey, tokens]) => [chainKey, Object.values(tokens) as XToken[]]),
) as unknown as Record<SpokeChainKey, readonly XToken[]>; // deliberate: see comment above

describeTable(supportedTokenLists, 'supportedTokensByChain');
describeTable(swapSupportedTokens, 'swapSupportedTokens');
describeTable(stagingSwapSupportedTokens, 'stagingSwapSupportedTokens');
describeTable(moneyMarketSupportedTokens, 'moneyMarketSupportedTokens');
