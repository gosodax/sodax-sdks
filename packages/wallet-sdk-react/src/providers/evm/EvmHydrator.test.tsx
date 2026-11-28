import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

// Stub every input EvmHydrator reads (wagmi hooks, core ctor, XService
// singleton, store) so the only observable output the suite exercises is what
// reaches `EvmWalletProvider(...)`.

type WagmiStatus = 'connecting' | 'reconnecting' | 'connected' | 'disconnected';
const wagmiState: {
  config: { _internal: 'fake-config' };
  connectors: unknown[];
  account: {
    address: `0x${string}` | undefined;
    status: WagmiStatus;
    connector: { id: string } | undefined;
  };
  publicClient: unknown;
  walletClient: unknown;
} = {
  config: { _internal: 'fake-config' },
  connectors: [],
  account: { address: undefined, status: 'disconnected', connector: undefined },
  publicClient: undefined,
  walletClient: undefined,
};

const reconnectFn = vi.fn();
vi.mock('wagmi', () => ({
  useConfig: () => wagmiState.config,
  useConnectors: () => wagmiState.connectors,
  useAccount: () => wagmiState.account,
  usePublicClient: () => wagmiState.publicClient,
  useWalletClient: () => ({ data: wagmiState.walletClient }),
  useReconnect: () => ({ reconnect: reconnectFn }),
}));

const evmCtor = vi.fn();
vi.mock('@sodax/wallet-sdk-core', () => ({
  // vitest 4 builds the instance with Reflect.construct, so a `new`-ed mock needs a class impl.
  EvmWalletProvider: vi.fn(
    class {
      defaults: unknown;
      _opts: { defaults?: unknown };
      constructor(opts: { defaults?: unknown }) {
        evmCtor(opts);
        this.defaults = opts.defaults;
        this._opts = opts;
      }
    },
  ),
}));

vi.mock('@/xchains/evm/EvmXService.js', () => ({
  EvmXService: { getInstance: () => ({ wagmiConfig: undefined, setXConnectors: vi.fn() }) },
}));
vi.mock('@/xchains/evm/index.js', () => ({
  EvmXConnector: vi.fn(
    class {
      id: string;
      constructor(c: { id: string }) {
        this.id = c.id;
      }
    },
  ),
}));

const setters = {
  setXConnection: vi.fn(),
  unsetXConnection: vi.fn(),
  setWalletProvider: vi.fn(),
  setXConnectors: vi.fn(),
  userDisconnected: {} as Partial<Record<'EVM', boolean>>,
  xConnections: {} as Partial<
    Record<'EVM', { xAccount: { address: string; xChainType: 'EVM' }; xConnectorId: string }>
  >,
};
vi.mock('@/useXWalletStore.js', () => ({
  useXWalletStore: Object.assign((s: (st: unknown) => unknown) => s(setters), {
    getState: () => ({
      setXConnectors: setters.setXConnectors,
      xConnections: setters.xConnections,
      userDisconnected: setters.userDisconnected,
    }),
    persist: {
      hasHydrated: () => true,
      onHydrate: () => () => {},
      onFinishHydration: () => () => {},
    },
  }),
}));

import { EvmHydrator } from './EvmHydrator.js';
import { WalletConfigProvider } from '@/context/WalletConfigContext.js';

const fakePublicClient = { transport: { url: 'http://fake' } };
const wallet = (chainId: number) => ({ chain: { id: chainId } });
const renderWith = (config: SodaxWalletConfig) =>
  render(
    <WalletConfigProvider value={config}>
      <EvmHydrator />
    </WalletConfigProvider>,
  );

describe('EvmHydrator → EvmWalletProvider', () => {
  beforeEach(() => {
    wagmiState.publicClient = fakePublicClient;
    wagmiState.walletClient = undefined;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('constructs the provider with the active chain defaults and writes it into the EVM store slot', () => {
    wagmiState.walletClient = wallet(42161);
    renderWith({
      EVM: {
        chains: {
          [ChainKeys.ARBITRUM_MAINNET]: {
            defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } },
          },
          [ChainKeys.ETHEREUM_MAINNET]: {
            defaults: { waitForTransactionReceipt: { confirmations: 3, timeout: 180_000 } },
          },
        },
      },
    });
    expect(evmCtor.mock.calls[0]?.[0]).toMatchObject({
      walletClient: wagmiState.walletClient,
      publicClient: wagmiState.publicClient,
      defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } },
    });
    const [chain, provider] = setters.setWalletProvider.mock.calls.at(-1) ?? [];
    expect(chain).toBe('EVM');
    expect((provider as { defaults?: unknown }).defaults).toEqual({
      waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 },
    });
  });

  it('reconstructs with new defaults when wagmi swaps walletClient on chain switch', () => {
    const config: SodaxWalletConfig = {
      EVM: {
        chains: {
          [ChainKeys.ARBITRUM_MAINNET]: { defaults: { waitForTransactionReceipt: { confirmations: 1 } } },
          [ChainKeys.ETHEREUM_MAINNET]: { defaults: { waitForTransactionReceipt: { confirmations: 3 } } },
        },
      },
    };
    wagmiState.walletClient = wallet(42161);
    const { rerender } = renderWith(config);
    expect(evmCtor.mock.calls.at(-1)?.[0].defaults.waitForTransactionReceipt.confirmations).toBe(1);

    wagmiState.walletClient = wallet(1);
    rerender(
      <WalletConfigProvider value={config}>
        <EvmHydrator />
      </WalletConfigProvider>,
    );
    expect(evmCtor.mock.calls.at(-1)?.[0].defaults.waitForTransactionReceipt.confirmations).toBe(3);
  });

  describe('wagmi status gate', () => {
    const fakeAddress = '0xabc' as const;
    const fakeConnector = { id: 'metamask' };

    // Regression for PR #13: wagmi reports 'connected' when the active chain is outside
    // wagmiConfig.chains (e.g. Injective EVM 1776), so useWalletClient() never resolves.
    // xConnections.EVM must track intent regardless; walletProviders.EVM stays undefined
    // until walletClient resolves so callers know to prompt switchChain before signing.
    it('calls setXConnection on connected even when walletClient is unresolved (intent tracking)', () => {
      wagmiState.walletClient = undefined;
      wagmiState.account = { address: fakeAddress, status: 'connected', connector: fakeConnector };
      renderWith({ EVM: {} });
      expect(setters.setXConnection).toHaveBeenCalledWith('EVM', {
        xAccount: { address: fakeAddress, xChainType: 'EVM' },
        xConnectorId: fakeConnector.id,
      });
      expect(setters.unsetXConnection).not.toHaveBeenCalled();
      expect(evmCtor).not.toHaveBeenCalled();
      expect(setters.setWalletProvider).toHaveBeenCalledWith('EVM', undefined);
    });

    it('calls unsetXConnection on disconnected after observing connected in this session', () => {
      wagmiState.walletClient = wallet(42161);
      wagmiState.account = { address: fakeAddress, status: 'connected', connector: fakeConnector };
      const { rerender } = renderWith({ EVM: {} });
      expect(setters.setXConnection).toHaveBeenCalledWith('EVM', {
        xAccount: { address: fakeAddress, xChainType: 'EVM' },
        xConnectorId: fakeConnector.id,
      });
      expect(setters.unsetXConnection).not.toHaveBeenCalled();

      wagmiState.walletClient = undefined;
      wagmiState.account = { address: undefined, status: 'disconnected', connector: undefined };
      rerender(
        <WalletConfigProvider value={{ EVM: {} }}>
          <EvmHydrator />
        </WalletConfigProvider>,
      );
      expect(setters.unsetXConnection).toHaveBeenCalledWith('EVM');
    });

    it('does not call setXConnection when userDisconnected.EVM is true (ghost reconnect)', () => {
      setters.userDisconnected = { EVM: true };
      wagmiState.walletClient = wallet(42161);
      wagmiState.account = { address: fakeAddress, status: 'connected', connector: fakeConnector };
      renderWith({ EVM: {} });
      expect(setters.setXConnection).not.toHaveBeenCalled();
      // walletProvider must also stay undefined to keep xConnection/walletProvider in sync
      const providerCalls = setters.setWalletProvider.mock.calls;
      expect(providerCalls.every(([, p]) => p === undefined)).toBe(true);
    });

    // #9: a persisted connection whose reconnect fails must be cleared, not left stale for the session.
    it('clears a stale persisted EVM connection when reconnect ends in disconnected', () => {
      setters.xConnections = { EVM: { xAccount: { address: '0xold', xChainType: 'EVM' }, xConnectorId: 'metamask' } };
      wagmiState.account = { address: undefined, status: 'disconnected', connector: undefined };
      const { rerender } = renderWith({ EVM: {} });
      // Initial disconnected must not clear yet — reconnect hasn't been attempted/resolved.
      expect(setters.unsetXConnection).not.toHaveBeenCalled();
      expect(reconnectFn).toHaveBeenCalled();

      const rerenderHydrator = () =>
        rerender(
          <WalletConfigProvider value={{ EVM: {} }}>
            <EvmHydrator />
          </WalletConfigProvider>,
        );

      wagmiState.account = { address: undefined, status: 'reconnecting', connector: undefined };
      rerenderHydrator();
      expect(setters.unsetXConnection).not.toHaveBeenCalled();
      expect(setters.setXConnection).not.toHaveBeenCalled();

      wagmiState.account = { address: undefined, status: 'disconnected', connector: undefined };
      rerenderHydrator();
      expect(setters.unsetXConnection).toHaveBeenCalledWith('EVM');
    });

    afterEach(() => {
      wagmiState.account = { address: undefined, status: 'disconnected', connector: undefined };
      setters.userDisconnected = {};
      setters.xConnections = {};
    });
  });
});
