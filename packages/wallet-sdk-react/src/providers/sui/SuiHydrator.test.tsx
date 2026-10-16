import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChainKeys } from '@sodax/types';
import type { SodaxWalletConfig } from '@/types/config.js';

const GRPC_URL = 'https://fullnode.mainnet.sui.io';

const dappKit = {
  suiClient: { core: {} } as unknown,
  currentWallet: undefined as { name: string } | undefined,
  currentAccount: undefined as { address: string } | undefined,
  wallets: [] as unknown[],
  signTransaction: vi.fn(),
};

vi.mock('@mysten/dapp-kit-react', () => ({
  useDAppKit: () => ({ signTransaction: dappKit.signTransaction }),
  useCurrentClient: () => dappKit.suiClient,
  useCurrentWallet: () => dappKit.currentWallet,
  useCurrentAccount: () => dappKit.currentAccount,
  useWallets: () => dappKit.wallets,
  getWalletUniqueIdentifier: (w: { name: string }) => w.name,
}));

const suiCtor = vi.fn();
vi.mock('@sodax/wallet-sdk-core', () => ({
  // vitest 4 builds the instance with Reflect.construct, so a `new`-ed mock needs a class impl.
  SuiWalletProvider: vi.fn(
    class {
      defaults: unknown;
      _opts: { defaults?: unknown };
      constructor(opts: { defaults?: unknown }) {
        suiCtor(opts);
        this.defaults = opts.defaults;
        this._opts = opts;
      }
    },
  ),
}));

vi.mock('../../xchains/sui/index.js', () => ({
  SuiXService: { getInstance: () => ({ setXConnectors: vi.fn() }) },
  SuiXConnector: vi.fn(
    class {
      id = 'sui-connector';
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

import { SuiHydrator } from './SuiHydrator.js';
import { WalletConfigProvider } from '@/context/WalletConfigContext.js';

const connect = () => {
  dappKit.currentWallet = { name: 'Sui Wallet' };
  dappKit.currentAccount = { address: '0xsui-account' };
};
const renderWith = (config: SodaxWalletConfig) =>
  render(
    <WalletConfigProvider value={config}>
      <SuiHydrator grpcUrl={GRPC_URL} />
    </WalletConfigProvider>,
  );

describe('SuiHydrator → SuiWalletProvider', () => {
  beforeEach(() => {
    dappKit.suiClient = { core: {} };
    dappKit.currentWallet = undefined;
    dappKit.currentAccount = undefined;
    dappKit.wallets = [];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('forwards defaults, the resolved endpoint and the connected address to the ctor', () => {
    connect();
    renderWith({
      SUI: {
        chains: {
          [ChainKeys.SUI_MAINNET]: {
            defaults: { signAndExecuteTxn: { dryRun: { enabled: false } } },
          },
        },
      },
    });
    expect(suiCtor.mock.calls[0]?.[0]).toMatchObject({
      defaults: { signAndExecuteTxn: { dryRun: { enabled: false } } },
      grpcUrl: GRPC_URL,
      address: '0xsui-account',
    });
    expect(typeof suiCtor.mock.calls[0]?.[0].signTransaction).toBe('function');
  });

  it('passes undefined defaults when SUI chains map omits SUI_MAINNET entry', () => {
    connect();
    renderWith({ SUI: {} });
    expect(suiCtor.mock.calls[0]?.[0].defaults).toBeUndefined();
  });

  it('does not construct SuiWalletProvider while no account is connected', () => {
    renderWith({ SUI: { chains: { [ChainKeys.SUI_MAINNET]: { defaults: { signAndExecuteTxn: {} } } } } });
    expect(suiCtor).not.toHaveBeenCalled();
  });

  it('writes the constructed provider into the SUI slot of the store', () => {
    connect();
    renderWith({
      SUI: {
        chains: { [ChainKeys.SUI_MAINNET]: { defaults: { signAndExecuteTxn: { dryRun: { enabled: true } } } } },
      },
    });
    const [chain, provider] = setters.setWalletProvider.mock.calls.at(-1) ?? [];
    expect(chain).toBe('SUI');
    expect((provider as { defaults?: unknown }).defaults).toEqual({
      signAndExecuteTxn: { dryRun: { enabled: true } },
    });
  });

  it('records the connection with the wallet identifier dApp Kit derives', () => {
    connect();
    renderWith({ SUI: {} });
    expect(setters.setXConnection).toHaveBeenCalledWith('SUI', {
      xAccount: { address: '0xsui-account', xChainType: 'SUI' },
      xConnectorId: 'Sui Wallet',
    });
  });
});
