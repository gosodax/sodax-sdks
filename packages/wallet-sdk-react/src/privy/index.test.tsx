import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ChainKeys } from '@sodax/types';
import { setupPrivySource } from '@/providers/evm/privySource.js';
import { resolveEvmRpcUrls } from '@/xchains/evm/EvmXService.js';
import { privy, type PrivyOptions } from './index.js';

const privyModule = vi.hoisted(() => ({ version: '3.40.0', appIds: [] as string[] }));

vi.mock('@privy-io/react-auth', () => ({
  get VERSION() {
    return privyModule.version;
  },
  PrivyProvider: ({ appId, children }: { appId: string; children?: ReactNode }) => {
    privyModule.appIds.push(appId);
    return children;
  },
  usePrivy: () => ({ ready: false, authenticated: false, user: null, error: null, logout: vi.fn() }),
  useWallets: () => ({ wallets: [], ready: false }),
  useCreateWallet: () => ({ createWallet: vi.fn() }),
  useLogin: () => ({ login: vi.fn() }),
}));

const ctx = { rpcUrls: resolveEvmRpcUrls(undefined), getState: vi.fn() };

beforeEach(() => {
  privyModule.version = '3.40.0';
  privyModule.appIds = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('privy()', () => {
  it('returns an opaque value that EvmProvider can set up', () => {
    const source = privy({ appId: 'app' });

    expect(source.kind).toBe('privy');
    expect(Object.isFrozen(source)).toBe(true);
    const setup = setupPrivySource(source, ctx);
    expect(typeof setup?.connector).toBe('function');
    expect(typeof setup?.Host).toBe('function');
  });

  it('is not a plain object, so React refuses to pass it from a Server Component', () => {
    expect(Object.getPrototypeOf(privy({ appId: 'app' }))).not.toBe(Object.prototype);
  });

  it('is safe to call inline: each call is independent and nothing runs until setup', () => {
    const first = privy({ appId: 'app' });
    const second = privy({ appId: 'app' });

    expect(first).not.toBe(second);
    expect(ctx.getState).not.toHaveBeenCalled();
  });

  it('hands PrivyProvider a trimmed app id', () => {
    const setup = setupPrivySource(privy({ appId: ' app\n' }), ctx);
    if (!setup) throw new Error('no setup');
    const { Host } = setup;

    render(<Host />);

    expect(privyModule.appIds).toContain('app');
  });

  it('accepts any EVM chain key as the default chain', () => {
    expect(setupPrivySource(privy({ appId: 'app', defaultChain: ChainKeys.HEDERA_MAINNET }), ctx)).toBeDefined();
  });

  describe('never throws on bad input — warns and leaves "Email (Privy)" out', () => {
    it('for an empty app id (an unset env var)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const source = privy({ appId: ' ' });

      expect(setupPrivySource(source, ctx)).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('appId'));
    });

    it('for a non-EVM default chain from an untyped caller', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const options: PrivyOptions = { appId: 'app' };
      Object.defineProperty(options, 'defaultChain', { value: ChainKeys.SOLANA_MAINNET, enumerable: true });

      expect(setupPrivySource(privy(options), ctx)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('defaultChain'));
    });

    it('for a Privy older than the tested floor', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      privyModule.version = '3.39.2';

      expect(setupPrivySource(privy({ appId: 'app' }), ctx)).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('3.39.2'));
    });
  });
});
