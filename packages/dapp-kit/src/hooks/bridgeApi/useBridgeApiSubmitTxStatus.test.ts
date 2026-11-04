import { SodaxError } from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { retryUnlessAuthFailure } from '../shared/retryUnlessAuthFailure.js';

/**
 * Pins the WIRING of the auth stop, which `getBridgeSubmitTxStatusRefetchInterval.test.ts` cannot
 * see: the policy is only reached if the hook hands it `query.state.error`. Passing the wrong
 * argument (or none) reproduces the original defect — a rejected key re-requested every second —
 * with the policy's own unit tests still green.
 *
 * No renderer, per the package convention (see `_apiKeyWire.test.ts`): the React Query wrapper is
 * mocked so the captured options bag can be driven directly.
 */

// The captured options bag is opaque, like the real wrapper's.
let captured: any;

vi.mock('../shared/useSodaxContext.js', () => ({ useSodaxContext: () => ({ sodax: {} }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useBridgeApiSubmitTxStatus } = await import('./useBridgeApiSubmitTxStatus.js');

const authError = new SodaxError('EXTERNAL_API_ERROR', 'responded with 401', {
  feature: 'backend',
  context: { api: 'bridge', endpoint: '/bridge/submit-tx/status', status: 401 },
});

const render = () => useBridgeApiSubmitTxStatus({ params: { txHash: '0xabc', srcChainKey: '0xa4b1.arbitrum' } });

describe('useBridgeApiSubmitTxStatus wiring', () => {
  it('delegates its retry policy instead of hard-coding a count', () => {
    render();
    expect(captured.retry).toBe(retryUnlessAuthFailure);
  });

  it('feeds the query error into the interval policy, so a rejected key stops the poll', () => {
    render();
    expect(captured.refetchInterval({ state: { error: authError, data: undefined } })).toBe(false);
  });

  it('still polls a live record', () => {
    render();
    expect(
      captured.refetchInterval({
        state: { error: null, data: { success: true, data: { status: 'relaying' } } },
      }),
    ).toBe(1000);
  });

  it('feeds the record into the policy, so a terminal status stops the poll', () => {
    render();
    expect(
      captured.refetchInterval({
        state: { error: null, data: { success: true, data: { status: 'executed' } } },
      }),
    ).toBe(false);
  });
});
