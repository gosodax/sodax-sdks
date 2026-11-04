import { describe, expect, it, vi } from 'vitest';
import { MAX_NOT_FOUND_POLLS, STATUS_POLL_MS } from '../shared/notFoundStreak.js';

/**
 * Pins the WIRING the pure-policy test cannot see: the hook must pass the read into the policy and
 * advance the budget once per query update. Feeding the policy the wrong argument reproduces a
 * poll that never stops, with the policy's own tests still green.
 *
 * No renderer, per the package convention (see `_apiKeyWire.test.ts`): the React Query wrapper is
 * mocked so the captured options bag can be driven directly.
 */

// The captured options bag is opaque, like the real wrapper's.
let captured: any;

const refSlots: Array<{ current: unknown }> = [];
let refCursor = 0;

// Only useRef is needed, and call order is stable, so this replays React's slot semantics well
// enough to observe the budget across refetchInterval calls — the same shape
// `shared/useRequestTrustline.test.ts` uses.
vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const slot = refSlots[refCursor] ?? { current: initial };
    refSlots[refCursor] = slot;
    refCursor += 1;
    return slot;
  },
}));

const getDetailedStatus = vi.fn();
vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { bridge: { getDetailedStatus } } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useBridgeDetailedStatus } = await import('./useBridgeDetailedStatus.js');

const SRC_CHAIN = '0xa4b1.arbitrum';
const SRC_TX = '0xaaa';
const render = (apiConfig?: { apiKey: string }) => {
  refCursor = 0;
  return useBridgeDetailedStatus({ params: { srcChainKey: SRC_CHAIN, srcTxHash: SRC_TX, apiConfig } });
};

const notDeliveredRead = {
  ok: false,
  error: { code: 'LOOKUP_FAILED', context: { reason: 'relay_not_delivered' } },
};

describe('useBridgeDetailedStatus wiring', () => {
  it('keys the query on the source tx and runs only when both identifiers are present', () => {
    render();
    expect(captured.queryKey).toEqual(['bridge', 'detailedStatus', SRC_CHAIN, SRC_TX]);
    expect(captured.enabled).toBe(true);

    refCursor = 0;
    useBridgeDetailedStatus({ params: { srcChainKey: SRC_CHAIN, srcTxHash: undefined } });
    expect(captured.enabled).toBe(false);
  });

  it('threads a per-request override into the SDK call', async () => {
    render({ apiKey: 'per-action-key' });
    await captured.queryFn();
    expect(getDetailedStatus).toHaveBeenCalledWith(
      { srcChainKey: SRC_CHAIN, srcTxHash: SRC_TX },
      { apiKey: 'per-action-key' },
    );
  });

  it('feeds the read into the policy, so a terminal answer stops the poll', () => {
    render();
    const relayed = { ok: true, value: { source: 'relay', data: { dst_tx_hash: '0xdst' } } };
    expect(captured.refetchInterval({ state: { data: relayed, dataUpdateCount: 1 } })).toBe(false);
  });

  it('advances the not-delivered budget once per update, and stops when it is spent', () => {
    refSlots.length = 0;
    render();
    // Same dataUpdateCount twice must not double-count, so the cap is reached on update 40, not 20.
    for (let update = 1; update <= MAX_NOT_FOUND_POLLS - 1; update++) {
      captured.refetchInterval({ state: { data: notDeliveredRead, dataUpdateCount: update } });
      captured.refetchInterval({ state: { data: notDeliveredRead, dataUpdateCount: update } });
    }
    expect(captured.refetchInterval({ state: { data: notDeliveredRead, dataUpdateCount: 39 } })).toBe(STATUS_POLL_MS);
    expect(captured.refetchInterval({ state: { data: notDeliveredRead, dataUpdateCount: 40 } })).toBe(false);
  });
});
