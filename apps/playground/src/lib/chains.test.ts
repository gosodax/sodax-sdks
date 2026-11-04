import { CHAIN_KEYS, Sodax, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { chainKeyExpression, chainName, executableFamilies, isChainKey } from './chains';
import { EXECUTABLE_CHAIN_TYPES } from './execution';

// A chain key reaches this app from the swaps API and from the URL, and both are strings. Anything
// that gets past this predicate is indexed straight into `baseChainInfo` for a name and a logo.
describe('isChainKey', () => {
  it('accepts every key the SDK ships, EVM and non-EVM alike', () => {
    for (const key of CHAIN_KEYS) {
      expect(isChainKey(key)).toBe(true);
    }
  });

  it.each(['0xdead.notachain', 'BASE_MAINNET', '../../etc/passwd', '', 'toString'])('rejects %j', value => {
    expect(isChainKey(value)).toBe(false);
  });
});

describe('chainKeyExpression', () => {
  it('renders every chain the SDK ships as the ChainKeys expression a reader pastes', () => {
    for (const key of CHAIN_KEYS) {
      expect(chainKeyExpression(key)).toMatch(/^ChainKeys\.[A-Z0-9_]+$/);
    }
  });
});

describe('chainName', () => {
  it('has a display name for every chain the SDK ships', () => {
    for (const key of CHAIN_KEYS) {
      expect(chainName(key)).toBeTruthy();
    }
  });
});

// The Behavior panel once hardcoded "EVM, Solana and Sui" and kept saying it after four more
// families shipped. The sentence now reads off the executable list, so it cannot lag it again.
describe('executableFamilies', () => {
  it('names every family the widget signs for, and none it does not', () => {
    const sentence = executableFamilies();
    for (const type of EXECUTABLE_CHAIN_TYPES) {
      expect(sentence).toMatch(new RegExp(type, 'i'));
    }
    expect(sentence).not.toMatch(/bitcoin|icon/i);
    expect(sentence).toMatch(/, and \w+$/);
  });
});

// The panel renders a speed tier before any quote, so a pair the estimate cannot classify would
// break the form rather than degrade it. The API's list reaches at least as far as this one.
describe('speed tier over every swappable pair', () => {
  it('classifies every pair the pickers can produce', () => {
    const sodax = new Sodax();
    const chains = CHAIN_KEYS.filter(key => getSupportedSolverTokens(key).length > 0);

    for (const srcChain of chains) {
      for (const dstChain of chains) {
        const srcToken = getSupportedSolverTokens(srcChain)[0];
        const dstToken = getSupportedSolverTokens(dstChain)[0];
        if (!srcToken || !dstToken) continue;

        const { tier, estimatedSeconds } = sodax.swaps.getSwapSpeedTier({ srcToken, dstToken });
        expect(estimatedSeconds).toBeGreaterThan(0);
        expect(['fast', 'normal', 'slow']).toContain(tier);
      }
    }
  });
});
