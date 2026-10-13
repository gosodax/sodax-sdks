import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChainKeys } from '@sodax/types';
import { mock } from 'wagmi/connectors';
import type { EvmTypeConfig } from '@/types/config.js';
import * as EvmXService from '@/xchains/evm/EvmXService.js';
import { EvmProvider } from './EvmProvider.js';
import { createPrivySource, type PrivySourceContext } from './privySource.js';

// Stub Hydrator/Actions/WagmiProvider so the test renders only the wiring and can capture their props.
const captured = vi.hoisted(() => ({ initialState: undefined as unknown, onDisconnect: undefined as unknown }));
vi.mock('./EvmHydrator.js', () => ({ EvmHydrator: () => null }));
vi.mock('./EvmActions.js', () => ({
  EvmActions: ({ onDisconnect }: { onDisconnect?: unknown }) => {
    captured.onDisconnect = onDisconnect;
    return null;
  },
}));
vi.mock('wagmi', async importOriginal => {
  const actual = await importOriginal<typeof import('wagmi')>();
  return {
    ...actual,
    WagmiProvider: ({ initialState, children }: { initialState?: unknown; children?: ReactNode }) => {
      captured.initialState = initialState;
      return children;
    },
  };
});

afterEach(() => {
  cleanup();
  captured.initialState = undefined;
  captured.onDisconnect = undefined;
  vi.restoreAllMocks();
});

describe('EvmProvider', () => {
  it('forwards config.persistKey into createWagmiConfig', () => {
    const spy = vi.spyOn(EvmXService, 'createWagmiConfig');
    render(<EvmProvider config={{ persistKey: 'custom-key' }}>{null}</EvmProvider>);
    expect(spy).toHaveBeenCalledWith(undefined, expect.objectContaining({ persistKey: 'custom-key' }));
  });

  it('forwards a non-array object initialState to wagmi', () => {
    const state = EvmXService.createWagmiConfig().state;
    render(<EvmProvider config={{ initialState: state }}>{null}</EvmProvider>);
    expect(captured.initialState).toBe(state);
  });

  it('drops a non-object initialState (passes undefined to wagmi) and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Simulate an untyped JS caller passing a non-object — Object.defineProperty avoids a cast.
    const config: EvmTypeConfig = {};
    Object.defineProperty(config, 'initialState', { value: 'garbage', enumerable: true });

    render(<EvmProvider config={config}>{null}</EvmProvider>);

    expect(captured.initialState).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('adds no connector and renders children directly without EVM.privy', () => {
    const spy = vi.spyOn(EvmXService, 'createWagmiConfig');
    const { getByText } = render(
      <EvmProvider config={{}}>
        <span>child</span>
      </EvmProvider>,
    );
    expect(spy).toHaveBeenCalledWith(undefined, expect.objectContaining({ connectors: [] }));
    expect(getByText('child')).toBeTruthy();
  });

  it('appends the EVM.privy connector, hands it the transport URLs, and wraps children in its Host', () => {
    const spy = vi.spyOn(EvmXService, 'createWagmiConfig');
    const connector = mock({ accounts: ['0x0000000000000000000000000000000000000001'] });
    const disconnect = async () => undefined;
    const chains = { [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.example' } };
    let ctx: PrivySourceContext | undefined;
    const privy = createPrivySource(sourceCtx => {
      ctx = sourceCtx;
      return { connector, disconnect, Host: ({ children }) => <div data-testid="host">{children}</div> };
    });

    const { getByTestId } = render(
      <EvmProvider config={{ chains, privy }}>
        <span>child</span>
      </EvmProvider>,
    );

    expect(spy).toHaveBeenCalledWith(chains, expect.objectContaining({ connectors: [connector] }));
    expect(ctx?.rpcUrls).toEqual(EvmXService.resolveEvmRpcUrls(chains));
    expect(ctx?.rpcUrls[8453]).toBe('https://base.example');
    expect(ctx?.getState()).toBe(spy.mock.results[0]?.value.state);
    expect(getByTestId('host').textContent).toBe('child');
    expect(captured.onDisconnect).toBe(disconnect);
  });

  it('warns and skips an EVM.privy value that privy() did not create', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(EvmXService, 'createWagmiConfig');
    const { getByText } = render(
      <EvmProvider config={{ privy: { kind: 'privy' } }}>
        <span>child</span>
      </EvmProvider>,
    );
    expect(warn).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(undefined, expect.objectContaining({ connectors: [] }));
    expect(getByText('child')).toBeTruthy();
  });
});
