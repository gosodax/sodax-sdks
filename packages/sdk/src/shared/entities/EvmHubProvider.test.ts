/**
 * Wiring test for hub/Sonic RPC failover (issue #225).
 *
 * Proves the config -> helper -> viem client path end to end without any RPC call: a `new Sodax(...)`
 * with multi-endpoint hub/Sonic config produces `fallback()` clients with the expected endpoint count,
 * and the default (no `rpcUrls`) stays a single-endpoint fallback (backward compatible). The hub chain
 * is read by two clients — `hubProvider.publicClient` (from `hub.rpcUrls`) and `spoke.sonic.publicClient`
 * (from `chains.sonic.rpcUrls`) — so both are asserted independently.
 */
import { describe, expect, it } from 'vitest';
import { ChainKeys } from '@sodax/types';
import { Sodax } from './Sodax.js';

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

// Each configured endpoint URL is at `transport.transports[i].value.url` on the flattened fallback.
// viem's TransportConfig does not declare `transports`; it exists at runtime on a fallback transport.
function endpointUrls(transport: unknown): string[] {
  return (transport as { transports: { value: { url: string } }[] }).transports.map(t => t.value.url);
}

describe('Sodax hub RPC failover wiring', () => {
  it('threads hub.rpcUrls into the hub client only, leaving the Sonic spoke client at its default', () => {
    const sodax = new Sodax({ hub: { rpcUrls: [A, B] } });
    const transport = sodax.hubProvider.publicClient.transport;
    expect(transport.type).toBe('fallback');
    expect(endpointUrls(transport)).toEqual([A, B]);
    // Independence: the Sonic spoke knob was untouched, so its client stays single-endpoint.
    expect(sodax.spoke.sonic.publicClient.transport.transports).toHaveLength(1);
  });

  it('threads chains.sonic.rpcUrls into the Sonic spoke client only, leaving the hub client at its default', () => {
    const sodax = new Sodax({ chains: { [ChainKeys.SONIC_MAINNET]: { rpcUrls: [A, B, C] } } });
    const transport = sodax.spoke.sonic.publicClient.transport;
    expect(transport.type).toBe('fallback');
    expect(endpointUrls(transport)).toEqual([A, B, C]);
    // Independence: the hub knob was untouched, so its client stays single-endpoint.
    expect(sodax.hubProvider.publicClient.transport.transports).toHaveLength(1);
  });

  it('defaults to a single-endpoint fallback when rpcUrls is unset (backward compatible)', () => {
    const sodax = new Sodax();
    expect(sodax.hubProvider.publicClient.transport.transports).toHaveLength(1);
    expect(sodax.spoke.sonic.publicClient.transport.transports).toHaveLength(1);
  });
});
