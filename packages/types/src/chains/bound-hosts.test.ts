import { describe, expect, it } from 'vitest';
import { ChainKeys } from './chain-keys.js';
import { BOUND_API_HOST, BOUND_COMPANION_HOSTS, DEPRECATED_BOUND_HOSTS, spokeChainConfig } from './chains.js';

// gh-425: the packaged default carries `apiUrl` only. Inlining the companion hosts here would let
// an `apiUrl`-only override inherit them via `deepMerge` and straddle two environments.
describe('Bound host defaults', () => {
  const radfi = spokeChainConfig[ChainKeys.BITCOIN_MAINNET].radfi;

  it('ships apiUrl only — no companion host may be inlined here', () => {
    expect(radfi.apiUrl).toBe(BOUND_API_HOST);
    expect(radfi).not.toHaveProperty('authUrl');
    expect(radfi).not.toHaveProperty('transactionsUrl');
  });

  it('never defaults to a host Bound has announced it is retiring', () => {
    for (const url of [radfi.apiUrl, radfi.umsUrl]) {
      expect(DEPRECATED_BOUND_HOSTS).not.toContain(url);
    }
  });

  it('keeps every packaged host absolute and free of a trailing slash', () => {
    const companions = Object.values(BOUND_COMPANION_HOSTS).flatMap(c => Object.values(c));
    for (const url of [BOUND_API_HOST, ...companions, radfi.umsUrl]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url.endsWith('/')).toBe(false);
    }
  });
});
