import type { Hex } from '@sodax/sdk';

// #region private-key-provider
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';
import { ChainKeys } from '@sodax/sdk';

const walletProvider = new EvmWalletProvider({
  privateKey, // private key of the Robinhood Chain account; keep it out of source control
  chainId: ChainKeys.ROBINHOOD_MAINNET,
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com', // rate-limited: use a provider endpoint in production
});
// #endregion private-key-provider

console.log(await walletProvider.getWalletAddress());

// Supplied by the reader, e.g. from an environment variable; declared here so the shown region compiles.
declare const privateKey: Hex;
