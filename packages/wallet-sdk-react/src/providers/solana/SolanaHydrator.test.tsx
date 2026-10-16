import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

const adapterState = {
  connection: { rpcEndpoint: 'http://default' } as { rpcEndpoint: string },
  wallet: {
    connected: false,
    publicKey: undefined as { toString(): string } | undefined,
    wallet: undefined as { adapter: { name: string } } | undefined,
    wallets: [] as unknown[],
  },
};

vi.mock('@solana/wallet-adapter-react', () => ({
  useConnection: () => ({ connection: adapterState.connection }),
  useWallet: () => adapterState.wallet,
}));

const solanaCtor = vi.fn();
vi.mock('@sodax/wallet-sdk-core', () => ({
  // vitest 4 builds the instance with Reflect.construct, so a `new`-ed mock needs a class impl.
  SolanaWalletProvider: vi.fn(
    class {
      defaults: unknown;
      _opts: { defaults?: unknown };
      constructor(opts: { defaults?: unknown }) {
        solanaCtor(opts);
        this.defaults = opts.defaults;
        this._opts = opts;
      }
    },
  ),
}));

vi.mock('../../xchains/solana/SolanaXService.js', () => ({
  SolanaXService: { getInstance: () => ({ connection: undefined, wallet: undefined, setXConnectors: vi.fn() }) },
}));
vi.mock('../../xchains/solana/index.js', () => ({
  SolanaXConnector: vi.fn(
    class {
      id = 'solana-connector';
      _wrapped: unknown;
      constructor(w: unknown) {
        this._wrapped = w;
      }
    },
  ),
}));

const setters = {
  setXConnection: vi.fn(),
  unsetXConnection: vi.fn(),
  setWalletProvider: vi.fn(),
  setXConnectors: vi.fn(),
};
vi.mock('../../useXWalletStore.js', () => ({
  useXWalletStore: Object.assign((s: (st: unknown) => unknown) => s(setters), {
    getState: () => ({ setXConnectors: setters.setXConnectors, xConnections: {} }),
  }),
}));

import { SolanaHydrator } from './SolanaHydrator.js';
import { WalletConfigProvider } from '@/context/WalletConfigContext.js';

const fakePubKey = { toString: () => 'SoLaNaPubKey1234567890' };
const connect = () => {
  adapterState.wallet = {
    connected: true,
    publicKey: fakePubKey,
    wallet: { adapter: { name: 'Phantom' } },
    wallets: [],
  };
};
const renderWith = (config: SodaxWalletConfig) =>
  render(
    <WalletConfigProvider value={config}>
      <SolanaHydrator />
    </WalletConfigProvider>,
  );

describe('SolanaHydrator → SolanaWalletProvider', () => {
  beforeEach(() => {
    adapterState.connection = { rpcEndpoint: 'http://default' };
    adapterState.wallet = { connected: false, publicKey: undefined, wallet: undefined, wallets: [] };
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('forwards defaults from config.SOLANA.chains[SOLANA_MAINNET].defaults', () => {
    connect();
    renderWith({
      SOLANA: {
        chains: {
          [ChainKeys.SOLANA_MAINNET]: { defaults: { sendOptions: { skipPreflight: false, maxRetries: 3 } } },
        },
      },
    });
    expect(solanaCtor.mock.calls[0]?.[0]).toMatchObject({
      defaults: { sendOptions: { skipPreflight: false, maxRetries: 3 } },
    });
  });

  it('forwards rpcEndpoint from ConnectionProvider into ctor', () => {
    connect();
    adapterState.connection = { rpcEndpoint: 'https://configured-endpoint' };
    renderWith({ SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { rpcUrl: 'https://configured-endpoint' } } } });
    expect(solanaCtor.mock.calls[0]?.[0].endpoint).toBe('https://configured-endpoint');
  });

  it('passes undefined defaults when SOLANA chains map omits SOLANA_MAINNET entry', () => {
    connect();
    renderWith({ SOLANA: {} });
    expect(solanaCtor.mock.calls[0]?.[0].defaults).toBeUndefined();
  });

  it('does not construct SolanaWalletProvider when wallet is disconnected', () => {
    renderWith({ SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { defaults: { sendOptions: {} } } } } });
    expect(solanaCtor).not.toHaveBeenCalled();
    expect(setters.setWalletProvider).toHaveBeenCalledWith('SOLANA', undefined);
  });

  it('writes the constructed provider into the SOLANA slot of the store', () => {
    connect();
    renderWith({
      SOLANA: { chains: { [ChainKeys.SOLANA_MAINNET]: { defaults: { sendOptions: { skipPreflight: false } } } } },
    });
    const [chain, provider] = setters.setWalletProvider.mock.calls.at(-1) ?? [];
    expect(chain).toBe('SOLANA');
    expect((provider as { defaults?: unknown }).defaults).toEqual({ sendOptions: { skipPreflight: false } });
  });
});
