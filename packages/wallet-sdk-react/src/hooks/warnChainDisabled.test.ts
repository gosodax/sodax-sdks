import type { ChainType } from '@sodax/types';
import { describe, expect, it } from 'vitest';
import type { SodaxWalletConfig } from '@/types/config.js';
import { type ChainEnablementState, shouldWarnChainDisabled } from './warnChainDisabled.js';

const CONFIG = { EVM: {} } satisfies SodaxWalletConfig;

const state = (over: Partial<ChainEnablementState> = {}): ChainEnablementState => ({
  enabledChains: [],
  walletConfig: CONFIG,
  ...over,
});

describe('shouldWarnChainDisabled', () => {
  // The regression this exists for: children render before the parent effect that fills the store,
  // so a correctly-configured app sees enabledChains === [] once on mount.
  it('stays silent before initChainServices has run', () => {
    const before = state({ walletConfig: undefined, enabledChains: [] });
    expect(shouldWarnChainDisabled('EVM', before, new Set())).toBe(false);
  });

  it('does not consume the one-shot while uninitialized', () => {
    const warned = new Set<ChainType>();
    shouldWarnChainDisabled('EVM', state({ walletConfig: undefined }), warned);

    expect(warned.has('EVM')).toBe(false);
    expect(shouldWarnChainDisabled('EVM', state(), warned)).toBe(true);
  });

  it('warns once a genuinely missing chain is queried after init', () => {
    expect(shouldWarnChainDisabled('EVM', state({ enabledChains: ['SOLANA'] }), new Set())).toBe(true);
  });

  it('stays silent for an enabled chain', () => {
    expect(shouldWarnChainDisabled('EVM', state({ enabledChains: ['EVM'] }), new Set())).toBe(false);
  });

  it('warns only once per chain', () => {
    const warned = new Set<ChainType>();
    expect(shouldWarnChainDisabled('EVM', state(), warned)).toBe(true);
    expect(shouldWarnChainDisabled('EVM', state(), warned)).toBe(false);
  });

  it('tracks each chain separately', () => {
    const warned = new Set<ChainType>();
    expect(shouldWarnChainDisabled('EVM', state(), warned)).toBe(true);
    expect(shouldWarnChainDisabled('SOLANA', state(), warned)).toBe(true);
  });
});
