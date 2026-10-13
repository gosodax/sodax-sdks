import { describe, expect, it, vi } from 'vitest';
import { ChainKeys } from '@sodax/types';
import type { PrivySourceContext } from '@/providers/evm/privySource.js';
import { resolveEvmRpcUrls, SODAX_EVM_CHAINS } from '@/xchains/evm/EvmXService.js';
import { buildPrivyConfig, type PrivyOptions } from './privyConfig.js';

const ctx: PrivySourceContext = {
  rpcUrls: resolveEvmRpcUrls({ [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.example' } }),
  getState: vi.fn(),
};
const SONIC_ID = 146;

describe('buildPrivyConfig', () => {
  it('logs in by email only and turns off every Privy-side wallet connector', () => {
    const config = buildPrivyConfig({ appId: 'app' }, SONIC_ID, ctx);

    expect(config.loginMethods).toEqual(['email']);
    expect(config.appearance?.walletList).toEqual([]);
    expect(config.externalWallets).toEqual({ disableAllExternalWallets: true, walletConnect: { enabled: false } });
    expect(config.embeddedWallets).toEqual({ ethereum: { createOnLogin: 'users-without-wallets' } });
  });

  it('never sets MFA or recovery options, so Privy keeps prompting for MFA itself', () => {
    const config = buildPrivyConfig({ appId: 'app', legal: { termsAndConditionsUrl: '/terms' } }, SONIC_ID, ctx);

    expect(Object.keys(config).sort()).toEqual(
      [
        'appearance',
        'defaultChain',
        'embeddedWallets',
        'externalWallets',
        'legal',
        'loginMethods',
        'supportedChains',
      ].sort(),
    );
  });

  it('points every chain at the RPC the wagmi transport uses, without mutating the shared chains', () => {
    const config = buildPrivyConfig({ appId: 'app' }, SONIC_ID, ctx);
    const chains = config.supportedChains ?? [];

    expect(chains.map(chain => chain.id)).toEqual(SODAX_EVM_CHAINS.map(chain => chain.id));
    for (const chain of chains) {
      expect(chain.rpcUrls.privyWalletOverride?.http[0]).toBe(ctx.rpcUrls[chain.id]);
    }
    expect(chains.find(chain => chain.id === 8453)?.rpcUrls.privyWalletOverride?.http[0]).toBe('https://base.example');
    expect(SODAX_EVM_CHAINS.some(chain => 'privyWalletOverride' in chain.rpcUrls)).toBe(false);
  });

  it('starts on the default chain, taken from the decorated list', () => {
    const config = buildPrivyConfig({ appId: 'app' }, 8453, ctx);

    expect(config.defaultChain?.id).toBe(8453);
    expect(config.supportedChains).toContain(config.defaultChain);
  });

  it('passes showWalletUIs, legal and theming through, but keeps the wallet list empty', () => {
    const options: PrivyOptions = { appId: 'app', showWalletUIs: false, appearance: { theme: 'dark' } };
    // Simulate an untyped caller: the type forbids `walletList`, the config must still win.
    Object.defineProperty(options.appearance, 'walletList', { value: ['metamask'], enumerable: true });

    const config = buildPrivyConfig(options, SONIC_ID, ctx);

    expect(config.embeddedWallets?.showWalletUIs).toBe(false);
    expect(config.appearance).toMatchObject({ theme: 'dark', walletList: [] });
    expect(config).not.toHaveProperty('legal');
  });
});
