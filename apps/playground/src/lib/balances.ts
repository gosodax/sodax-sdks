import type { ChainKey } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import type { TokenChoice } from './chains';
import { formatTokenAmount } from './format';

/** Wallet balances by chain, then by token address — one chain's `useBalances` map per chain key. */
export type BalanceMap = Readonly<Record<string, Readonly<Record<string, bigint>>>>;

/** The picker's digits: the exchange's four, which is what fits a 72px tile. */
const PICKER_DECIMALS = 4;

function held(amount: bigint, decimals: number): string | undefined {
  return amount > 0n ? formatTokenAmount(formatUnits(amount, decimals), PICKER_DECIMALS) : undefined;
}

export function tokenBalance<K extends ChainKey>(balances: BalanceMap, choice: TokenChoice<K>): bigint {
  return balances[choice.chain]?.[choice.token.address] ?? 0n;
}

/**
 * What the wallet holds of one asset across every chain it reaches, scaled to the widest decimals
 * in the group: the same symbol is six decimals on one chain and eighteen on another, so the raw
 * amounts cannot be summed as they stand.
 */
export function groupBalance<K extends ChainKey>(
  balances: BalanceMap,
  choices: readonly TokenChoice<K>[],
): { amount: bigint; decimals: number } {
  const decimals = choices.reduce((widest, choice) => Math.max(widest, choice.token.decimals), 0);
  const amount = choices.reduce(
    (total, choice) => total + tokenBalance(balances, choice) * 10n ** BigInt(decimals - choice.token.decimals),
    0n,
  );

  return { amount, decimals };
}

/** The asset's total across networks, or nothing when the wallet holds none of it. */
export function groupBalanceText<K extends ChainKey>(
  balances: BalanceMap,
  choices: readonly TokenChoice<K>[],
): string | undefined {
  const { amount, decimals } = groupBalance(balances, choices);
  return held(amount, decimals);
}

/** What the wallet holds on one chain, or nothing — which is what leaves the network unmarked. */
export function tokenBalanceText<K extends ChainKey>(balances: BalanceMap, choice: TokenChoice<K>): string | undefined {
  return held(tokenBalance(balances, choice), choice.token.decimals);
}
