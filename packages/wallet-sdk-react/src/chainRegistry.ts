import {
  type ChainType,
  ChainKeys,
  ChainTypeArr,
  detectBitcoinAddressType,
  usesBip322MessageSigning,
} from '@sodax/types';
import {
  IconWalletProvider,
  InjectiveWalletProvider,
  StellarWalletProvider,
  NearWalletProvider,
  StacksWalletProvider,
  TronWalletProvider,
} from '@sodax/wallet-sdk-core';
import { Wallet } from '@injectivelabs/wallet-base';
import { getEthereumAddress } from '@injectivelabs/sdk-ts';

import { XConnector, type XService } from './core/index.js';
import type { IWalletProvider, XConnection } from './types/index.js';
import type { IXConnector } from './types/interfaces.js';
import type { SodaxWalletConfig } from './types/config.js';
import type { ChainActions, ChainActionsRegistry } from './types/chainActions.js';
import { getEntryDefaults, getRpcUrl } from './utils/walletRpcConfig.js';

import { EvmXService } from './xchains/evm/index.js';
import { SolanaXService } from './xchains/solana/SolanaXService.js';
import { SuiXService } from './xchains/sui/index.js';
import { StellarXService, StellarWalletsKitXConnector } from './xchains/stellar/index.js';
import type { StellarWalletType } from './xchains/stellar/StellarWalletsKitXConnector.js';
import { IconXService, CHAIN_INFO, SupportedChainId } from './xchains/icon/index.js';
import { IconHanaXConnector } from './xchains/icon/IconHanaXConnector.js';
import { InjectiveXConnector, InjectiveXService } from './xchains/injective/index.js';
import { BitcoinXService } from './xchains/bitcoin/index.js';
import { UnisatXConnector } from './xchains/bitcoin/UnisatXConnector.js';
import { XverseXConnector } from './xchains/bitcoin/XverseXConnector.js';
import { OKXXConnector } from './xchains/bitcoin/OKXXConnector.js';
import { BitcoinHanaXConnector } from './xchains/bitcoin/BitcoinHanaXConnector.js';
import { BitcoinXConnector } from './xchains/bitcoin/BitcoinXConnector.js';
import { hasSignBip322, hasSignEcdsa } from './xchains/bitcoin/bitcoinSignGuards.js';
import { NearXService } from './xchains/near/NearXService.js';
import { NearXConnector } from './xchains/near/NearXConnector.js';
import { StacksXService, StacksXConnector, STACKS_PROVIDERS } from './xchains/stacks/index.js';
import { TronXService, TronXConnector } from './xchains/tron/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Store accessor — avoids circular dependency with useXWalletStore */
export type StoreAccessor = () => {
  xConnections: Partial<Record<ChainType, XConnection>>;
  xConnectorsByChain: Partial<Record<ChainType, XConnector[]>>;
  xServices: Partial<Record<ChainType, XService>>;
  setXConnectors: (xChainType: ChainType, connectors: XConnector[]) => void;
  unsetXConnection: (xChainType: ChainType) => void;
  setWalletProvider: (xChainType: ChainType, provider: IWalletProvider | undefined) => void;
  /**
   * User-supplied `SodaxWalletConfig` (per-chain-type slots, each with adapter
   * settings + nested chains map). Source of `defaults` forwarded to core
   * wallet provider constructors for non-provider chains.
   */
  walletConfig: SodaxWalletConfig | undefined;
};

export type ChainServiceFactory<S extends XService = XService> = {
  /** Create or get the XService singleton for this chain. */
  createService(walletConfig?: SodaxWalletConfig): S;
  /** Human-readable chain name for display in modal UIs. */
  displayName: string;
  /** Optional icon URL for the chain. Consumers can override when rendering. */
  iconUrl?: string;
  /**
   * Static connectors known at build time. Ignored for provider-managed chains.
   * `walletConfig` is forwarded so chains whose connectors construct wallet
   * providers eagerly (e.g. Bitcoin) can read per-chain-id `defaults` at
   * registration time.
   */
  defaultConnectors(walletConfig?: SodaxWalletConfig): XConnector[];
  /** true = needs React provider (EVM/Solana/Sui), false = browser extension APIs. */
  providerManaged: boolean;
  /** ChainActions for non-provider chains. If omitted, uses createDefaultActions(). */
  createActions?(service: S, getStore: StoreAccessor): ChainActions;
  /** Wallet provider for non-provider chains. Called on setXConnection(). */
  createWalletProvider?(service: S, getStore: StoreAccessor): IWalletProvider | undefined;
  /**
   * Async connector discovery for chains whose available wallets can only be detected at runtime
   * (e.g. browser extension scan, manifest loading). Runs once after init, updates store.xConnectorsByChain when done.
   * Use when wallet detection requires async operations — if connectors are known statically, use defaultConnectors() instead.
   *
   * Example: Stellar scans for installed browser wallets via walletsKit.getSupportedWallets(),
   * NEAR loads wallet manifest via walletSelector.whenManifestLoaded.
   */
  discoverConnectors?(service: S, getStore: StoreAccessor): Promise<void>;
};

/**
 * Define a chain service factory. Infers `S` from `createService` so all callbacks
 * (createActions, createWalletProvider, discoverConnectors) get the concrete service type,
 * then erases to the base ChainServiceFactory for storage in the registry.
 */
function defineChain<S extends XService>(factory: ChainServiceFactory<S>): ChainServiceFactory {
  return factory;
}

export type ChainServicesResult = {
  xServices: Partial<Record<ChainType, XService>>;
  xConnectorsByChain: Partial<Record<ChainType, IXConnector[]>>;
  enabledChains: ChainType[];
  chainActions: ChainActionsRegistry;
};

// ─── Connector helpers ─────────────────────────────────────────────────────

/**
 * Validate that consumer-supplied connectors (typed against the public
 * `IXConnector` interface) are actual `XConnector` instances. Required at the
 * connectors override boundary because the SDK stores `XConnector[]` internally
 * — `getXConnectorById` and chain-specific subclass methods rely on the
 * abstract class default behavior.
 */
function narrowConnectors(items: readonly IXConnector[], chainType: ChainType): XConnector[] {
  return items.filter((item): item is XConnector => {
    if (!(item instanceof XConnector)) {
      console.warn(
        `[chainRegistry] ${chainType} connector "${item.id}" must extend XConnector — skipping. Implement the abstract XConnector class instead of raw IXConnector for full SDK support.`,
      );
      return false;
    }
    return true;
  });
}

/** Read `connectors` override from the matching chain-type slot, if any. */
function readConnectorsOverride(
  chainType: ChainType,
  walletConfig: SodaxWalletConfig | undefined,
): readonly IXConnector[] | undefined {
  return walletConfig?.[chainType]?.connectors;
}

/** Returns `true` if the chain-type slot is present in `walletConfig`. */
function hasChainOfType(chainType: ChainType, walletConfig: SodaxWalletConfig): boolean {
  return walletConfig[chainType] !== undefined;
}

// ─── Default Actions Helper ─────────────────────────────────────────────────

const createDefaultActions = (chainType: ChainType, service: XService, getStore: StoreAccessor): ChainActions => ({
  connect: async (xConnectorId: string) => {
    const connector = service.getXConnectorById(xConnectorId);
    return connector?.connect();
  },
  disconnect: async () => {
    const store = getStore();
    const connectorId = store.xConnections[chainType]?.xConnectorId;
    const connector = connectorId ? service.getXConnectorById(connectorId) : undefined;
    // Clear store even if wallet.disconnect() throws — UI must not get stuck "connected".
    try {
      await connector?.disconnect();
    } finally {
      store.unsetXConnection(chainType);
    }
  },
  getConnectors: () => getStore().xConnectorsByChain[chainType] ?? [],
  getConnection: () => getStore().xConnections[chainType],
});

// ─── Chain Registry ──────────────────────────────────────────────────────────

export const chainRegistry: Record<string, ChainServiceFactory> = {
  EVM: defineChain({
    createService: () => EvmXService.getInstance(),
    displayName: 'EVM',
    defaultConnectors: () => [],
    providerManaged: true,
  }),
  SUI: defineChain({
    createService: () => SuiXService.getInstance(),
    displayName: 'Sui',
    defaultConnectors: () => [],
    providerManaged: true,
  }),
  SOLANA: defineChain({
    createService: () => SolanaXService.getInstance(),
    displayName: 'Solana',
    defaultConnectors: () => [],
    providerManaged: true,
  }),
  BITCOIN: defineChain({
    createService: walletConfig =>
      BitcoinXService.getInstance(getRpcUrl(walletConfig?.BITCOIN?.chains?.[ChainKeys.BITCOIN_MAINNET])),
    displayName: 'Bitcoin',
    defaultConnectors: (walletConfig?: SodaxWalletConfig) => {
      const defaults = getEntryDefaults<typeof ChainKeys.BITCOIN_MAINNET>(
        walletConfig?.BITCOIN?.chains?.[ChainKeys.BITCOIN_MAINNET],
      );
      return [
        new UnisatXConnector(defaults),
        new XverseXConnector(defaults),
        new OKXXConnector(defaults),
        new BitcoinHanaXConnector(defaults),
      ];
    },
    providerManaged: false,
    createActions: (service, getStore) => ({
      ...createDefaultActions('BITCOIN', service, getStore),
      signMessage: async (message: string) => {
        const store = getStore();
        const connection = store.xConnections.BITCOIN;
        const connector = connection?.xConnectorId ? service.getXConnectorById(connection.xConnectorId) : undefined;
        if (!connection || !(connector instanceof BitcoinXConnector)) {
          throw new Error('Bitcoin wallet not connected');
        }
        const address = connection.xAccount.address;
        if (!address) throw new Error('Bitcoin address not found');
        // Signing lives on the wallet provider, not on the connector. Prefer the live one from
        // `connect()`; after a page reload that is gone, so rebuild it from the stored account —
        // same lookup as `createWalletProvider` below.
        const walletProvider = connector.getWalletProvider() ?? connector.recreateWalletProvider(connection.xAccount);
        if (!walletProvider) {
          throw new Error(`${connector.id} has no wallet provider`);
        }
        // Pick the message-signing scheme by address type: P2WPKH/P2TR sign via BIP322, P2SH/P2PKH via ECDSA.
        if (usesBip322MessageSigning(detectBitcoinAddressType(address))) {
          if (!hasSignBip322(walletProvider)) {
            throw new Error(`${connector.id} does not support BIP-322 signing`);
          }
          return walletProvider.signBip322Message(message);
        }
        if (!hasSignEcdsa(walletProvider)) {
          throw new Error(`${connector.id} does not support ECDSA signing`);
        }
        return walletProvider.signEcdsaMessage(message);
      },
    }),
    createWalletProvider: (service, getStore) => {
      const store = getStore();
      const connection = store.xConnections.BITCOIN;
      if (!connection?.xConnectorId) return undefined;
      const connector = service.getXConnectorById(connection.xConnectorId);
      if (!(connector instanceof BitcoinXConnector)) return undefined;
      return connector.recreateWalletProvider(connection.xAccount);
    },
  }),
  INJECTIVE: defineChain({
    createService: walletConfig =>
      InjectiveXService.getInstance(walletConfig?.INJECTIVE?.chains?.[ChainKeys.INJECTIVE_MAINNET]),
    displayName: 'Injective',
    defaultConnectors: () => [
      new InjectiveXConnector('MetaMask', Wallet.Metamask),
      new InjectiveXConnector('Keplr', Wallet.Keplr),
      new InjectiveXConnector('Leap', Wallet.Leap),
    ],
    providerManaged: false,
    createActions: (service, getStore) => ({
      ...createDefaultActions('INJECTIVE', service, getStore),
      signMessage: async (message: string) => {
        const store = getStore();
        const address = store.xConnections.INJECTIVE?.xAccount.address;
        if (!address) throw new Error('Injective address not found');

        const ethereumAddress = getEthereumAddress(address);
        const walletStrategy = service.walletStrategy;
        const res = await walletStrategy.signArbitrary(
          walletStrategy.getWallet() === Wallet.Metamask ? ethereumAddress : address,
          message,
        );
        if (!res) throw new Error('Injective signature not found');
        return res;
      },
    }),
    createWalletProvider: (service, getStore) => {
      if (!service) return undefined;
      const defaults = getEntryDefaults<typeof ChainKeys.INJECTIVE_MAINNET>(
        getStore().walletConfig?.INJECTIVE?.chains?.[ChainKeys.INJECTIVE_MAINNET],
      );
      return new InjectiveWalletProvider({ msgBroadcaster: service.msgBroadcaster, defaults });
    },
  }),
  STELLAR: defineChain({
    createService: walletConfig => {
      const stellarRpc = walletConfig?.STELLAR?.chains?.[ChainKeys.STELLAR_MAINNET];
      return StellarXService.getInstance(stellarRpc?.horizonRpcUrl, stellarRpc?.sorobanRpcUrl);
    },
    displayName: 'Stellar',
    defaultConnectors: () => [],
    providerManaged: false,
    discoverConnectors: async (service, getStore) => {
      // Hana Stellar injects window.hanaWallet.stellar lazily (sometimes after init).
      // The kit has no event API, so poll a few times with backoff so the connector
      // list catches up without forcing a refresh. Stop early once the id set stays
      // stable across consecutive iterations.
      const STELLAR_DISCOVER_DELAYS_MS = [0, 100, 500] as const;
      let lastIds = '';
      for (const delay of STELLAR_DISCOVER_DELAYS_MS) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        const wallets = await service.walletsKit.getSupportedWallets();
        const connectors = wallets
          .filter((w: StellarWalletType) => w.isAvailable)
          .map((w: StellarWalletType) => new StellarWalletsKitXConnector(w));
        const ids = connectors
          .map(c => c.id)
          .sort()
          .join(',');
        if (ids === lastIds) break; // list stable — no new wallet inject
        lastIds = ids;
        service.setXConnectors(connectors);
        getStore().setXConnectors('STELLAR', connectors);
      }
    },
    createActions: (service, getStore) => ({
      ...createDefaultActions('STELLAR', service, getStore),
      signMessage: async (message: string) => {
        const res = await service.walletsKit.signMessage(message);
        return res.signedMessage;
      },
    }),
    createWalletProvider: (service, getStore) => {
      if (!service?.walletsKit) return undefined;
      const defaults = getEntryDefaults<typeof ChainKeys.STELLAR_MAINNET>(
        getStore().walletConfig?.STELLAR?.chains?.[ChainKeys.STELLAR_MAINNET],
      );
      return new StellarWalletProvider({
        type: 'BROWSER_EXTENSION',
        walletsKit: service.walletsKit,
        network: 'PUBLIC',
        defaults,
      });
    },
  }),
  // ICON: signMessage not implemented — Hana wallet does not expose a signing API.
  // connect/disconnect use createDefaultActions (no createActions override needed).
  ICON: defineChain({
    createService: walletConfig =>
      IconXService.getInstance(getRpcUrl(walletConfig?.ICON?.chains?.[ChainKeys.ICON_MAINNET])),
    displayName: 'ICON',
    defaultConnectors: () => [new IconHanaXConnector()],
    providerManaged: false,
    createWalletProvider: (_service, getStore) => {
      const store = getStore();
      const address = store.xConnections.ICON?.xAccount.address;
      if (!address) return undefined;
      const chainInfo = CHAIN_INFO[SupportedChainId.MAINNET];
      if (!chainInfo) throw new Error('ICON mainnet chain info not found');
      const defaults = getEntryDefaults<typeof ChainKeys.ICON_MAINNET>(
        store.walletConfig?.ICON?.chains?.[ChainKeys.ICON_MAINNET],
      );
      return new IconWalletProvider({
        walletAddress: address as `hx${string}`,
        rpcUrl: chainInfo.APIEndpoint as `http${string}`,
        defaults,
      });
    },
  }),
  NEAR: defineChain({
    createService: walletConfig =>
      NearXService.getInstance(getRpcUrl(walletConfig?.NEAR?.chains?.[ChainKeys.NEAR_MAINNET])),
    displayName: 'NEAR',
    defaultConnectors: () => [],
    providerManaged: false,
    discoverConnectors: async (service, getStore) => {
      await service.walletSelector.whenManifestLoaded;
      const connectors = service.walletSelector.availableWallets.map(w => new NearXConnector(w));
      service.setXConnectors(connectors);
      getStore().setXConnectors('NEAR', connectors);
    },
    createActions: (service, getStore) => ({
      ...createDefaultActions('NEAR', service, getStore),
      disconnect: async () => {
        try {
          service.walletSelector.disconnect();
        } finally {
          getStore().unsetXConnection('NEAR');
        }
      },
    }),
    createWalletProvider: (service, getStore) => {
      if (!service?.walletSelector) return undefined;
      const defaults = getEntryDefaults<typeof ChainKeys.NEAR_MAINNET>(
        getStore().walletConfig?.NEAR?.chains?.[ChainKeys.NEAR_MAINNET],
      );
      return new NearWalletProvider({ wallet: service.walletSelector, defaults });
    },
  }),
  STACKS: defineChain({
    createService: walletConfig => StacksXService.getInstance(walletConfig?.STACKS?.chains?.[ChainKeys.STACKS_MAINNET]),
    displayName: 'Stacks',
    defaultConnectors: () => STACKS_PROVIDERS.map(c => new StacksXConnector(c)),
    providerManaged: false,
    createWalletProvider: (service, getStore) => {
      const store = getStore();
      const connection = store.xConnections.STACKS;
      const address = connection?.xAccount.address;
      if (!address) return undefined;
      const connector = connection?.xConnectorId ? service.getXConnectorById(connection.xConnectorId) : undefined;
      const provider = connector instanceof StacksXConnector ? connector.getProvider() : undefined;
      const defaults = getEntryDefaults<typeof ChainKeys.STACKS_MAINNET>(
        store.walletConfig?.STACKS?.chains?.[ChainKeys.STACKS_MAINNET],
      );
      return new StacksWalletProvider({ address, provider, defaults });
    },
  }),
  TRON: defineChain({
    createService: walletConfig => TronXService.getInstance(walletConfig?.TRON?.chains?.[ChainKeys.TRON_MAINNET]),
    displayName: 'Tron',
    defaultConnectors: () => [new TronXConnector()],
    providerManaged: false,
    createWalletProvider: (service, getStore) => {
      const store = getStore();
      const connection = store.xConnections.TRON;
      const address = connection?.xAccount.address;
      if (!address) return undefined;
      const connector = connection?.xConnectorId ? service.getXConnectorById(connection.xConnectorId) : undefined;
      const tronWeb = connector instanceof TronXConnector ? connector.getTronWeb() : undefined;
      if (!tronWeb) return undefined;
      // Signing goes through the announced provider; `tronWeb` alone can only read.
      const provider = connector instanceof TronXConnector ? connector.getProvider() : undefined;
      const entry = store.walletConfig?.TRON?.chains?.[ChainKeys.TRON_MAINNET];
      const defaults = getEntryDefaults<typeof ChainKeys.TRON_MAINNET>(entry);
      return new TronWalletProvider({
        tronWeb,
        provider,
        // Re-resolved per call: which injected instance is connected is only known once TIP-6963
        // discovery resolves, which is after this runs on a page reload.
        getProvider: () => (connector instanceof TronXConnector ? connector.getProvider() : undefined),
        address,
        endpoint: entry?.rpcUrl,
        defaults,
      });
    },
  }),
};

// ─── createChainServices ─────────────────────────────────────────────────────

export const createChainServices = (walletConfig: SodaxWalletConfig, getStore: StoreAccessor): ChainServicesResult => {
  const xServices: Partial<Record<ChainType, XService>> = {};
  const xConnectorsByChain: Partial<Record<ChainType, IXConnector[]>> = {};
  const enabledChains: ChainType[] = [];
  const chainActions: ChainActionsRegistry = {};

  for (const chainType of ChainTypeArr) {
    if (!hasChainOfType(chainType, walletConfig)) continue;
    const factory = chainRegistry[chainType];
    if (!factory) continue;

    const service = factory.createService(walletConfig);
    xServices[chainType] = service;
    enabledChains.push(chainType);

    if (!factory.providerManaged) {
      const override = readConnectorsOverride(chainType, walletConfig);
      const connectors = override ? narrowConnectors(override, chainType) : factory.defaultConnectors(walletConfig);
      service.setXConnectors(connectors);
      xConnectorsByChain[chainType] = connectors;

      // Register ChainActions for non-provider chains
      chainActions[chainType] = factory.createActions
        ? factory.createActions(service, getStore)
        : createDefaultActions(chainType, service, getStore);

      // Async connector discovery (Stellar, NEAR) — updates store when done
      if (factory.discoverConnectors) {
        factory.discoverConnectors(service, getStore).catch(err => {
          console.warn(`[wallet-sdk-react] discoverConnectors failed for ${chainType}:`, err);
        });
      }
    }
  }

  return { xServices, xConnectorsByChain, enabledChains, chainActions };
};
