import type { Sodax, SpokeChainKey } from '@sodax/sdk';

export type ConnectedWallet = { chainKey: SpokeChainKey; address: string };
export type NetworkBalances = { chainKey: SpokeChainKey; balances: Record<string, bigint> | null };

/** One read per network; a failed network resolves to null instead of hiding the rest. */
export function readPortfolio(sodax: Sodax, wallets: readonly ConnectedWallet[]): Promise<NetworkBalances>[] {
  return wallets.map(async ({ chainKey, address }) => {
    const tokens = sodax.swaps.getSupportedSwapTokensByChainId(chainKey);
    const result = await sodax.spoke.getWalletBalances({ srcChainKey: chainKey, srcAddress: address, tokens });
    return { chainKey, balances: result.ok ? result.value : null };
  });
}

/** Scales a smallest-unit bigint by the token's decimals without losing precision. */
export const formatAmount = (value: bigint, decimals: number): string => {
  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};
