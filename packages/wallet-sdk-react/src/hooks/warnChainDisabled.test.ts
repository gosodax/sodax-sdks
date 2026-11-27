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
  it('stays silent before initChainServices has run, without consuming the one-shot', () => {
    const warned = new Set<ChainType>();

    expect(shouldWarnChainDisabled('EVM', state({ walletConfig: undefined }), warned)).toBe(false);
    expect(warned.has('EVM')).toBe(false);
    expect(shouldWarnChainDisabled('EVM', state(), warned)).toBe(true);
  });

  it('stays silent for an enabled chain', () => {
    expect(shouldWarnChainDisabled('EVM', state({ enabledChains: ['EVM'] }), new Set())).toBe(false);
  });

  it('warns once per missing chain after init, tracking each chain separately', () => {
    const warned = new Set<ChainType>();
    const initialized = state({ enabledChains: ['SUI'] });

    expect(shouldWarnChainDisabled('EVM', initialized, warned)).toBe(true);
    expect(shouldWarnChainDisabled('EVM', initialized, warned)).toBe(false);
    expect(shouldWarnChainDisabled('SOLANA', initialized, warned)).toBe(true);
  });
});
