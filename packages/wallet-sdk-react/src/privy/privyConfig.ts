import type { PrivyClientConfig } from '@privy-io/react-auth';
import type { EvmChainKey } from '@sodax/types';
import type { PrivySourceContext } from '@/providers/evm/privySource.js';
import { SODAX_EVM_CHAINS } from '@/xchains/evm/EvmXService.js';

export type PrivyOptions = {
  /** Your Privy app id (dashboard.privy.io). Users and their wallets belong to this app. */
  appId: string;
  /** Privy app client id, for per-environment client settings. */
  clientId?: string;
  /** Chain the embedded wallet starts on. @default ChainKeys.SONIC_MAINNET */
  defaultChain?: EvmChainKey;
  /** Show Privy's signing confirmation UI. Omitted → your Privy dashboard setting applies. */
  showWalletUIs?: boolean;
  /**
   * What an SDK disconnect does to the Privy session. `'logout'` signs the user out, so the next connect asks for
   * a new code — the safe choice on shared devices. `'detach'` only drops the wallet from the app: reconnecting
   * needs no code while the Privy session lasts. @default 'logout'
   */
  disconnectBehavior?: 'logout' | 'detach';
  /** Privy modal theming. Its wallet list is always empty: other wallets come from the SDK's own list. */
  appearance?: Omit<NonNullable<PrivyClientConfig['appearance']>, 'walletList'>;
  /** Terms and privacy links shown in Privy's login modal. */
  legal?: PrivyClientConfig['legal'];
};

/**
 * The `PrivyProvider` config the SDK mounts. Email login only, with Privy's own wallet connectors off so
 * it does not stand up a second WalletConnect / Coinbase stack beside the SDK's. Every chain carries a
 * `privyWalletOverride` RPC, because the embedded wallet estimates and broadcasts through it rather than
 * through wagmi's transports. No `mfa` or recovery keys: Privy's defaults keep its MFA prompt working.
 */
export function buildPrivyConfig(
  options: PrivyOptions,
  defaultChainId: number,
  ctx: PrivySourceContext,
): PrivyClientConfig {
  const supportedChains = SODAX_EVM_CHAINS.map(chain => {
    const url = ctx.rpcUrls[chain.id];
    return {
      ...chain,
      rpcUrls: { ...chain.rpcUrls, privyWalletOverride: { http: url ? [url] : chain.rpcUrls.default.http } },
    };
  });
  return {
    loginMethods: ['email'],
    appearance: { ...options.appearance, walletList: [] },
    externalWallets: { disableAllExternalWallets: true, walletConnect: { enabled: false } },
    embeddedWallets: {
      ethereum: { createOnLogin: 'users-without-wallets' },
      ...(options.showWalletUIs === undefined ? {} : { showWalletUIs: options.showWalletUIs }),
    },
    supportedChains,
    defaultChain: supportedChains.find(chain => chain.id === defaultChainId),
    ...(options.legal ? { legal: options.legal } : {}),
  };
}
