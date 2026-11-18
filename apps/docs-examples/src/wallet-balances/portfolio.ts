// #region portfolio
import type { Sodax, SpokeChainKey } from '@sodax/sdk';

export async function readPortfolio(sodax: Sodax, wallets: { chainKey: SpokeChainKey; address: string }[]) {
  return Promise.all(
    wallets.map(async ({ chainKey, address }) => {
      const tokens = sodax.swaps.getSupportedSwapTokensByChainId(chainKey);
      const result = await sodax.spoke.getWalletBalances({ srcChainKey: chainKey, srcAddress: address, tokens });
      return { chainKey, balances: result.ok ? result.value : null };
    }),
  );
}
// #endregion portfolio
