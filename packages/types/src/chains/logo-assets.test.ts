import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAIN_KEYS } from './chain-keys.js';
import { spokeChainConfig, supportedSpokeChains } from './chains.js';
import { tokenLogoSlug } from './tokens.js';

/**
 * Asserts that every logo URL `@sodax/types` hands out resolves to a real file in
 * `@sodax/assets`. The sibling tests here only check how the URLs are *built*, and
 * `@sodax/assets` is a file host with no code of its own, so this is the only gate
 * standing between a new token or chain and a 404 icon in every consumer.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A partially written file keeps a valid header, so the closing chunk is what proves it is whole.
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const SOURCE_HINT = 'Source the PNG from CoinGecko, see packages/assets/README.md';

const assetDir = (kind: 'token' | 'chain'): URL => new URL(`../../../assets/${kind}/`, import.meta.url);

const logoFileNames = (kind: 'token' | 'chain'): string[] =>
  readdirSync(assetDir(kind))
    .filter(name => name.endsWith('.png'))
    .map(name => name.slice(0, -'.png'.length));

/** Slug -> the tokens or chains that need a file under that name. */
const expectedTokenLogos = (): Map<string, string[]> => {
  const owners = new Map<string, string[]>();
  for (const chainKey of supportedSpokeChains) {
    for (const token of Object.values(spokeChainConfig[chainKey].supportedTokens)) {
      const slug = tokenLogoSlug(token.symbol);
      owners.set(slug, [...(owners.get(slug) ?? []), `${token.symbol} on ${chainKey}`]);
    }
  }
  return owners;
};

const missingLogos = (kind: 'token' | 'chain', owners: Map<string, string[]>): string[] => {
  const present = new Set(logoFileNames(kind));
  return [...owners]
    .filter(([slug]) => !present.has(slug))
    .map(([slug, needing]) => `${kind}/${slug}.png — needed by ${needing.join(', ')}`)
    .sort();
};

const orphanLogos = (kind: 'token' | 'chain', owners: Map<string, string[]>): string[] =>
  logoFileNames(kind)
    .filter(name => !owners.has(name))
    .map(name => `${kind}/${name}.png`)
    .sort();

const malformedLogos = (kind: 'token' | 'chain'): string[] =>
  logoFileNames(kind)
    .filter(name => {
      const bytes = readFileSync(new URL(`${name}.png`, assetDir(kind)));
      return (
        bytes.length === 0 ||
        !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC) ||
        bytes.lastIndexOf(PNG_IEND) === -1
      );
    })
    .map(name => `${kind}/${name}.png`)
    .sort();

describe('token logo assets', () => {
  const owners = expectedTokenLogos();

  it('ships a logo file for every supported token', () => {
    expect(missingLogos('token', owners), `Add each file to packages/assets/token/. ${SOURCE_HINT}`).toEqual([]);
  });

  it('has no logo file that no supported token claims', () => {
    expect(
      orphanLogos('token', owners),
      'Either the filename does not match tokenLogoSlug(symbol), or the token was removed and its logo should go too',
    ).toEqual([]);
  });

  it('stores every token logo as a non-empty PNG', () => {
    expect(malformedLogos('token'), 'File is empty, truncated, or is not really a PNG').toEqual([]);
  });
});

describe('chain logo assets', () => {
  const owners = new Map(CHAIN_KEYS.map(key => [key, [key]]));

  it('ships a logo file for every chain', () => {
    expect(missingLogos('chain', owners), `Add each file to packages/assets/chain/. ${SOURCE_HINT}`).toEqual([]);
  });

  it('has no logo file that no chain claims', () => {
    expect(
      orphanLogos('chain', owners),
      'Either the filename does not match its ChainKeys value, or the chain was removed and its logo should go too',
    ).toEqual([]);
  });

  it('stores every chain logo as a non-empty PNG', () => {
    expect(malformedLogos('chain'), 'File is empty, truncated, or is not really a PNG').toEqual([]);
  });
});
