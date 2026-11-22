import { ChainKeys, Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

// #region many-tokens
const tokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET);

const result = await sodax.spoke.getWalletBalances({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: userAddress,
  tokens,
});

if (result.ok) {
  for (const token of tokens) {
    const balance = result.value[token.address] ?? 0n;
    console.log(token.symbol, balance);
  }
}
// #endregion many-tokens

// Supplied by the reader; declared here so the shown region compiles.
declare const userAddress: `0x${string}`;
