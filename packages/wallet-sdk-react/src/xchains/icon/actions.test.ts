/**
 * reconnectIcon must reject on failure (so the caller's diagnostics handler runs) and
 * must use the short hydration timeout so it cannot hold the ICONEX queue for 300s.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const setXConnection = vi.fn();
vi.mock('@/useXWalletStore.js', () => ({
  useXWalletStore: {
    getState: () => ({
      xConnections: { ICON: { xConnectorId: 'hana' } },
      setXConnection,
    }),
  },
}));

import { reconnectIcon } from './actions.js';
import { ICONexResponseEventType } from './iconex/index.js';

const VALID_ICON_ADDRESS = 'hx0000000000000000000000000000000000000001';

describe('reconnectIcon', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects after the 30s hydration timeout instead of swallowing the error', async () => {
    vi.useFakeTimers();
    const pending = reconnectIcon();
    const rejection = expect(pending).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(setXConnection).not.toHaveBeenCalled();
  });

  it('sets the persisted connection on a valid address response', async () => {
    const pending = reconnectIcon();
    await new Promise(resolve => setTimeout(resolve, 0)); // let the queue dispatch the request
    window.dispatchEvent(
      new CustomEvent('ICONEX_RELAY_RESPONSE', {
        detail: { type: ICONexResponseEventType.RESPONSE_ADDRESS, payload: VALID_ICON_ADDRESS },
      }),
    );

    await pending;
    expect(setXConnection).toHaveBeenCalledWith(
      'ICON',
      expect.objectContaining({ xConnectorId: 'hana', xAccount: { address: VALID_ICON_ADDRESS, xChainType: 'ICON' } }),
    );
  });
});
