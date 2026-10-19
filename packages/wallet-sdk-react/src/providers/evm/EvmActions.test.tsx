import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAddress } from 'viem';
import { sonic } from 'viem/chains';
import {
  type Config,
  type Connector,
  type CreateConnectorFn,
  createConfig,
  createConnector,
  createStorage,
  http,
  noopStorage,
  WagmiProvider,
} from 'wagmi';
import { connect } from 'wagmi/actions';
import { EVM_DISCONNECT_TIMEOUT_MS } from '@/constants.js';
import { useXWalletStore } from '@/useXWalletStore.js';
import { EvmActions } from './EvmActions.js';

function localWallet(id: string, address: `0x${string}`, disconnect = vi.fn(async (): Promise<void> => undefined)) {
  const provider = {};
  const connectorFn = createConnector(() => ({
    id,
    name: id,
    type: id,
    connect: async () => ({ accounts: [getAddress(address)], chainId: sonic.id }),
    disconnect,
    getAccounts: async () => [getAddress(address)],
    getChainId: async () => sonic.id,
    getProvider: async () => provider,
    isAuthorized: async () => false,
    onAccountsChanged: () => undefined,
    onChainChanged: () => undefined,
    onDisconnect: () => undefined,
  }));
  return { connectorFn, disconnect };
}

/** Mounts `EvmActions` over a real wagmi config and connects every connector in order. */
async function connectAll(connectorFns: CreateConnectorFn[], onDisconnect?: () => Promise<void>): Promise<Config> {
  const config = createConfig({
    chains: [sonic],
    connectors: connectorFns,
    multiInjectedProviderDiscovery: false,
    storage: createStorage({ storage: noopStorage }),
    transports: { [sonic.id]: http() },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <WagmiProvider config={config}>
        <EvmActions onDisconnect={onDisconnect} />
      </WagmiProvider>
    </QueryClientProvider>,
  );
  const connectors: readonly Connector[] = config.connectors;
  for (const connector of connectors) await connect(config, { connector });
  return config;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('EvmActions', () => {
  it('disconnect ends every wagmi connection, not only the current one', async () => {
    const email = localWallet('email', '0x00000000000000000000000000000000000000aa');
    const extension = localWallet('extension', '0x00000000000000000000000000000000000000bb');
    const config = await connectAll([email.connectorFn, extension.connectorFn]);
    expect(config.state.connections.size).toBe(2);

    await useXWalletStore.getState().chainActions.EVM?.disconnect();

    expect(email.disconnect).toHaveBeenCalledOnce();
    expect(extension.disconnect).toHaveBeenCalledOnce();
    expect(config.state.status).toBe('disconnected');
    expect(useXWalletStore.getState().userDisconnected.EVM).toBe(true);
  });

  it('also ends a wallet source that wagmi does not list yet (Privy still restoring)', async () => {
    const onDisconnect = vi.fn(async (): Promise<void> => undefined);
    const config = await connectAll([], onDisconnect);
    expect(config.state.connections.size).toBe(0);

    await useXWalletStore.getState().chainActions.EVM?.disconnect();

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('does not wait forever on a wallet whose disconnect never settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stalled = localWallet(
      'stalled',
      '0x00000000000000000000000000000000000000aa',
      vi.fn(() => new Promise<void>(() => undefined)),
    );
    const healthy = localWallet('healthy', '0x00000000000000000000000000000000000000bb');
    await connectAll([stalled.connectorFn, healthy.connectorFn]);
    vi.useFakeTimers();

    const disconnecting = useXWalletStore.getState().chainActions.EVM?.disconnect();
    await vi.advanceTimersByTimeAsync(EVM_DISCONNECT_TIMEOUT_MS);

    await expect(disconnecting).resolves.toBeUndefined();
    expect(healthy.disconnect).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('wagmi disconnect failed'),
      expect.objectContaining({ message: expect.stringContaining('"stalled" did not finish') }),
    );
    expect(useXWalletStore.getState().userDisconnected.EVM).toBe(true);
  });
});
