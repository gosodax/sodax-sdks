// #region one-token
import { ChainKeys, Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

const tokens = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.ARBITRUM_MAINNET);
const usdc = tokens.find(t => t.symbol === 'USDC');
if (!usdc) throw new Error('USDC is not supported on Arbitrum');

const result = await sodax.spoke.getWalletBalance({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: userAddress,
  token: usdc,
});

if (result.ok) {
  console.log(result.value); // bigint, in the token's smallest unit
} else {
  console.error(result.error);
}
// #endregion one-token

// Supplied by the reader; declared here so the shown region compiles.
declare const userAddress: `0x${string}`;
