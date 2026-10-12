import type Eth from '@ledgerhq/hw-app-eth';
import type Transport from '@ledgerhq/hw-transport';
import { type Address, getAddress } from 'viem';
import { ChainNotConfiguredError, type CreateConnectorFn, createConnector } from 'wagmi';
import { LEDGER_ICON } from '../shared/icons.js';
import { LedgerEvmProvider } from './LedgerEvmProvider.js';
import { type LedgerTransportKind, createLedgerTransport, getEthApp } from './transport.js';

/** Standard Ledger Live EVM derivation path (account 0). */
const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

export type LedgerConnectorParameters = {
  /** USB transport. WebHID (default) is most reliable; WebUSB is a fallback. */
  transport?: LedgerTransportKind;
  /** BIP-32 derivation path. @default "44'/60'/0'/0/0" */
  derivationPath?: string;
  /** Stable wagmi connector id. @default 'sodaxLedger' */
  id?: string;
  /** Display name shown in the wallet modal. @default 'Ledger' */
  name?: string;
};

/**
 * A wagmi connector that signs EVM transactions and messages on a Ledger device.
 *
 * Pass it to the EVM slot of `SodaxWalletProvider` via the `wagmiConnectors` field:
 *
 * ```ts
 * import { ledgerEvmConnectors } from '@sodax/wallet-hw';
 * const config = { EVM: { wagmiConnectors: ledgerEvmConnectors() } };
 * ```
 *
 * Covers all 12 SODAX EVM chains — the Ledger Ethereum app signs by chain id (chains
 * outside the device's clear-signing registry fall back to blind-signing). Desktop
 * Chromium only (WebHID/WebUSB); `connect()` must run inside a user gesture.
 */
export function ledgerConnector(parameters: LedgerConnectorParameters = {}): CreateConnectorFn<LedgerEvmProvider> {
  const {
    transport: transportKind = 'webhid',
    derivationPath = DEFAULT_DERIVATION_PATH,
    id = 'sodaxLedger',
    name = 'Ledger',
  } = parameters;

  return createConnector<LedgerEvmProvider>(config => {
    let hwTransport: Transport | undefined;
    let eth: Eth | undefined;
    let provider: LedgerEvmProvider | undefined;
    let account: Address | undefined;
    let connectedChainId: number | undefined;

    const reset = () => {
      hwTransport = undefined;
      eth = undefined;
      provider = undefined;
      account = undefined;
      connectedChainId = undefined;
    };

    return {
      id,
      name,
      type: 'ledger',
      icon: LEDGER_ICON,

      async connect({ chainId } = {}) {
        const targetChainId = chainId ?? connectedChainId ?? config.chains[0].id;
        if (!hwTransport) hwTransport = await createLedgerTransport(transportKind);
        if (!eth) eth = getEthApp(hwTransport);
        const { address } = await eth.getAddress(derivationPath);
        account = getAddress(address);
        connectedChainId = targetChainId;
        provider = new LedgerEvmProvider({
          eth,
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
        try {
          await hwTransport?.close();
        } catch {
          // Device may already be unplugged — ignore close failure, state is cleared below.
        } finally {
          reset();
        }
      },

      async getAccounts() {
        return account ? [account] : [];
      },

      async getChainId() {
        return connectedChainId ?? config.chains[0].id;
      },

      async getProvider() {
        if (!provider) {
          throw new Error('[wallet-hw] Ledger provider unavailable — connect() must complete first');
        }
        return provider;
      },

      // Hardware wallets never auto-reconnect: returning false stops wagmi from
      // waking the device on mount (which would also fail without a user gesture).
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
 * `EVM: { wagmiConnectors: ledgerEvmConnectors() }`.
 */
export function ledgerEvmConnectors(parameters?: LedgerConnectorParameters): CreateConnectorFn<LedgerEvmProvider>[] {
  return [ledgerConnector(parameters)];
}
