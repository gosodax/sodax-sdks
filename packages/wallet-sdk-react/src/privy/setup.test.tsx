import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { sonic } from 'viem/chains';
import { type Config, createConfig, createStorage, http, noopStorage } from 'wagmi';
import { connect } from 'wagmi/actions';
import { resolveEvmRpcUrls } from '@/xchains/evm/EvmXService.js';
import { createPrivySetup } from './setup.js';

// PrivyProvider throwing during render is how Privy 3.40 rejects a plain-http origin or a malformed app id.
vi.mock('@privy-io/react-auth', () => ({
  PrivyProvider: () => {
    throw new Error('Embedded wallet is only available over HTTPS');
  },
  usePrivy: vi.fn(),
  useWallets: vi.fn(),
  useCreateWallet: vi.fn(),
  useLogin: vi.fn(),
  VERSION: '3.40.0',
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('createPrivySetup', () => {
  it('keeps the app rendering when Privy cannot start, and fails "Email (Privy)" with the cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let config: Config | undefined;
    const setup = createPrivySetup({ appId: 'app' }, sonic.id, {
      rpcUrls: resolveEvmRpcUrls(undefined),
      getState: () => {
        if (!config) throw new Error('config not created');
        return config.state;
      },
    });
    config = createConfig({
      chains: [sonic],
      connectors: [setup.connector],
      multiInjectedProviderDiscovery: false,
      storage: createStorage({ storage: noopStorage }),
      transports: { [sonic.id]: http() },
    });
    const { Host } = setup;

    const { getByText } = render(
      <Host>
        <span>partner app</span>
      </Host>,
    );

    expect(getByText('partner app')).toBeTruthy();
    const [privyConnector] = config.connectors;
    if (!privyConnector) throw new Error('no connector');
    await expect(connect(config, { connector: privyConnector })).rejects.toThrow('only available over HTTPS');
  });
});
