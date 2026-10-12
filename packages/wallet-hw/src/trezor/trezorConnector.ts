import { type Address, getAddress } from 'viem';
import { ChainNotConfiguredError, type CreateConnectorFn, createConnector } from 'wagmi';
import TrezorConnect from '@trezor/connect-web';
import { TREZOR_ICON } from '../shared/icons.js';
import { TrezorEvmProvider } from './TrezorEvmProvider.js';

/** Standard Trezor EVM derivation path (account 0). Trezor expects the `m/` prefix. */
const DEFAULT_DERIVATION_PATH = "m/44'/60'/0'/0/0";

/** Trezor Connect manifest — identifies the integrating app to Trezor. */
export type TrezorManifest = { email: string; appUrl: string; appName?: string };

/** Fully-resolved manifest passed to `TrezorConnect.init` (`appName` required by Connect). */
type ResolvedManifest = { email: string; appUrl: string; appName: string };

export type TrezorConnectorParameters = {
  /** Trezor Connect manifest. Defaults to a generic manifest using the page origin. */
  manifest?: TrezorManifest;
  /** BIP-32 derivation path. @default "m/44'/60'/0'/0/0" */
  derivationPath?: string;
  /** Stable wagmi connector id. @default 'sodaxTrezor' */
  id?: string;
  /** Display name shown in the wallet modal. @default 'Trezor' */
  name?: string;
};

// TrezorConnect.init() is a global singleton — calling it twice throws. Guard with a
// shared promise so multiple connector instances (and reconnects) share one init.
let initPromise: Promise<unknown> | undefined;
function ensureTrezorInit(manifest: ResolvedManifest): Promise<unknown> {
  if (!initPromise) {
    initPromise = TrezorConnect.init({ manifest, lazyLoad: true }).catch(error => {
      initPromise = undefined; // allow a retry on the next connect
      throw error;
    });
  }
  return initPromise;
}

function resolveManifest(manifest?: TrezorManifest): ResolvedManifest {
  return {
    appName: manifest?.appName ?? 'SODAX',
    email: manifest?.email ?? 'support@sodax.com',
    appUrl: manifest?.appUrl ?? globalThis.location?.origin ?? 'https://sodax.com',
  };
}

/**
 * A wagmi connector that signs EVM transactions and messages on a Trezor device via
 * `@trezor/connect-web` (the Trezor-hosted popup at `connect.trezor.io`).
 *
 * ```ts
 * import { trezorEvmConnectors } from '@sodax/wallet-hw';
 * const config = { EVM: { wagmiConnectors: trezorEvmConnectors() } };
 * ```
 *
 * Trezor Connect signs any EVM `chainId`, so all 12 SODAX EVM chains are reachable;
 * clear-display is limited to networks Trezor Suite recognises. Pass a `manifest`
 * (`{ email, appUrl }`) in production so Trezor can attribute traffic to your app.
 */
export function trezorConnector(parameters: TrezorConnectorParameters = {}): CreateConnectorFn<TrezorEvmProvider> {
  const { derivationPath = DEFAULT_DERIVATION_PATH, id = 'sodaxTrezor', name = 'Trezor' } = parameters;
  const manifest = resolveManifest(parameters.manifest);

  return createConnector<TrezorEvmProvider>(config => {
    let provider: TrezorEvmProvider | undefined;
    let account: Address | undefined;
    let connectedChainId: number | undefined;

    const reset = () => {
      provider = undefined;
      account = undefined;
      connectedChainId = undefined;
    };

    return {
      id,
      name,
      type: 'trezor',
      icon: TREZOR_ICON,

      async connect({ chainId } = {}) {
        const targetChainId = chainId ?? connectedChainId ?? config.chains[0].id;
        await ensureTrezorInit(manifest);
        const result = await TrezorConnect.ethereumGetAddress({ path: derivationPath, showOnTrezor: false });
        if (!result.success) throw new Error(`[wallet-hw] Trezor connect failed: ${result.payload.error}`);
        account = getAddress(result.payload.address);
        connectedChainId = targetChainId;
        provider = new TrezorEvmProvider({
          derivationPath,
          account,
          chainId: targetChainId,
          chains: config.chains,
          transports: config.transports,
        });
        config.emitter.emit('connect', { accounts: [account], chainId: targetChainId });
        return { accounts: [account], chainId: targetChainId };
      },

      async disconnect() {
        // No per-session teardown — TrezorConnect.dispose() is global and would break
        // other connectors. Just drop local state.
        reset();
      },

      async getAccounts() {
        return account ? [account] : [];
      },

      async getChainId() {
        return connectedChainId ?? config.chains[0].id;
      },

      async getProvider() {
        if (!provider) {
          throw new Error('[wallet-hw] Trezor provider unavailable — connect() must complete first');
        }
        return provider;
      },

      // Hardware wallets never auto-reconnect (would spawn the Trezor popup on mount).
      async isAuthorized() {
        return false;
      },

      async switchChain({ chainId }) {
        const chain = config.chains.find(c => c.id === chainId);
        if (!chain) throw new ChainNotConfiguredError();
        connectedChainId = chainId;
        provider?.setChainId(chainId);
        config.emitter.emit('change', { chainId });
        return chain;
      },

      onAccountsChanged(accounts) {
        if (accounts.length === 0) {
          reset();
          config.emitter.emit('disconnect');
        } else {
          config.emitter.emit('change', { accounts: accounts.map(a => getAddress(a)) });
        }
      },

      onChainChanged(chainId) {
        const id = Number(chainId);
        connectedChainId = id;
        provider?.setChainId(id);
        config.emitter.emit('change', { chainId: id });
      },

      onDisconnect() {
        reset();
        config.emitter.emit('disconnect');
      },
    };
  });
}

/**
 * Convenience array form for the `wagmiConnectors` config field:
 * `EVM: { wagmiConnectors: trezorEvmConnectors() }`.
 */
export function trezorEvmConnectors(parameters?: TrezorConnectorParameters): CreateConnectorFn<TrezorEvmProvider>[] {
  return [trezorConnector(parameters)];
}
