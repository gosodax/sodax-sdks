import { type ChainKey, ChainKeys, type XToken, baseChainInfo } from '@sodax/dapp-kit';
import { EXECUTABLE_CHAIN_TYPES, type ExecutableChainType } from './execution';

/** Typed against the executable list, so a family added there cannot ship without a name here. */
const EXECUTABLE_FAMILY_NAMES: Record<ExecutableChainType, string> = {
  EVM: 'EVM',
  SOLANA: 'Solana',
  SUI: 'Sui',
  STELLAR: 'Stellar',
  NEAR: 'NEAR',
  STACKS: 'Stacks',
  INJECTIVE: 'Injective',
};

/**
 * A URL or an API response is a string until it matches a key `baseChainInfo` can name and badge.
 * `Object.hasOwn`, not `in`: `in` walks the prototype, so `?srcChain=toString` would pass and then
 * index a function that has no `name` or `logo` to render.
 */
export function isChainKey(value: string): value is ChainKey {
  return Object.hasOwn(baseChainInfo, value);
}

/** A token together with the key of the chain it lives on, so one pick sets both. */
export type TokenChoice<K extends ChainKey = ChainKey> = { chain: K; token: XToken };

export function chainLogo(key: ChainKey): string {
  return baseChainInfo[key].logo;
}

export function chainName(key: ChainKey): string {
  return baseChainInfo[key].name;
}

export function txExplorerUrl(key: ChainKey, txHash: string): string {
  return `${baseChainInfo[key].explorer.txUrl}${txHash}`;
}

/** The wallet families that sign in-widget, as the sentence fragment the builder shows partners. */
export function executableFamilies(): string {
  const names = EXECUTABLE_CHAIN_TYPES.map(type => EXECUTABLE_FAMILY_NAMES[type]);
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(names);
}

/** Renders a chain key as the `ChainKeys.X` expression a reader should paste, not its raw value. */
export function chainKeyExpression(key: ChainKey): string {
  const name = Object.entries(ChainKeys).find(([, value]) => value === key)?.[0];
  return name ? `ChainKeys.${name}` : JSON.stringify(key);
}
