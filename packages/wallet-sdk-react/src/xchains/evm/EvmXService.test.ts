import { describe, it, expect } from 'vitest';
import { baseChainInfo, ChainKeys, EVM_CHAIN_KEYS } from '@sodax/types';
import { createWagmiConfig, resolveEvmRpcUrls, SODAX_EVM_CHAINS, tryCookieToInitialState } from './EvmXService.js';

// Verifies user-supplied `rpcUrl` from `SodaxWalletConfig.EVM.chains[K]` is
// threaded into wagmi's http transport for the matching chain id. wagmi stores
// the URL on `client.transport.url` (viem http transport), which is what every
// downstream wallet client reads when issuing JSON-RPC calls.

describe('createWagmiConfig — rpcUrl forwarding', () => {
  it('routes every EVM chain key override into the http transport of its own chain id', () => {
    const evmChains = Object.fromEntries(EVM_CHAIN_KEYS.map(key => [key, { rpcUrl: `https://${key}.example` }]));
    const config = createWagmiConfig(evmChains);
    for (const key of EVM_CHAIN_KEYS) {
      const chainId = baseChainInfo[key].chainId;
      expect(config.getClient({ chainId }).transport.url).toBe(`https://${key}.example`);
    }
  });

  it('falls back to viem chain default rpc when chain entry omits rpcUrl', () => {
    const config = createWagmiConfig({
      [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://test-arb-rpc.example' },
      // base intentionally omitted
    });
    const baseClient = config.getClient({ chainId: 8453 });
    expect(baseClient.transport.url).toBe(SODAX_EVM_CHAINS.find(chain => chain.id === 8453)?.rpcUrls.default.http[0]);
  });
});

describe('SODAX_EVM_CHAINS / resolveEvmRpcUrls', () => {
  it('carries exactly the chains behind EvmChainKey', () => {
    const tupleIds = SODAX_EVM_CHAINS.map(chain => chain.id).sort((a, b) => a - b);
    const keyIds = EVM_CHAIN_KEYS.map(key => baseChainInfo[key].chainId).sort((a, b) => a - b);
    expect(tupleIds).toEqual(keyIds);
  });

  it('falls back to each chain default without overrides', () => {
    const urls = resolveEvmRpcUrls(undefined);
    for (const chain of SODAX_EVM_CHAINS) {
      expect(urls[chain.id]).toBe(chain.rpcUrls.default.http[0]);
    }
  });
});

// `persistKey` is the base storage key; wagmi writes the cookie as `<key>.store`.
describe('createWagmiConfig — persistKey (cookie storage)', () => {
  it('uses persistKey as the storage base key, defaulting to "sodax" for backward compatibility', () => {
    expect(createWagmiConfig().storage?.key).toBe('sodax');
    expect(createWagmiConfig(undefined, { persistKey: 'my-app' }).storage?.key).toBe('my-app');
  });
});

describe('tryCookieToInitialState', () => {
  const config = createWagmiConfig();

  it('returns undefined, without throwing, for a missing, unrelated or malformed cookie', () => {
    const malformed = `${config.storage?.key}.store=${encodeURIComponent('{')}`;
    expect(tryCookieToInitialState(config, null)).toBeUndefined();
    expect(tryCookieToInitialState(config, undefined)).toBeUndefined();
    expect(tryCookieToInitialState(config, 'foo=bar')).toBeUndefined();
    expect(() => tryCookieToInitialState(config, malformed)).not.toThrow();
    expect(tryCookieToInitialState(config, malformed)).toBeUndefined();
  });

  it('returns the decoded state from a well-formed cookie', () => {
    // wagmi reads `<key>.store`, then `deserialize(value).state`; the value is not URL-decoded.
    const cookie = `${config.storage?.key}.store=${JSON.stringify({ state: { chainId: 1 } })}`;
    expect(tryCookieToInitialState(config, cookie)).toEqual({ chainId: 1 });
  });
});
