import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { getEntryDefaults, getRpcUrl, resolveEvmDefaults } from './walletRpcConfig.js';
import type { EvmChainEntry } from '@/types/config.js';

// ─── getEntryDefaults ───────────────────────────────────────────────────────

describe('getEntryDefaults', () => {
  it('returns defaults from an object entry', () => {
    const entry = {
      rpcUrl: 'https://arbitrum.drpc.org',
      defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } },
    };
    const result = getEntryDefaults<typeof ChainKeys.ARBITRUM_MAINNET>(entry);
    expect(result).toEqual({
      waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 },
    });
  });

  it('returns undefined for a missing entry, a Stacks preset name, or an entry without defaults', () => {
    expect(getEntryDefaults(undefined)).toBeUndefined();
    expect(getEntryDefaults<typeof ChainKeys.STACKS_MAINNET>('mainnet')).toBeUndefined();
    expect(getEntryDefaults<typeof ChainKeys.ARBITRUM_MAINNET>({ rpcUrl: 'https://x' })).toBeUndefined();
  });
});

// ─── getRpcUrl ──────────────────────────────────────────────────────────────

describe('getRpcUrl', () => {
  it('returns rpcUrl from object entry', () => {
    expect(getRpcUrl({ rpcUrl: 'https://arbitrum.drpc.org', defaults: {} })).toBe('https://arbitrum.drpc.org');
  });

  it('returns undefined for a missing entry, a Stacks preset name, or an entry without rpcUrl', () => {
    expect(getRpcUrl(undefined)).toBeUndefined();
    expect(getRpcUrl<typeof ChainKeys.STACKS_MAINNET>('mainnet')).toBeUndefined();
    expect(getRpcUrl({ defaults: {} })).toBeUndefined();
  });
});

// ─── resolveEvmDefaults ─────────────────────────────────────────────────────

describe('resolveEvmDefaults', () => {
  const arbDefaults = { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } };
  const ethDefaults = { waitForTransactionReceipt: { confirmations: 3, timeout: 180_000 } };
  const evmChains: Partial<
    Record<typeof ChainKeys.ARBITRUM_MAINNET | typeof ChainKeys.ETHEREUM_MAINNET, EvmChainEntry>
  > = {
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb', defaults: arbDefaults },
    [ChainKeys.ETHEREUM_MAINNET]: { rpcUrl: 'https://eth', defaults: ethDefaults },
  };

  it('returns the defaults of the active chain', () => {
    expect(resolveEvmDefaults(42161, evmChains)).toEqual(arbDefaults);
    expect(resolveEvmDefaults(1, evmChains)).toEqual(ethDefaults);
  });

  it('returns undefined when the active chain is unconfigured, unknown, or has no defaults', () => {
    // 137 = Polygon, not in our test config
    expect(resolveEvmDefaults(137, evmChains)).toBeUndefined();
    expect(resolveEvmDefaults(999_999, evmChains)).toBeUndefined();
    expect(resolveEvmDefaults(42161, { [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb' } })).toBeUndefined();
  });

  it('returns undefined without an active chain (wallet disconnected) or EVM config', () => {
    expect(resolveEvmDefaults(undefined, evmChains)).toBeUndefined();
    expect(resolveEvmDefaults(42161, undefined)).toBeUndefined();
  });
});
