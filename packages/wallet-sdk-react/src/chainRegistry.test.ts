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

describe('createChainServices', () => {
  it('only initializes chains listed in config', () => {
    const result = createChainServices({ EVM: {}, BITCOIN: {} }, makeStore());

    expect(result.enabledChains).toContain('EVM');
    expect(result.enabledChains).toContain('BITCOIN');
    expect(result.enabledChains).not.toContain('SOLANA');
    expect(result.enabledChains).not.toContain('SUI');
    expect(result.xServices.SOLANA).toBeUndefined();
    expect(result.xServices.SUI).toBeUndefined();
  });

  it('initializes XService instances for enabled chains', () => {
    const result = createChainServices({ BITCOIN: {}, ICON: {} }, makeStore());

    expect(result.xServices.BITCOIN).toBeDefined();
    expect(result.xServices.ICON).toBeDefined();
  });

  it('uses default connectors for non-provider chains when no override is given', () => {
    const result = createChainServices({ BITCOIN: {} }, makeStore());

    // BITCOIN defaults: Unisat, Xverse, OKX, Hana
    expect(result.xConnectorsByChain.BITCOIN).toBeDefined();
    expect(result.xConnectorsByChain.BITCOIN?.length).toBe(4);
  });

  it('respects custom connectors override for non-provider chains', () => {
    // Real XConnector subclass — narrowConnectors filters by `instanceof XConnector`
    // at runtime, so plain IXConnector duck-typed objects are rejected.
    class FakeXConnector extends XConnector {
      constructor() {
        super('BITCOIN', 'Fake Wallet', 'fake');
      }
      async connect() {
        return undefined;
      }
      async disconnect() {}
    }

    const result = createChainServices({ BITCOIN: { connectors: [new FakeXConnector()] } }, makeStore());

    expect(result.xConnectorsByChain.BITCOIN).toHaveLength(1);
    expect((result.xConnectorsByChain.BITCOIN?.[0] as XConnector).id).toBe('fake');
  });

  it('rejects custom connectors that do not extend XConnector (warns + filters)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Complete IXConnector shape — still rejected at runtime because it is not
    // an `instanceof XConnector`, which is exactly what this test proves.
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

    const result = createChainServices({ BITCOIN: { connectors: [plainConnector] } }, makeStore());

    expect(result.xConnectorsByChain.BITCOIN).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/must extend XConnector/));
    warnSpy.mockRestore();
  });

  it('does not populate connectors for provider-managed chains', () => {
    // EVM/SOLANA/SUI are provider-managed — connectors are hydrated by their respective Hydrator components
    const result = createChainServices({ EVM: {}, SOLANA: {}, SUI: {} }, makeStore());

    expect(result.xConnectorsByChain.EVM).toBeUndefined();
    expect(result.xConnectorsByChain.SOLANA).toBeUndefined();
    expect(result.xConnectorsByChain.SUI).toBeUndefined();
  });

  it('registers chainActions for non-provider chains only', () => {
    // Provider-managed chains register their ChainActions via Action components,
    // not in createChainServices
    const result = createChainServices({ EVM: {}, BITCOIN: {}, ICON: {} }, makeStore());

    expect(result.chainActions.BITCOIN).toBeDefined();
    expect(result.chainActions.ICON).toBeDefined();
    expect(result.chainActions.EVM).toBeUndefined();
  });

  it('chainActions has connect/disconnect/getConnectors/getConnection by default', () => {
    const result = createChainServices({ ICON: {} }, makeStore());
    const actions = result.chainActions.ICON;

    expect(actions).toBeDefined();
    expect(typeof actions?.connect).toBe('function');
    expect(typeof actions?.disconnect).toBe('function');
    expect(typeof actions?.getConnectors).toBe('function');
    expect(typeof actions?.getConnection).toBe('function');
  });

  it('Bitcoin chainActions exposes signMessage', () => {
    const result = createChainServices({ BITCOIN: {} }, makeStore());

    expect(result.chainActions.BITCOIN?.signMessage).toBeDefined();
  });

  it('Injective chainActions exposes signMessage', () => {
    const result = createChainServices({ INJECTIVE: {} }, makeStore());

    expect(result.chainActions.INJECTIVE?.signMessage).toBeDefined();
  });

  it('Stellar chainActions exposes signMessage', () => {
    const result = createChainServices({ STELLAR: {} }, makeStore());

    expect(result.chainActions.STELLAR?.signMessage).toBeDefined();
  });

  it('ICON chainActions does not expose signMessage (Hana wallet limitation)', () => {
    const result = createChainServices({ ICON: {} }, makeStore());

    expect(result.chainActions.ICON?.signMessage).toBeUndefined();
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
  describe('BITCOIN.defaultConnectors', () => {
    it('forwards `defaults` to all 4 connectors (Unisat/Xverse/OKX/Hana)', () => {
      const walletConfig: SodaxWalletConfig = {
        BITCOIN: {
          chains: {
            [ChainKeys.BITCOIN_MAINNET]: {
              rpcUrl: 'https://mempool.space/api',
              defaults: { defaultFinalize: true },
            },
          },
        },
      };

      const connectors = getChainEntry('BITCOIN').defaultConnectors(walletConfig);
      expect(connectors).toHaveLength(4);
      for (const connector of connectors) {
        expect((connector as unknown as { defaults?: unknown }).defaults).toEqual({ defaultFinalize: true });
      }
    });

    it('passes undefined defaults when BITCOIN entry omits `defaults`', () => {
      const walletConfig: SodaxWalletConfig = {
        BITCOIN: {
          chains: {
            [ChainKeys.BITCOIN_MAINNET]: {
              rpcUrl: 'https://mempool.space/api',
            },
          },
        },
      };

      const connectors = getChainEntry('BITCOIN').defaultConnectors(walletConfig);
      for (const connector of connectors) {
        expect((connector as unknown as { defaults?: unknown }).defaults).toBeUndefined();
      }
    });

    it('passes undefined defaults when walletConfig is empty', () => {
      const connectors = getChainEntry('BITCOIN').defaultConnectors({});
      for (const connector of connectors) {
        expect((connector as unknown as { defaults?: unknown }).defaults).toBeUndefined();
      }
    });
  });

  describe('INJECTIVE.createWalletProvider', () => {
    it('forwards `defaults` from walletConfig to InjectiveWalletProvider', () => {
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
      };

      const mockService = { msgBroadcaster: { broadcast: vi.fn() } as never };
      const provider = getChainEntry('INJECTIVE').createWalletProvider!(mockService as never, makeStore(walletConfig));

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({
        defaultMemo: 'test-memo',
        sequence: 42,
      });
    });
  });

  describe('STELLAR.createWalletProvider', () => {
    it('forwards `defaults` from walletConfig to StellarWalletProvider', () => {
      const walletConfig: SodaxWalletConfig = {
        STELLAR: {
          chains: {
            [ChainKeys.STELLAR_MAINNET]: {
              horizonRpcUrl: 'https://horizon.stellar.org',
              sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
              defaults: { pollInterval: 1500, pollTimeout: 90_000 },
            },
          },
        },
      };

      const mockService = { walletsKit: {} as never };
      const provider = getChainEntry('STELLAR').createWalletProvider!(mockService as never, makeStore(walletConfig));

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({
        pollInterval: 1500,
        pollTimeout: 90_000,
      });
    });
  });

  describe('ICON.createWalletProvider', () => {
    it('forwards `defaults` to IconWalletProvider when an ICON connection exists', () => {
      const walletConfig: SodaxWalletConfig = {
        ICON: {
          chains: {
            [ChainKeys.ICON_MAINNET]: {
              rpcUrl: 'https://ctz.solidwallet.io/api/v3',
              defaults: { stepLimit: 4_000_000 },
            },
          },
        },
      };

      const storeWithIconConnection = vi.fn(() => ({
        xConnections: { ICON: { xAccount: { address: 'hxabc', xChainType: 'ICON' as const } } },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig,
      }));

      const provider = getChainEntry('ICON').createWalletProvider!({} as never, storeWithIconConnection as never);
      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({ stepLimit: 4_000_000 });
    });

    it('returns undefined when no ICON connection exists', () => {
      const walletConfig: SodaxWalletConfig = {
        ICON: { chains: { [ChainKeys.ICON_MAINNET]: { defaults: {} } } },
      };
      const provider = getChainEntry('ICON').createWalletProvider!({} as never, makeStore(walletConfig));
      expect(provider).toBeUndefined();
    });
  });

  describe('NEAR.createWalletProvider', () => {
    it('forwards `defaults` to NearWalletProvider', () => {
      const walletConfig: SodaxWalletConfig = {
        NEAR: {
          chains: {
            [ChainKeys.NEAR_MAINNET]: {
              rpcUrl: 'https://free.rpc.fastnear.com',
              defaults: { throwOnFailure: false, gasDefault: 100_000n },
            },
          },
        },
      };

      const mockService = { walletSelector: { whenManifestLoaded: Promise.resolve() } as never };
      const provider = getChainEntry('NEAR').createWalletProvider!(mockService as never, makeStore(walletConfig));

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({
        throwOnFailure: false,
        gasDefault: 100_000n,
      });
    });
  });

  describe('STACKS.createWalletProvider', () => {
    it('forwards `defaults` from object form entry', () => {
      const walletConfig: SodaxWalletConfig = {
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

      const storeWithStacksConnection = vi.fn(() => ({
        xConnections: { STACKS: { xAccount: { address: 'SP123', xChainType: 'STACKS' as const } } },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig,
      }));

      const mockService = { getXConnectorById: vi.fn() };
      const provider = getChainEntry('STACKS').createWalletProvider!(
        mockService as never,
        storeWithStacksConnection as never,
      );

      expect((provider as unknown as { defaults?: unknown }).defaults).toEqual({ network: 'mainnet' });
    });

    it('passes undefined defaults for preset string form (no defaults slot)', () => {
      const walletConfig: SodaxWalletConfig = {
        STACKS: {
          chains: {
            [ChainKeys.STACKS_MAINNET]: 'mainnet',
          },
        },
      };

      const storeWithStacksConnection = vi.fn(() => ({
        xConnections: { STACKS: { xAccount: { address: 'SP123', xChainType: 'STACKS' as const } } },
        xConnectorsByChain: {},
        xServices: {},
        setXConnectors: vi.fn(),
        unsetXConnection: vi.fn(),
        setWalletProvider: vi.fn(),
        walletConfig,
      }));

      const mockService = { getXConnectorById: vi.fn() };
      const provider = getChainEntry('STACKS').createWalletProvider!(
        mockService as never,
        storeWithStacksConnection as never,
      );

      expect((provider as unknown as { defaults?: unknown }).defaults).toBeUndefined();
    });
  });
});

// ─── chainRegistry: rpcUrl/network forwarding to XService.getInstance ───────
// Verifies the *other half* of the config flow: chain-specific RPC settings
// reach `*XService.getInstance(...)` with the correct shape (string, object,
// or split args). Defaults forwarding is covered above; this block fills the
// rpcUrl gap for the 6 non-provider chains.

describe('chainRegistry — rpcUrl/network forwarding to XService.getInstance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('BITCOIN.createService passes BITCOIN_MAINNET.rpcUrl to BitcoinXService.getInstance', () => {
    const spy = vi.spyOn(BitcoinXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('BITCOIN').createService({
      BITCOIN: {
        chains: {
          [ChainKeys.BITCOIN_MAINNET]: {
            rpcUrl: 'https://mempool.example/api',
          },
        },
      },
    });
    expect(spy).toHaveBeenCalledWith('https://mempool.example/api');
  });

  it('BITCOIN.createService passes undefined when rpcUrl omitted', () => {
    const spy = vi.spyOn(BitcoinXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('BITCOIN').createService({ BITCOIN: {} });
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  it('INJECTIVE.createService passes the full INJECTIVE_MAINNET entry to InjectiveXService.getInstance', () => {
    const spy = vi.spyOn(InjectiveXService, 'getInstance').mockReturnValue({} as never);
    const entry = { indexer: 'https://indexer.example', grpc: 'https://grpc.example' };
    getChainEntry('INJECTIVE').createService({
      INJECTIVE: { chains: { [ChainKeys.INJECTIVE_MAINNET]: entry } },
    });
    expect(spy).toHaveBeenCalledWith(entry);
  });

  it('STELLAR.createService passes horizonRpcUrl + sorobanRpcUrl as separate args', () => {
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
    expect(spy).toHaveBeenCalledWith('https://horizon.example', 'https://soroban.example');
  });

  it('STELLAR.createService passes (undefined, undefined) when STELLAR_MAINNET entry omitted', () => {
    const spy = vi.spyOn(StellarXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('STELLAR').createService({ STELLAR: {} });
    expect(spy).toHaveBeenCalledWith(undefined, undefined);
  });

  it('ICON.createService passes ICON_MAINNET.rpcUrl to IconXService.getInstance', () => {
    const spy = vi.spyOn(IconXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('ICON').createService({
      ICON: { chains: { [ChainKeys.ICON_MAINNET]: { rpcUrl: 'https://icon.example/api/v3' } } },
    });
    expect(spy).toHaveBeenCalledWith('https://icon.example/api/v3');
  });

  it('NEAR.createService passes NEAR_MAINNET.rpcUrl to NearXService.getInstance', () => {
    const spy = vi.spyOn(NearXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('NEAR').createService({
      NEAR: { chains: { [ChainKeys.NEAR_MAINNET]: { rpcUrl: 'https://near.example' } } },
    });
    expect(spy).toHaveBeenCalledWith('https://near.example');
  });

  it('STACKS.createService passes STACKS_MAINNET preset name to StacksXService.getInstance', () => {
    const spy = vi.spyOn(StacksXService, 'getInstance').mockReturnValue({} as never);
    getChainEntry('STACKS').createService({
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: 'mainnet' } },
    });
    expect(spy).toHaveBeenCalledWith('mainnet');
  });

  it('STACKS.createService passes the full StacksNetworkLike object form', () => {
    const spy = vi.spyOn(StacksXService, 'getInstance').mockReturnValue({} as never);
    const entry = {
      chainId: 1,
      transactionVersion: 0,
      peerNetworkId: 0,
      magicBytes: 'X2',
      bootAddress: '',
      addressVersion: { singleSig: 0, multiSig: 0 },
      client: { baseUrl: 'https://api.hiro.so' },
    };
    getChainEntry('STACKS').createService({
      STACKS: { chains: { [ChainKeys.STACKS_MAINNET]: entry } },
    });
    expect(spy).toHaveBeenCalledWith(entry);
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
    ['bc1pxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', 'P2TR', 'signBip322Message', 'sig-bip322'],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'P2SH', 'signEcdsaMessage', 'sig-ecdsa'],
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
