// #region asset-discovery
import { Sodax, ChainKeys } from '@sodax/sdk';

const sodax = new Sodax();

// Swappable assets on Robinhood Chain
const swapTokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ROBINHOOD_MAINNET);

// Money market assets on Robinhood Chain
const mmTokens = sodax.moneyMarket.getSupportedTokensByChainId(ChainKeys.ROBINHOOD_MAINNET);
// #endregion asset-discovery

console.log(swapTokens, mmTokens);
