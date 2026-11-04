import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { getEntryDefaults, getRpcUrl, resolveEvmDefaults } from './walletRpcConfig.js';
import type { EvmChainEntry } from '@/types/config.js';

// ─── getEntryDefaults ───────────────────────────────────────────────────────

describe('getEntryDefaults', () => {
  it('returns defaults from EVM object entry', () => {
    const entry = {
      rpcUrl: 'https://arbitrum.drpc.org',
      defaults: { waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 } },
    };
    const result = getEntryDefaults<typeof ChainKeys.ARBITRUM_MAINNET>(entry);
    expect(result).toEqual({
      waitForTransactionReceipt: { confirmations: 1, timeout: 60_000 },
    });
  });

  it('returns defaults from Stellar entry (RpcConfig-extended shape)', () => {
    const entry = {
      horizonRpcUrl: 'https://horizon.stellar.org' as const,
      sorobanRpcUrl: 'https://soroban-mainnet.stellar.org' as const,
      defaults: { pollInterval: 1000 },
    };
    const result = getEntryDefaults<typeof ChainKeys.STELLAR_MAINNET>(entry);
    expect(result).toEqual({ pollInterval: 1000 });
  });

  it('returns defaults from Bitcoin entry', () => {
    const entry = {
      rpcUrl: 'https://mempool.space/api',
      defaults: { defaultFinalize: true },
    };
    const result = getEntryDefaults<typeof ChainKeys.BITCOIN_MAINNET>(entry);
    expect(result).toEqual({ defaultFinalize: true });
  });

  it('returns undefined for missing entry', () => {
    expect(getEntryDefaults(undefined)).toBeUndefined();
  });

  it('returns undefined for Stacks preset name string (no defaults slot)', () => {
    expect(getEntryDefaults<typeof ChainKeys.STACKS_MAINNET>('mainnet')).toBeUndefined();
    expect(getEntryDefaults<typeof ChainKeys.STACKS_MAINNET>('testnet')).toBeUndefined();
  });

  it('returns undefined when entry has no defaults field', () => {
    const entry = { rpcUrl: 'https://x' };
    expect(getEntryDefaults<typeof ChainKeys.ARBITRUM_MAINNET>(entry)).toBeUndefined();
  });
});

// ─── getRpcUrl ──────────────────────────────────────────────────────────────

describe('getRpcUrl', () => {
  it('returns rpcUrl from object entry', () => {
    expect(getRpcUrl({ rpcUrl: 'https://arbitrum.drpc.org', defaults: {} })).toBe('https://arbitrum.drpc.org');
  });

  it('returns undefined when rpcUrl is omitted', () => {
    expect(getRpcUrl({ defaults: {} })).toBeUndefined();
  });

  it('returns undefined for missing entry', () => {
    expect(getRpcUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for Stacks preset name string', () => {
    expect(getRpcUrl<typeof ChainKeys.STACKS_MAINNET>('mainnet')).toBeUndefined();
  });

  it('returns rpcUrl from Bitcoin entry (RpcConfig-extended)', () => {
    const entry = {
      rpcUrl: 'https://mempool.space/api',
    };
    expect(getRpcUrl<typeof ChainKeys.BITCOIN_MAINNET>(entry)).toBe('https://mempool.space/api');
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

  it('returns Arbitrum defaults when active chainId = 42161', () => {
    expect(resolveEvmDefaults(42161, evmChains)).toEqual(arbDefaults);
  });

  it('returns Ethereum defaults when active chainId = 1', () => {
    expect(resolveEvmDefaults(1, evmChains)).toEqual(ethDefaults);
  });

  it('returns undefined when active chain has no entry in evmChains', () => {
    // 137 = Polygon, not in our test config
    expect(resolveEvmDefaults(137, evmChains)).toBeUndefined();
  });

  it('returns undefined when active chain entry has no defaults field', () => {
    const chainsWithoutDefaults = { [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb' } };
    expect(resolveEvmDefaults(42161, chainsWithoutDefaults)).toBeUndefined();
  });

  it('returns undefined when chainId is undefined (wallet disconnected)', () => {
    expect(resolveEvmDefaults(undefined, evmChains)).toBeUndefined();
  });

  it('returns undefined when evmChains is undefined (no EVM config)', () => {
    expect(resolveEvmDefaults(42161, undefined)).toBeUndefined();
  });

  it('returns undefined for unknown chainId', () => {
    expect(resolveEvmDefaults(999_999, evmChains)).toBeUndefined();
  });
});
