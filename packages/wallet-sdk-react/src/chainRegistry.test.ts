import { afterEach, describe, it, expect, vi } from 'vitest';
import { ChainKeys, type IBitcoinWalletProvider } from '@sodax/types';
import { XConnector } from './core/index.js';
import type { SodaxWalletConfig } from './types/config.js';
import { BitcoinXConnector, BitcoinXService } from './xchains/bitcoin/index.js';
import { IconXService } from './xchains/icon/index.js';
import { InjectiveXService } from './xchains/injective/index.js';
import { NearXService } from './xchains/near/NearXService.js';
import { StacksXService } from './xchains/stacks/index.js';
import { StellarXService } from './xchains/stellar/index.js';
import { TonXConnector, TonXService } from './xchains/ton/index.js';
import { TronXConnector } from './xchains/tron/index.js';
import { XrpXConnector } from './xchains/xrp/index.js';
import { ZcashXConnector, ZcashXService } from './xchains/zcash/index.js';
import { TronWalletProvider, ZcashWalletProvider } from '@sodax/wallet-sdk-core';

type CtorOpts = { defaults?: unknown };

// Mock wallet-sdk-core provider constructors so tests verify defaults forwarding
// without actually constructing the providers (avoids real SDK init side-effects).
const ctorSpies = {
  Icon: vi.fn(),
  Injective: vi.fn(),
  Stellar: vi.fn(),
  Near: vi.fn(),
  Stacks: vi.fn(),
};

vi.mock('@sodax/wallet-sdk-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@sodax/wallet-sdk-core')>();
  // vitest 4 builds the instance with Reflect.construct, so a `new`-ed mock needs a class impl.
  // The spy is reached through a callback because `ctorSpies` is still in TDZ when this factory runs.
  const ctorMock = (spy: (opts: CtorOpts) => void) =>
    vi.fn(
      class {
        defaults: unknown;
        _opts: CtorOpts;
        constructor(opts: CtorOpts) {
          spy(opts);
          this.defaults = opts.defaults;
          this._opts = opts;
        }
      },
    );
  return {
    ...actual,
    IconWalletProvider: ctorMock(opts => ctorSpies.Icon(opts)),
    InjectiveWalletProvider: ctorMock(opts => ctorSpies.Injective(opts)),
    StellarWalletProvider: ctorMock(opts => ctorSpies.Stellar(opts)),
    NearWalletProvider: ctorMock(opts => ctorSpies.Near(opts)),
    StacksWalletProvider: ctorMock(opts => ctorSpies.Stacks(opts)),
  };
});

import { chainRegistry, createChainServices, type StoreAccessor } from './chainRegistry.js';

const makeStore = (walletConfig?: SodaxWalletConfig): StoreAccessor =>
  vi.fn(() => ({
    xConnections: {},
    xConnectorsByChain: {},
    xServices: {},
    setXConnectors: vi.fn(),
    unsetXConnection: vi.fn(),
    setWalletProvider: vi.fn(),
    walletConfig,
  }));

// chainRegistry is Record<string, ChainServiceFactory>, so under
// noUncheckedIndexedAccess every keyed access is possibly undefined — narrow once here.
const getChainEntry = (key: string) => {
  const entry = chainRegistry[key];
  if (!entry) throw new Error(`expected chainRegistry entry for ${key}`);
  return entry;
};

const getWalletProviderFactory = (key: string) => {
  const { createWalletProvider } = getChainEntry(key);
  if (!createWalletProvider) throw new Error(`expected ${key} wallet provider factory`);
  return createWalletProvider;
};

const defaultsOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && 'defaults' in value ? value.defaults : undefined;

const storeWithConnection = (
  chainType: 'ICON' | 'STACKS',
  address: string,
  walletConfig: SodaxWalletConfig,
): StoreAccessor =>
  vi.fn(() => ({
    xConnections: { [chainType]: { xAccount: { address, xChainType: chainType }, xConnectorId: 'unused' } },
    xConnectorsByChain: {},
    xServices: {},
    setXConnectors: vi.fn(),
    unsetXConnection: vi.fn(),
    setWalletProvider: vi.fn(),
    walletConfig,
  }));

describe('createChainServices', () => {
  it('registers TON and ZCASH as connector-managed chains with their configured RPC and connector', () => {
    const config: SodaxWalletConfig = {
      TON: {
        chains: { [ChainKeys.TON_MAINNET]: { rpcUrl: 'https://ton.example/rpc' } },
        manifestUrl: 'https://ton.example/tonconnect-manifest.json',
      },
      ZCASH: { chains: { [ChainKeys.ZCASH_MAINNET]: { rpcUrl: 'https://zcash.example/rpc' } } },
    };
    const result = createChainServices(config, makeStore(config));
    expect(result.enabledChains).toEqual(['TON', 'ZCASH']);
    expect(result.xServices.TON).toBeInstanceOf(TonXService);
    expect(result.xServices.TON).toMatchObject({
      rpcUrl: 'https://ton.example/rpc',
      manifestUrl: 'https://ton.example/tonconnect-manifest.json',
    });
    expect(result.xConnectorsByChain.TON).toHaveLength(1);
    expect(result.xConnectorsByChain.TON?.[0]).toBeInstanceOf(TonXConnector);
    expect(result.xServices.ZCASH).toBeInstanceOf(ZcashXService);
    expect(result.xServices.ZCASH).toMatchObject({ rpcUrl: 'https://zcash.example/rpc' });
    expect(result.xConnectorsByChain.ZCASH).toHaveLength(1);
    expect(result.xConnectorsByChain.ZCASH?.[0]).toBeInstanceOf(ZcashXConnector);
  });

  it('does not construct a TON provider without a connected account', () => {
    expect(getWalletProviderFactory('TON')(TonXService.getInstance(), makeStore())).toBeUndefined();
  });

  it('builds a Zcash provider only for a connected Noir account', () => {
    const connector = new ZcashXConnector();
    const service = ZcashXService.getInstance();
    service.setXConnectors([connector]);
    const createWalletProvider = getWalletProviderFactory('ZCASH');
    const connectedStore = (xConnectorId: string): StoreAccessor =>
      vi.fn(() => ({
        xConnections: {
          ZCASH: {
            xAccount: { address: 't1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs', xChainType: 'ZCASH' as const },
            xConnectorId,
          },
        },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig: undefined,
      }));

    expect(createWalletProvider(service, makeStore())).toBeUndefined();
    expect(createWalletProvider(service, connectedStore('unknown-connector'))).toBeUndefined();
    expect(createWalletProvider(service, connectedStore(connector.id))).toBeInstanceOf(ZcashWalletProvider);
  });

  it('only initializes chains listed in config', () => {
    const result = createChainServices({ EVM: {}, BITCOIN: {}, ICON: {} }, makeStore());

    expect(result.enabledChains).toEqual(['ICON', 'EVM', 'BITCOIN']);
    expect(result.xServices.BITCOIN).toBeInstanceOf(BitcoinXService);
    expect(result.xServices.ICON).toBeInstanceOf(IconXService);
    expect(result.xServices.SOLANA).toBeUndefined();
    expect(result.xServices.SUI).toBeUndefined();
  });

  it('gives non-provider chains default connectors and chainActions, provider-managed chains neither', () => {
    // EVM/SOLANA/SUI register connectors via Hydrators and ChainActions via Action components.
    const result = createChainServices({ EVM: {}, SOLANA: {}, SUI: {}, BITCOIN: {}, ICON: {} }, makeStore());

    for (const chainType of ['EVM', 'SOLANA', 'SUI'] as const) {
      expect(result.xConnectorsByChain[chainType]).toBeUndefined();
      expect(result.chainActions[chainType]).toBeUndefined();
    }
    // BITCOIN defaults: Unisat, Xverse, OKX, Hana
    expect(result.xConnectorsByChain.BITCOIN).toHaveLength(4);
    const actions = result.chainActions.ICON;
    expect(typeof actions?.connect).toBe('function');
    expect(typeof actions?.disconnect).toBe('function');
    expect(typeof actions?.getConnectors).toBe('function');
    expect(typeof actions?.getConnection).toBe('function');
  });

  it('keeps custom XConnector overrides and warns + filters ones that do not extend XConnector', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // narrowConnectors filters by `instanceof XConnector` at runtime, so only a real subclass survives.
    class FakeXConnector extends XConnector {
      constructor() {
        super('BITCOIN', 'Fake Wallet', 'fake');
      }
      async connect() {
        return undefined;
      }
      async disconnect() {}
    }
    const plainConnector = {
      _id: 'plain',
      id: 'plain',
      name: 'Plain',
      icon: undefined,
      installUrl: undefined,
      xChainType: 'BITCOIN' as const,
      isInstalled: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const result = createChainServices(
      { BITCOIN: { connectors: [new FakeXConnector(), plainConnector] } },
      makeStore(),
    );

    expect(result.xConnectorsByChain.BITCOIN?.map(connector => connector.id)).toEqual(['fake']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/must extend XConnector/));
    warnSpy.mockRestore();
  });

  it('exposes signMessage for BITCOIN, INJECTIVE and STELLAR but not ICON (Hana wallet limitation)', () => {
    const { chainActions } = createChainServices({ BITCOIN: {}, INJECTIVE: {}, STELLAR: {}, ICON: {} }, makeStore());

    expect(chainActions.BITCOIN?.signMessage).toBeDefined();
    expect(chainActions.INJECTIVE?.signMessage).toBeDefined();
    expect(chainActions.STELLAR?.signMessage).toBeDefined();
    expect(chainActions.ICON?.signMessage).toBeUndefined();
  });

  it('returns empty result for empty config', () => {
    const result = createChainServices({}, makeStore());

    expect(result.enabledChains).toEqual([]);
    expect(result.xServices).toEqual({});
    expect(result.xConnectorsByChain).toEqual({});
    expect(result.chainActions).toEqual({});
  });
});

// ─── chainRegistry: defaults forwarding from SodaxWalletConfig to wallet-sdk-core ───

describe('chainRegistry — defaults forwarding to provider constructors', () => {
  it('BITCOIN forwards `defaults` to all 4 connectors, and undefined when the entry omits them', () => {
    const withDefaults = getChainEntry('BITCOIN').defaultConnectors({
      BITCOIN: {
        chains: {
          [ChainKeys.BITCOIN_MAINNET]: { rpcUrl: 'https://mempool.space/api', defaults: { defaultFinalize: true } },
        },
      },
    });
    const withoutDefaults = getChainEntry('BITCOIN').defaultConnectors({
      BITCOIN: { chains: { [ChainKeys.BITCOIN_MAINNET]: { rpcUrl: 'https://mempool.space/api' } } },
    });

    expect(withDefaults.map(defaultsOf)).toEqual(Array(4).fill({ defaultFinalize: true }));
    expect(withoutDefaults.map(defaultsOf)).toEqual(Array(4).fill(undefined));
  });

  it('forwards `defaults` to the service-backed Injective, Stellar and NEAR providers', () => {
    const walletConfig: SodaxWalletConfig = {
      INJECTIVE: {
        chains: {
          [ChainKeys.INJECTIVE_MAINNET]: {
            indexer: 'https://indexer.injective',
            grpc: 'https://grpc.injective',
            defaults: { defaultMemo: 'test-memo', sequence: 42 },
          },
        },
      },
      STELLAR: {
        chains: {
          [ChainKeys.STELLAR_MAINNET]: {
            horizonRpcUrl: 'https://horizon.stellar.org',
            sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
            defaults: { pollInterval: 1500, pollTimeout: 90_000 },
          },
        },
      },
      NEAR: {
        chains: {
          [ChainKeys.NEAR_MAINNET]: {
            rpcUrl: 'https://free.rpc.fastnear.com',
            defaults: { throwOnFailure: false, gasDefault: 100_000n },
          },
        },
      },
    };
    const store = makeStore(walletConfig);

    const injective = getWalletProviderFactory('INJECTIVE')({ msgBroadcaster: { broadcast: vi.fn() } } as never, store);
    const stellar = getWalletProviderFactory('STELLAR')({ walletsKit: {} } as never, store);
    const near = getWalletProviderFactory('NEAR')(
      { walletSelector: { whenManifestLoaded: Promise.resolve() } } as never,
      store,
    );

    expect(defaultsOf(injective)).toEqual({ defaultMemo: 'test-memo', sequence: 42 });
    expect(defaultsOf(stellar)).toEqual({ pollInterval: 1500, pollTimeout: 90_000 });
    expect(defaultsOf(near)).toEqual({ throwOnFailure: false, gasDefault: 100_000n });
  });

  it('ICON forwards `defaults` to IconWalletProvider only when an ICON connection exists', () => {
    const walletConfig: SodaxWalletConfig = {
      ICON: {
        chains: {
          [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://ctz.solidwallet.io/api/v3', defaults: { stepLimit: 4_000_000 } },
        },
      },
    };
    const createWalletProvider = getWalletProviderFactory('ICON');

    expect(createWalletProvider({} as never, makeStore(walletConfig))).toBeUndefined();
    expect(defaultsOf(createWalletProvider({} as never, storeWithConnection('ICON', 'hxabc', walletConfig)))).toEqual({
      stepLimit: 4_000_000,
    });
  });

  it('STACKS forwards `defaults` from the object form and none for the preset string form', () => {
    const objectForm: SodaxWalletConfig = {
      STACKS: {
        chains: {
          [ChainKeys.STACKS_MAINNET]: {
            chainId: 1,
            transactionVersion: 0,
            peerNetworkId: 0,
            magicBytes: 'X2',
            bootAddress: '',
            addressVersion: { singleSig: 0, multiSig: 0 },
            client: { baseUrl: 'https://api.hiro.so' },
            defaults: { network: 'mainnet' },
          },
        },
      },
    };
    const presetForm: SodaxWalletConfig = { STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } } };
    const createWalletProvider = getWalletProviderFactory('STACKS');
    const service = { getXConnectorById: vi.fn() } as never;

    expect(defaultsOf(createWalletProvider(service, storeWithConnection('STACKS', 'SP123', objectForm)))).toEqual({
      network: 'mainnet',
    });
    expect(
      defaultsOf(createWalletProvider(service, storeWithConnection('STACKS', 'SP123', presetForm))),
    ).toBeUndefined();
  });
});

// ─── chainRegistry: rpcUrl/network forwarding to XService.getInstance ───────
// Verifies the *other half* of the config flow: chain-specific RPC settings
// reach `*XService.getInstance(...)` with the correct shape (string, object,
// or split args). Defaults forwarding is covered above.

describe('chainRegistry — rpcUrl/network forwarding to XService.getInstance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('BITCOIN, ICON and NEAR pass the mainnet rpcUrl string', () => {
    const bitcoin = vi.spyOn(BitcoinXService, 'getInstance').mockReturnValue({} as never);
    const icon = vi.spyOn(IconXService, 'getInstance').mockReturnValue({} as never);
    const near = vi.spyOn(NearXService, 'getInstance').mockReturnValue({} as never);
    const walletConfig: SodaxWalletConfig = {
      BITCOIN: { chains: { [ChainKeys.BITCOIN_MAINNET]: { rpcUrl: 'https://mempool.example/api' } } },
      ICON: { chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://icon.example/api/v3' } } },
      NEAR: { chains: { [ChainKeys.NEAR_MAINNET]: { rpcUrl: 'https://near.example' } } },
    };

    getChainEntry('BITCOIN').createService(walletConfig);
    getChainEntry('ICON').createService(walletConfig);
    getChainEntry('NEAR').createService(walletConfig);

    expect(bitcoin).toHaveBeenCalledWith('https://mempool.example/api');
    expect(icon).toHaveBeenCalledWith('https://icon.example/api/v3');
    expect(near).toHaveBeenCalledWith('https://near.example');
  });

  it('INJECTIVE and STACKS pass the mainnet entry through as-is (object or preset name)', () => {
    const injective = vi.spyOn(InjectiveXService, 'getInstance').mockReturnValue({} as never);
    const stacks = vi.spyOn(StacksXService, 'getInstance').mockReturnValue({} as never);
    const injectiveEntry = { indexer: 'https://indexer.example', grpc: 'https://grpc.example' };
    const stacksEntry = {
      chainId: 1,
      transactionVersion: 0,
      peerNetworkId: 0,
      magicBytes: 'X2',
      bootAddress: '',
      addressVersion: { singleSig: 0, multiSig: 0 },
      client: { baseUrl: 'https://api.hiro.so' },
    };

    getChainEntry('INJECTIVE').createService({
      INJECTIVE: { chains: { [ChainKeys.INJECTIVE_MAINNET]: injectiveEntry } },
    });
    getChainEntry('STACKS').createService({ STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: stacksEntry } } });
    getChainEntry('STACKS').createService({ STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } } });

    expect(injective).toHaveBeenCalledWith(injectiveEntry);
    expect(stacks).toHaveBeenNthCalledWith(1, stacksEntry);
    expect(stacks).toHaveBeenNthCalledWith(2, 'mainnet');
  });

  it('STELLAR passes horizonRpcUrl + sorobanRpcUrl as separate args, undefined when the entry is omitted', () => {
    const spy = vi.spyOn(StellarXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('STELLAR').createService({
      STELLAR: {
        chains: {
          [ChainKeys.STELLAR_MAINNET]: {
            horizonRpcUrl: 'https://horizon.example',
            sorobanRpcUrl: 'https://soroban.example',
          },
        },
      },
    });
    getChainEntry('STELLAR').createService({ STELLAR: {} });

    expect(spy).toHaveBeenNthCalledWith(1, 'https://horizon.example', 'https://soroban.example');
    expect(spy).toHaveBeenNthCalledWith(2, undefined, undefined);
  });
});

// ─── chainRegistry: BITCOIN signMessage dispatch ────────────────────────────

describe('chainRegistry — BITCOIN signMessage dispatches to the wallet provider', () => {
  const makeProvider = (overrides: Record<string, unknown> = {}): IBitcoinWalletProvider =>
    ({
      signBip322Message: vi.fn(async () => 'sig-bip322'),
      signEcdsaMessage: vi.fn(async () => 'sig-ecdsa'),
      ...overrides,
      // Only the message-signing surface is exercised; the rest of IBitcoinWalletProvider is unused.
    }) as unknown as IBitcoinWalletProvider;

  class FakeBitcoinXConnector extends BitcoinXConnector {
    constructor(
      private readonly live: IBitcoinWalletProvider | undefined,
      private readonly restored: IBitcoinWalletProvider | undefined = undefined,
    ) {
      super('Fake Bitcoin Wallet', 'fake-btc');
    }
    async connect() {
      return undefined;
    }
    async disconnect() {}
    getWalletProvider() {
      return this.live;
    }
    recreateWalletProvider() {
      return this.restored;
    }
  }

  const signWith = (address: string, connector: BitcoinXConnector) => {
    const store: StoreAccessor = vi.fn(() => ({
      xConnections: { BITCOIN: { xAccount: { address, xChainType: 'BITCOIN' as const }, xConnectorId: 'fake-btc' } },
      xConnectorsByChain: {},
      xServices: {},
      setXConnectors: vi.fn(),
      unsetXConnection: vi.fn(),
      setWalletProvider: vi.fn(),
      walletConfig: undefined,
    }));
    const { chainActions } = createChainServices({ BITCOIN: { connectors: [connector] } }, store);
    const signMessage = chainActions.BITCOIN?.signMessage;
    if (!signMessage) throw new Error('BITCOIN signMessage not registered');
    return signMessage('hello');
  };

  it.each([
    ['bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'P2WPKH', 'signBip322Message', 'sig-bip322'],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'P2PKH', 'signEcdsaMessage', 'sig-ecdsa'],
  ])('%s (%s) signs via %s', async (address, _type, method, expected) => {
    const provider = makeProvider();
    await expect(signWith(address, new FakeBitcoinXConnector(provider))).resolves.toBe(expected);
    expect(provider[method as 'signBip322Message' | 'signEcdsaMessage']).toHaveBeenCalledWith('hello');
  });

  it('falls back to recreateWalletProvider when the live provider is gone (post-reload)', async () => {
    const restored = makeProvider();
    await expect(
      signWith('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', new FakeBitcoinXConnector(undefined, restored)),
    ).resolves.toBe('sig-bip322');
    expect(restored.signBip322Message).toHaveBeenCalledWith('hello');
  });

  it('throws when the connector yields no wallet provider', async () => {
    await expect(
      signWith('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', new FakeBitcoinXConnector(undefined)),
    ).rejects.toThrow('fake-btc has no wallet provider');
  });

  it('throws when the wallet provider does not implement the scheme the address needs', async () => {
    const provider = makeProvider({ signBip322Message: undefined });
    await expect(
      signWith('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', new FakeBitcoinXConnector(provider)),
    ).rejects.toThrow('fake-btc does not support BIP-322 signing');
  });
});

describe('chainRegistry — TRON signMessage goes through the TronLink connector', () => {
  const ADDRESS = 'TYQvjFWzc2Cnt91LXnk7UJVii3JVfSm69d';

  const tronStore = (connector: TronXConnector): StoreAccessor =>
    vi.fn(() => ({
      xConnections: {
        TRON: { xAccount: { address: ADDRESS, xChainType: 'TRON' as const }, xConnectorId: connector.id },
      },
      xConnectorsByChain: {},
      xServices: {},
      setXConnectors: vi.fn(),
      unsetXConnection: vi.fn(),
      setWalletProvider: vi.fn(),
      walletConfig: undefined,
    }));

  it('signs as the connected address', async () => {
    const connector = new TronXConnector();
    const sign = vi.spyOn(connector, 'signMessage').mockResolvedValue('0xsig');
    const { chainActions } = createChainServices({ TRON: { connectors: [connector] } }, tronStore(connector));

    await expect(chainActions.TRON?.signMessage?.('hello')).resolves.toBe('0xsig');
    expect(sign).toHaveBeenCalledWith('hello', ADDRESS);
  });

  it('builds the wallet provider before the wallet is discovered, as on a page reload', () => {
    const connector = new TronXConnector();
    expect(connector.getTronWeb()).toBeUndefined();

    const provider = getWalletProviderFactory('TRON')(
      { getXConnectorById: () => connector } as never,
      tronStore(connector),
    );

    expect(provider).toBeInstanceOf(TronWalletProvider);
  });

  it('throws when no Tron wallet is connected', async () => {
    const connector = new TronXConnector();
    const { chainActions } = createChainServices({ TRON: { connectors: [connector] } }, makeStore());

    await expect(chainActions.TRON?.signMessage?.('hello')).rejects.toThrow('Tron wallet not connected');
  });
});

describe('chainRegistry — XRP connector discovery', () => {
  afterEach(() => vi.restoreAllMocks());

  // GemWallet reads as not installed until `@gemwallet/api` hears from the extension.
  const discover = async (installed: boolean) => {
    vi.spyOn(XrpXConnector, 'detect').mockResolvedValue(installed);
    const connector = new XrpXConnector();
    const setXConnectors = vi.fn();
    const store: StoreAccessor = vi.fn(() => ({
      xConnections: {},
      xConnectorsByChain: { XRP: [connector] },
      xServices: {},
      setXConnectors,
      unsetXConnection: vi.fn(),
      setWalletProvider: vi.fn(),
      walletConfig: undefined,
    }));
    await getChainEntry('XRP').discoverConnectors?.({} as never, store);
    return { connector, setXConnectors };
  };

  it('republishes the GemWallet connector once the extension answers, so the modal reads it as installed', async () => {
    const { connector, setXConnectors } = await discover(true);

    expect(setXConnectors).toHaveBeenCalledWith('XRP', [connector]);
  });

  it('leaves the connector list alone when GemWallet is not installed', async () => {
    const { setXConnectors } = await discover(false);

    expect(setXConnectors).not.toHaveBeenCalled();
  });
});
