import { ChainKeys } from '@sodax/types';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { useXWalletStore } from '@/useXWalletStore.js';
import { useWalletProvider } from './useWalletProvider.js';
import { useXConnectors } from './useXConnectors.js';

/**
 * Guards the mount-order regression through the real hooks and the real store.
 *
 * `useInitChainServices` fills `enabledChains` from an effect, and React runs children before
 * parent effects — so every child of a correctly-configured `SodaxWalletProvider` observes
 * `enabledChains === []` on its first render. Warning there is not just noise: the one-shot is
 * keyed by chain type, so it consumes the warning a genuine misconfiguration would need.
 *
 * The hooks' one-shot sets are module-level and cannot be reset — re-importing through
 * `vi.resetModules()` re-runs the chain registry, whose Stellar kit registers a custom element
 * that a second registration rejects. So each case below claims its own chain type instead.
 */
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  useXWalletStore.setState({ walletConfig: undefined, enabledChains: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const notEnabled = (): string[] =>
  warn.mock.calls.map(([first]) => String(first)).filter(message => message.includes('is not enabled'));

/** Post-init store state: config captured, EVM enabled, nothing else. */
const initialized = () => useXWalletStore.setState({ walletConfig: { EVM: {} }, enabledChains: ['EVM'] });

describe('chain-disabled warning', () => {
  it('is silent on the first render, before initChainServices has run', () => {
    renderHook(() => useWalletProvider({ xChainType: 'ICON' }));
    renderHook(() => useXConnectors({ xChainType: 'STACKS' }));

    expect(notEnabled()).toHaveLength(0);
  });

  // Asserted on both sides of init: the counts alone are equal whether or not the guard is there,
  // so only the ordering distinguishes a warning saved from a warning already spent.
  it('does not burn the one-shot during that first render', () => {
    renderHook(() => useWalletProvider({ xChainType: 'NEAR' })); // the mount-race render
    expect(notEnabled()).toHaveLength(0);

    initialized();
    renderHook(() => useWalletProvider({ xChainType: 'NEAR' })); // a real misconfiguration
    expect(notEnabled()).toHaveLength(1);
  });

  it('stays silent once the chain is enabled', () => {
    initialized();

    renderHook(() => useWalletProvider({ xChainId: ChainKeys.BASE_MAINNET }));
    renderHook(() => useXConnectors({ xChainType: 'EVM' }));

    expect(notEnabled()).toHaveLength(0);
  });

  it('still reports a genuinely missing chain, from either hook', () => {
    initialized();

    renderHook(() => useWalletProvider({ xChainType: 'SUI' }));
    renderHook(() => useXConnectors({ xChainType: 'SUI' }));

    const messages = notEnabled();
    expect(messages.some(message => message.startsWith('[useWalletProvider]'))).toBe(true);
    expect(messages.some(message => message.startsWith('[useXConnectors]'))).toBe(true);
  });

  it('warns only once per chain after init', () => {
    initialized();

    renderHook(() => useXConnectors({ xChainType: 'INJECTIVE' }));
    renderHook(() => useXConnectors({ xChainType: 'INJECTIVE' }));

    expect(notEnabled()).toHaveLength(1);
  });
});

describe('initChainServices', () => {
  // The fix reads `walletConfig` as the "init has run" signal, so that has to be what it means.
  it('sets walletConfig alongside enabledChains', () => {
    expect(useXWalletStore.getState().walletConfig).toBeUndefined();

    useXWalletStore.getState().initChainServices({ EVM: {} });

    expect(useXWalletStore.getState().walletConfig).toBeDefined();
    expect(useXWalletStore.getState().enabledChains).toContain('EVM');
  });
});
