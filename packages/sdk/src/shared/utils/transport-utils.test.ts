/**
 * Tests for the hub/Sonic RPC failover helper (issue #225).
 *
 * `buildEvmRpcTransport` normalizes the endpoint list (`rpcUrls` minus blanks when it has a usable
 * entry, else the single `rpcUrl` — tolerating backend payloads that omit/blank `rpcUrls`) and wraps
 * it in viem's `fallback()` transport. viem `fallback()` is pure construction, so the shape tests make
 * no network call; we read the transport's runtime shape (`type`, `transports`) back through a viem
 * `PublicClient`, exactly as the SDK uses it. The rank-gating tests DO exercise viem's latency ranker,
 * which fires `net_listening` pings at construction — those use a stubbed `fetch` under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient } from 'viem';
import { buildEvmRpcTransport, type EvmRpcConfig } from './transport-utils.js';

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';

// Read back viem's flattened transport (config + value) the way createPublicClient exposes it.
function inspectTransport(cfg: EvmRpcConfig) {
  return createPublicClient({ transport: buildEvmRpcTransport(cfg) }).transport;
}

// The flattened fallback transport exposes each inner endpoint's URL at `transports[i].value.url`.
// Asserting the URLs (not just the count) proves the right endpoints landed in the right order.
function endpointUrls(cfg: EvmRpcConfig): string[] {
  return inspectTransport(cfg).transports.map((t: { value: { url: string } }) => t.value.url);
}

describe('buildEvmRpcTransport', () => {
  it('builds a fallback transport from the single rpcUrl when rpcUrls is absent, empty or all blank', () => {
    expect(inspectTransport({ rpcUrl: A }).type).toBe('fallback');
    expect(endpointUrls({ rpcUrl: A })).toEqual([A]);
    // Never an empty transport; a malformed all-blank / whitespace-only list (e.g. unset env vars)
    // must not suppress the working rpcUrl.
    expect(endpointUrls({ rpcUrl: A, rpcUrls: [] })).toEqual([A]);
    expect(endpointUrls({ rpcUrl: A, rpcUrls: ['', ''] })).toEqual([A]);
    expect(endpointUrls({ rpcUrl: A, rpcUrls: ['   ', '\t', '\n'] })).toEqual([A]);
  });

  it('drops blank entries and trims usable ones, which then supersede the primary', () => {
    // Proves supersession (not "ignore rpcUrls"): the surviving endpoint is B, and A is gone.
    expect(endpointUrls({ rpcUrl: A, rpcUrls: ['', B] })).toEqual([B]);
    expect(endpointUrls({ rpcUrl: A, rpcUrls: ['  ', B] })).toEqual([B]);
    expect(endpointUrls({ rpcUrl: A, rpcUrls: [`  ${B}  `] })).toEqual([B]);
  });

  it('includes one inner transport per unique endpoint, primary first, in first-seen order', () => {
    expect(inspectTransport({ rpcUrl: A, rpcUrls: [A, B, C] }).type).toBe('fallback');
    expect(endpointUrls({ rpcUrl: A, rpcUrls: [A, B, C] })).toEqual([A, B, C]);
    expect(endpointUrls({ rpcUrl: A, rpcUrls: [A, A, B, B] })).toEqual([A, B]);
  });
});

// viem's `rank` starts a perpetual background latency poll (net_listening pings) at construction.
// We gate it to multi-endpoint configs, so a single endpoint must NOT start that poll. Stub fetch so
// no real network is hit, and use fake timers so the rescheduled poll leaves no dangling real timer.
describe('buildEvmRpcTransport — rank gating', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not start latency ranking for a single endpoint even when rank is on', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchSpy);

    createPublicClient({ transport: buildEvmRpcTransport({ rpcUrl: A, rpcOptions: { rank: true } }) });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts latency ranking when rank is on and multiple endpoints survive', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchSpy);

    createPublicClient({ transport: buildEvmRpcTransport({ rpcUrl: A, rpcUrls: [A, B], rpcOptions: { rank: true } }) });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).toHaveBeenCalled();
  });
});
