import { CHAIN_KEYS, ChainKeys, type ChainKey, getSupportedSolverTokens } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import type { BalanceMap } from './balances';
import type { TokenChoice } from './chains';
import {
  type PriceMap,
  assetGroups,
  filterGroups,
  previewNetworks,
  sortAssetGroups,
  tokenOptionId,
} from './pickerOptions';
import { PICKER_GROUP_A, PICKER_GROUP_B } from './pickerRanking';

// The packaged solver list stands in for the API's here: same shape, offline, and it already spans
// EVM and non-EVM families, which is what the grouping has to survive.
const CHAINS = CHAIN_KEYS.filter(key => getSupportedSolverTokens(key).length > 0);
const CHOICES: TokenChoice[] = CHAINS.flatMap(chain =>
  getSupportedSolverTokens(chain).map(token => ({ chain: chain as ChainKey, token })),
);
const SYMBOL_COUNT = new Set(CHOICES.map(({ token }) => token.symbol)).size;

// The picker addresses a token by id, so a collision silently selects the wrong asset. Two shapes
// collide in the real config: one asset on many chains, and a withdrawOnly entry sharing its
// on-chain address with the token it deprecates.
describe('tokenOptionId', () => {
  it('separates one asset held on two chains', () => {
    const [first, second] = CHAINS;
    expect(tokenOptionId(first, 'USDC')).not.toBe(tokenOptionId(second, 'USDC'));
  });

  it('separates a deprecated entry from the token it shares an address with', () => {
    const [chain] = CHAINS;
    expect(tokenOptionId(chain, 'WBTC')).not.toBe(tokenOptionId(chain, 'WBTC.legacy'));
  });
});

describe('assetGroups', () => {
  it('gives one group per symbol, losing no token', () => {
    const groups = assetGroups(CHOICES);

    expect(groups).toHaveLength(SYMBOL_COUNT);
    expect(groups.reduce((total, group) => total + group.choices.length, 0)).toBe(CHOICES.length);
  });

  it('keeps every group internally one symbol on distinct chains', () => {
    for (const group of assetGroups(CHOICES)) {
      for (const choice of group.choices) {
        expect(choice.token.symbol).toBe(group.symbol);
      }
      expect(new Set(group.choices.map(choice => choice.chain)).size).toBe(group.choices.length);
    }
  });

  // Grouping states no preference: the wallet decides the order, and only the picker has read it.
  it('leaves the grid in a canonical alphabetical order', () => {
    const symbols = assetGroups(CHOICES).map(group => group.symbol);
    expect(symbols).toEqual([...symbols].sort((a, b) => a.localeCompare(b)));
  });
});

describe('filterGroups', () => {
  const groups = assetGroups(CHOICES);

  it('returns everything for an empty query and no network', () => {
    expect(filterGroups(groups, '', undefined)).toHaveLength(groups.length);
  });

  it('matches a symbol case-insensitively', () => {
    const matched = filterGroups(groups, 'usd', undefined);

    expect(matched.length).toBeGreaterThan(0);
    for (const group of matched) {
      expect(group.symbol.toLowerCase()).toContain('usd');
    }
  });

  // A tile is one symbol, but a partner pasting an address or typing a full name still has to land
  // on the asset that carries it.
  it('finds a group by a token name or pasted contract address', () => {
    const choice = CHOICES.find(({ token }) => token.address.length > 10);
    if (!choice) throw new Error('Missing address fixture');

    for (const query of [choice.token.name, choice.token.address]) {
      const symbols = filterGroups(groups, query, choice.chain).map(group => group.symbol);
      expect(symbols).toContain(choice.token.symbol);
    }
  });

  // Filtering to one network narrows each surviving group to that chain, which is what lets the
  // grid select straight through instead of asking "which chain?" for an answer already given.
  it('narrows every surviving group to the picked network', () => {
    const [network] = CHAINS;
    const matched = filterGroups(groups, '', network);

    expect(matched.length).toBeGreaterThan(0);
    for (const group of matched) {
      expect(group.choices).toHaveLength(1);
      expect(group.choices[0].chain).toBe(network);
    }
  });

  it('drops a group that does not reach the picked network', () => {
    const [network] = CHAINS;
    const offChain = groups.find(group => group.choices.every(choice => choice.chain !== network));
    expect(offChain, 'no asset is absent from the first chain — pick another to keep this meaningful').toBeDefined();

    const symbols = filterGroups(groups, '', network).map(group => group.symbol);
    expect(symbols).not.toContain(offChain?.symbol);
  });

  it('returns nothing for a symbol that does not exist', () => {
    expect(filterGroups(groups, 'not-a-real-asset', undefined)).toHaveLength(0);
  });

  // An exactly-typed symbol outranks the longer ones containing it, whatever the grid's own order.
  it('leads with an exact symbol match', () => {
    const buried = groups.find(group =>
      groups.some(
        other => other.symbol !== group.symbol && other.symbol.toLowerCase().includes(group.symbol.toLowerCase()),
      ),
    );
    expect(buried, 'no symbol is a substring of another — pick another case to keep this meaningful').toBeDefined();

    expect(filterGroups(groups, buried?.symbol ?? '', undefined)[0]?.symbol).toBe(buried?.symbol);
  });

  it('keeps the incoming order among equally relevant matches', () => {
    const matched = filterGroups(groups, 'usd', undefined).map(group => group.symbol);
    const incoming = groups.map(group => group.symbol).filter(symbol => matched.includes(symbol));

    expect(matched.filter(symbol => symbol.toLowerCase() !== 'usd')).toEqual(
      incoming.filter(symbol => symbol.toLowerCase() !== 'usd'),
    );
  });
});

/** One whole token of each choice, so a group's value is its price times the networks funded. */
function fund(choices: readonly TokenChoice[]): BalanceMap {
  const balances: Record<string, Record<string, bigint>> = {};

  for (const { chain, token } of choices) {
    balances[chain] = { ...balances[chain], [token.address]: 10n ** BigInt(token.decimals) };
  }

  return balances;
}

function priced(entries: readonly (readonly [TokenChoice, number])[]): PriceMap {
  return Object.fromEntries(entries.map(([{ chain, token }, usd]) => [tokenOptionId(chain, token.symbol), usd]));
}

const isCurated = (symbol: string): boolean =>
  [...PICKER_GROUP_A, ...PICKER_GROUP_B].some(ranked => ranked.toLowerCase() === symbol.toLowerCase());

describe('sortAssetGroups', () => {
  const groups = assetGroups(CHOICES);
  const symbols = (ranked: readonly { symbol: string }[]) => ranked.map(group => group.symbol);

  it('leads with the curated tiers in their fixed order, then runs alphabetically', () => {
    const ranked = symbols(sortAssetGroups(groups, {}));
    const curated = [...PICKER_GROUP_A, ...PICKER_GROUP_B]
      .map(listed => ranked.find(symbol => symbol.toLowerCase() === listed.toLowerCase()))
      .filter((symbol): symbol is string => symbol !== undefined);

    expect(curated.length).toBeGreaterThan(0);
    expect(ranked.slice(0, curated.length)).toEqual(curated);

    const rest = ranked.slice(curated.length);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  // The whole point of the order: an asset you hold outranks one the list merely likes.
  it('lifts a held asset above every curated tier', () => {
    const held = groups.find(group => !isCurated(group.symbol));
    if (!held) throw new Error('Every symbol is curated — pick another fixture');

    expect(symbols(sortAssetGroups(groups, fund(held.choices)))[0]).toBe(held.symbol);
  });

  it('orders held assets by USD value, over the curated order either way round', () => {
    const [first, second] = groups.filter(group => isCurated(group.symbol));
    if (!first || !second) throw new Error('Need two curated groups');

    const balances = fund([...first.choices, ...second.choices]);
    const lead = (firstUsd: number, secondUsd: number) =>
      symbols(
        sortAssetGroups(
          groups,
          balances,
          priced([
            ...first.choices.map(c => [c, firstUsd] as const),
            ...second.choices.map(c => [c, secondUsd] as const),
          ]),
        ),
      )[0];

    expect(lead(100, 1)).toBe(first.symbol);
    expect(lead(1, 100)).toBe(second.symbol);
  });

  it('sums a holding across every network the asset reaches', () => {
    const spread = groups.find(group => group.choices.length > 1);
    const single = groups.find(group => group.choices.length === 1);
    if (!spread || !single) throw new Error('Need one multi-chain and one single-chain group');

    const [onlyOfSpread] = spread.choices;
    const [onlyOfSingle] = single.choices;
    // The single-chain asset wins on one network and loses once the other networks are counted.
    const prices = priced([...spread.choices.map(c => [c, 1] as const), [onlyOfSingle, 1.5]]);

    expect(symbols(sortAssetGroups(groups, fund([onlyOfSpread, onlyOfSingle]), prices))[0]).toBe(single.symbol);
    expect(symbols(sortAssetGroups(groups, fund([...spread.choices, onlyOfSingle]), prices))[0]).toBe(spread.symbol);
  });

  // A price refetch nudges every value a little. Tiles must not swap under a cursor because of it.
  it('treats values within a percent as equal, whichever way the nudge lands', () => {
    const [first, second] = groups.filter(group => isCurated(group.symbol));
    if (!first?.choices[0] || !second?.choices[0]) throw new Error('Need two curated groups');

    const a = first.choices[0];
    const b = second.choices[0];
    const order = (aUsd: number, bUsd: number) =>
      symbols(
        sortAssetGroups(
          groups,
          fund([a, b]),
          priced([
            [a, aUsd],
            [b, bUsd],
          ]),
        ),
      ).slice(0, 2);

    expect(order(100, 100.5)).toEqual(order(100.5, 100));
    expect(order(100, 100.5)).toEqual(order(100, 100));
  });

  // Without prices the held assets still have to land somewhere deliberate, not in arrival order.
  it('falls through to the curated order among held assets when nothing prices them', () => {
    const [first, second] = groups.filter(group => isCurated(group.symbol));
    if (!first || !second) throw new Error('Need two curated groups');

    const place = (symbol: string) =>
      [...PICKER_GROUP_A, ...PICKER_GROUP_B].findIndex(ranked => ranked.toLowerCase() === symbol.toLowerCase());
    const expected = [first.symbol, second.symbol].sort((a, b) => place(a) - place(b));

    expect(symbols(sortAssetGroups(groups, fund([...first.choices, ...second.choices]))).slice(0, 2)).toEqual(expected);
  });

  it('ranks without touching the grid it was given', () => {
    const before = symbols(groups);
    sortAssetGroups(groups, fund(CHOICES.slice(0, 5)));

    expect(symbols(groups)).toEqual(before);
  });
});

// The decided priority is Solana → NEAR → Sui → Bitcoin. These four slots are the only ranking the
// widget states, so an EVM chain reaching them is the regression to catch.
const PREFERRED = [
  ChainKeys.SOLANA_MAINNET,
  ChainKeys.NEAR_MAINNET,
  ChainKeys.SUI_MAINNET,
  ChainKeys.BITCOIN_MAINNET,
] as const;

describe('previewNetworks', () => {
  it('leads with the decided non-EVM priority in order', () => {
    const marked = previewNetworks([
      ChainKeys.BASE_MAINNET,
      ChainKeys.SUI_MAINNET,
      ChainKeys.SOLANA_MAINNET,
      ChainKeys.NEAR_MAINNET,
    ]);

    expect(marked).toEqual([
      ChainKeys.SOLANA_MAINNET,
      ChainKeys.NEAR_MAINNET,
      ChainKeys.SUI_MAINNET,
      ChainKeys.BASE_MAINNET,
    ]);
  });

  it('keeps an EVM chain out of the preview while a decided chain is still unplaced', () => {
    const marked = previewNetworks([ChainKeys.BASE_MAINNET, ChainKeys.ARBITRUM_MAINNET, ChainKeys.BITCOIN_MAINNET], 2);
    expect(marked[0]).toBe(ChainKeys.BITCOIN_MAINNET);
  });

  it('fills from the remaining list when a preferred chain is absent', () => {
    const exotic = CHAINS.filter(key => !(PREFERRED as readonly string[]).includes(key)).slice(0, 4);
    expect(exotic.length).toBeGreaterThan(0);
    expect(previewNetworks(exotic)).toEqual(exotic);
  });
});
