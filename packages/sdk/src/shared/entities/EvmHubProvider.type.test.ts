/** Compile-time contract for `EvmHubProvider.ts`: hub-wallet lookups resolve to hub addresses. */
import { describe, expectTypeOf, it } from 'vitest';
import type { PublicClient } from 'viem';
import type { Address, HubAddress, HubConfig } from '../../index.js';
import type { EvmHubProvider } from './EvmHubProvider.js';

describe('EvmHubProvider type contract', () => {
  it('pins each lookup result', () => {
    expectTypeOf<ReturnType<EvmHubProvider['getUserHubWalletAddress']>>().toEqualTypeOf<Promise<Address>>();
    expectTypeOf<ReturnType<EvmHubProvider['fetchUserHubWalletAddress']>>().toEqualTypeOf<Promise<Address>>();
    expectTypeOf<ReturnType<EvmHubProvider['getUserRouter']>>().toEqualTypeOf<Promise<HubAddress>>();
  });

  it('pins the public fields', () => {
    expectTypeOf<EvmHubProvider['publicClient']>().toEqualTypeOf<PublicClient>();
    expectTypeOf<EvmHubProvider['chainConfig']>().toEqualTypeOf<HubConfig>();
  });
});
