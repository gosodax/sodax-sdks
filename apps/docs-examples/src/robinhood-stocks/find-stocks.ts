// #region find-stocks
import { ChainKeys, isRealWorldAsset, Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

// Every tokenized stock and ETF the SDK can swap on Hedera.
const hederaStocks = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.HEDERA_MAINNET).filter(isRealWorldAsset);

for (const token of hederaStocks) {
  console.log(`${token.symbol}: ${token.address} (${token.decimals} decimals)`);
}
// #endregion find-stocks
