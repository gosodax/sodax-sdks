import { afterEach, describe, expect, it, vi } from 'vitest';
import { TonXConnector } from './TonXConnector.js';
import { TonXService } from './TonXService.js';

afterEach(() => vi.restoreAllMocks());

describe('TonXConnector connection lifecycle', () => {
  function setup() {
    let status: (wallet: unknown) => void = () => {};
    let modal: (state: { status: string; closeReason: string }) => void = () => {};
    const offStatus = vi.fn();
    const offModal = vi.fn();
    const ui = {
      account: null as { address: string; publicKey?: string } | null,
      connectionRestored: Promise.resolve(false),
      onStatusChange: vi.fn((cb: typeof status) => {
        status = cb;
        return offStatus;
      }),
      onModalStateChange: vi.fn((cb: typeof modal) => {
        modal = cb;
        return offModal;
      }),
      openModal: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
    vi.spyOn(TonXService.getInstance(), 'tonConnect').mockResolvedValue(ui as never);
    return {
      ui,
      status: () => status({ account: ui.account }),
      cancel: () => modal({ status: 'closed', closeReason: 'action-cancelled' }),
      offStatus,
      offModal,
    };
  }

  it('resolves cancellation and removes both listeners', async () => {
    const fake = setup();
    const pending = new TonXConnector().connect();
    await vi.waitFor(() => expect(fake.ui.openModal).toHaveBeenCalled());
    fake.cancel();
    expect(
      await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('hung'), 20))]),
    ).toBeUndefined();
    expect(fake.offStatus).toHaveBeenCalledTimes(1);
    expect(fake.offModal).toHaveBeenCalledTimes(1);
  });

  it('returns a successful account and removes both listeners', async () => {
    const fake = setup();
    const pending = new TonXConnector().connect();
    await vi.waitFor(() => expect(fake.ui.openModal).toHaveBeenCalled());
    fake.ui.account = { address: `0:${'12'.repeat(32)}`, publicKey: 'AB'.repeat(32) };
    fake.status();
    expect(await pending).toEqual({ address: `0x${'ab'.repeat(32)}`, xChainType: 'TON' });
    expect(fake.offStatus).toHaveBeenCalledTimes(1);
    expect(fake.offModal).toHaveBeenCalledTimes(1);
  });

  it('disconnects a wallet with no public key before throwing', async () => {
    const fake = setup();
    fake.ui.account = { address: `0:${'12'.repeat(32)}` };
    await expect(new TonXConnector().connect()).rejects.toThrow(/public key/);
    expect(fake.ui.disconnect).toHaveBeenCalledTimes(1);
  });
});
