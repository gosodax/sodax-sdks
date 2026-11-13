import type { BrowserExtensionEvmWalletConfig } from '@sodax/wallet-sdk-core';

// #region browser-extension-provider
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

// walletClient and publicClient are viem clients for Robinhood Chain,
// usually supplied by wagmi from the user's connected EVM wallet
const walletProvider = new EvmWalletProvider({
  walletClient,
  publicClient,
});
// #endregion browser-extension-provider

console.log(await walletProvider.getWalletAddress());

// Supplied by the reader's wagmi setup; declared here so the shown region compiles.
declare const walletClient: BrowserExtensionEvmWalletConfig['walletClient'];
declare const publicClient: BrowserExtensionEvmWalletConfig['publicClient'];
