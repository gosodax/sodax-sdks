import { ChainKeys, type ChainKey } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { type BalanceMap, tokenBalance } from './balances';
import type { TokenChoice } from './chains';
import { PICKER_GROUP_A, PICKER_GROUP_B } from './pickerRanking';

/** One asset, and every chain that offers it. The picker's grid is one tile per group. */
export type AssetGroup<K extends ChainKey = ChainKey> = {
  symbol: string;
  choices: readonly TokenChoice<K>[];
};

/**
 * Chain plus symbol, never address: a `withdrawOnly` entry shares its on-chain address with the
 * active token it deprecates (`WBTC` / `WBTC.legacy`), so an address-keyed id addresses both rows
 * at once. Symbol is also what `pickToken` re-resolves by, so the id and the flow agree.
 */
export function tokenOptionId(chain: ChainKey, symbol: string): string {
  return `${chain}:${symbol}`;
}

/**
 * Groups tokens by symbol — one tile per group. Alphabetical because the wallet decides the real
 * order and only the picker has read it: `sortAssetGroups` ranks these once balances are in.
 */
export function assetGroups<K extends ChainKey>(choices: readonly TokenChoice<K>[]): AssetGroup<K>[] {
  const bySymbol = new Map<string, TokenChoice<K>[]>();

  for (const choice of choices) {
    const group = bySymbol.get(choice.token.symbol);
    if (group) group.push(choice);
    else bySymbol.set(choice.token.symbol, [choice]);
  }

  return [...bySymbol]
    .map(([symbol, group]) => ({ symbol, choices: group }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** USD per whole token, keyed by `tokenOptionId` — the same chain-and-symbol id the picker selects by. */
export type PriceMap = Readonly<Record<string, number>>;

const rankIndex = (symbols: readonly string[]) =>
  new Map(symbols.map((symbol, index) => [symbol.toLowerCase(), index]));

const GROUP_A_RANK = rankIndex(PICKER_GROUP_A);
const GROUP_B_RANK = rankIndex(PICKER_GROUP_B);

/** Curated tier, then the fixed position within it. Tier 2 is everything the lists do not name. */
function curatedRank(symbol: string): [tier: number, place: number] {
  const key = symbol.toLowerCase();
  const inA = GROUP_A_RANK.get(key);
  if (inA !== undefined) return [0, inA];

  const inB = GROUP_B_RANK.get(key);
  return inB !== undefined ? [1, inB] : [2, 0];
}

/** What the wallet holds of one asset in USD, summed over every network it reaches. */
function groupValue<K extends ChainKey>(
  balances: BalanceMap,
  prices: PriceMap,
  choices: readonly TokenChoice<K>[],
): number {
  return choices.reduce((total, choice) => {
    const amount = tokenBalance(balances, choice);
    if (amount <= 0n) return total;

    const price = prices[tokenOptionId(choice.chain, choice.token.symbol)] ?? 0;
    return total + Number(formatUnits(amount, choice.token.decimals)) * price;
  }, 0);
}

/** Values within a percent of the larger count as equal, so a price refetch cannot reshuffle tiles. */
const VALUE_EQUAL_FRACTION = 0.01;

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1) < VALUE_EQUAL_FRACTION;
}

/**
 * The exchange's picker order, as five rules each breaking the tie the last one left: what the
 * wallet holds anywhere, then that holding's USD total, then the curated tier, then the fixed place
 * inside it, then alphabetical. Alphabetical is total over distinct symbols, so the whole order is
 * deterministic and the same input always lands the same way.
 *
 * `prices` is optional and nothing in the widget prices an asset yet. Without it, held assets fall
 * through to the curated order rather than to an arbitrary one — which is a weaker order, not a
 * broken one, and it is the only seam a price source has to fill.
 */
export function sortAssetGroups<K extends ChainKey>(
  groups: readonly AssetGroup<K>[],
  balances: BalanceMap,
  prices?: PriceMap,
): AssetGroup<K>[] {
  const valued = prices !== undefined && Object.keys(prices).length > 0;

  return [...groups].sort((a, b) => {
    const aHeld = a.choices.some(choice => tokenBalance(balances, choice) > 0n);
    const bHeld = b.choices.some(choice => tokenBalance(balances, choice) > 0n);
    if (aHeld !== bHeld) return aHeld ? -1 : 1;

    if (aHeld && bHeld && valued) {
      const aValue = groupValue(balances, prices, a.choices);
      const bValue = groupValue(balances, prices, b.choices);
      if (!sameValue(aValue, bValue)) return bValue - aValue;
    }

    const [aTier, aPlace] = curatedRank(a.symbol);
    const [bTier, bPlace] = curatedRank(b.symbol);
    return aTier - bTier || aPlace - bPlace || a.symbol.localeCompare(b.symbol);
  });
}

/** Symbol, name or pasted contract address — an address reaches the asset it belongs to. */
function matches<K extends ChainKey>(choice: TokenChoice<K>, needle: string): boolean {
  return [choice.token.symbol, choice.token.name, choice.token.address].some(value =>
    value.toLowerCase().includes(needle),
  );
}

/** Case-insensitive search, and — when a network is picked — only groups that reach it. */
export function filterGroups<K extends ChainKey>(
  groups: readonly AssetGroup<K>[],
  query: string,
  network: K | undefined,
): AssetGroup<K>[] {
  const needle = query.trim().toLowerCase();

  const kept = groups.reduce<AssetGroup<K>[]>((kept, group) => {
    const choices = network ? group.choices.filter(choice => choice.chain === network) : group.choices;
    if (choices.length === 0) return kept;
    if (needle && !choices.some(choice => matches(choice, needle))) return kept;

    kept.push({ symbol: group.symbol, choices });
    return kept;
  }, []);

  // The exchange leads with an exact symbol match, so "s" finds S rather than burying it under the
  // symbols that merely contain it. Sort is stable, so everything else keeps its ranked order.
  if (!needle) return kept;
  return kept.sort((a, b) => Number(b.symbol.toLowerCase() === needle) - Number(a.symbol.toLowerCase() === needle));
}

/** The decided non-EVM priority, which is what the first four networks are for. Rest of list follows. */
const MARK_ORDER: readonly ChainKey[] = [
  ChainKeys.SOLANA_MAINNET,
  ChainKeys.NEAR_MAINNET,
  ChainKeys.SUI_MAINNET,
  ChainKeys.BITCOIN_MAINNET,
];

export function previewNetworks<K extends ChainKey>(networks: readonly K[], count = 4): K[] {
  const preferred = MARK_ORDER.filter((key): key is K => (networks as readonly ChainKey[]).includes(key));
  const rest = networks.filter(key => !preferred.includes(key));
  return [...preferred, ...rest].slice(0, count);
}
