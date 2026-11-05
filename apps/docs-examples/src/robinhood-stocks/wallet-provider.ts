// #region wallet-provider
import { ChainKeys, type Hex, type IEvmWalletProvider, spokeChainConfig } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

const hederaWalletProvider: IEvmWalletProvider = new EvmWalletProvider({
  privateKey, // Node.js only; never ship a private key to a browser
  chainId: ChainKeys.HEDERA_MAINNET,
  rpcUrl: spokeChainConfig[ChainKeys.HEDERA_MAINNET].rpcUrl, // the SDK default; use your own node in production
});
// #endregion wallet-provider

console.log(await hederaWalletProvider.getWalletAddress());

// Supplied by the reader; declared here so the shown region compiles.
declare const privateKey: Hex;
