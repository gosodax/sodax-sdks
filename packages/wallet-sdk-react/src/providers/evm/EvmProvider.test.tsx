import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { EvmTypeConfig } from '@/types/config.js';
import * as EvmXService from '@/xchains/evm/EvmXService.js';
import { EvmProvider } from './EvmProvider.js';

// Stub Hydrator/Actions/WagmiProvider so the test renders only the wiring and can capture wagmi props.
vi.mock('./EvmHydrator.js', () => ({ EvmHydrator: () => null }));
vi.mock('./EvmActions.js', () => ({ EvmActions: () => null }));

const captured = vi.hoisted(() => ({ initialState: undefined as unknown }));
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
});
