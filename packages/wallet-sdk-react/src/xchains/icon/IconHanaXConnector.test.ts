/**
 * IconHanaXConnector address validation (WALLET-L-1).
 *
 * connect() must only accept a RESPONSE_ADDRESS whose payload is a valid ICON
 * address; a forged/malformed payload must be rejected (returns undefined),
 * never stored as the connected account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconHanaXConnector } from './IconHanaXConnector.js';
import { ICONexResponseEventType } from './iconex/index.js';

const ICONEX_RELAY_RESPONSE = 'ICONEX_RELAY_RESPONSE';
const VALID_ICON_ADDRESS = 'hx0000000000000000000000000000000000000001';

const setHanaWallet = (value: unknown): void => {
  // jsdom's Window has no `hanaWallet` — the injected-provider shape is only known at runtime.
  (window as unknown as Record<string, unknown>).hanaWallet = value;
};

const dispatchAddress = (payload: string): void => {
  window.dispatchEvent(
    new CustomEvent(ICONEX_RELAY_RESPONSE, {
      detail: { type: ICONexResponseEventType.RESPONSE_ADDRESS, payload },
    }),
  );
};

// Let connect()'s serialized request register its listener before we respond.
const flushQueue = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('IconHanaXConnector.connect', () => {
  beforeEach(() => setHanaWallet({ available: true }));
  afterEach(() => {
    setHanaWallet(undefined);
    vi.restoreAllMocks();
  });

  it('returns the account for a valid hx payload', async () => {
    const pending = new IconHanaXConnector().connect();
    await flushQueue();
    dispatchAddress(VALID_ICON_ADDRESS);

    await expect(pending).resolves.toEqual({ address: VALID_ICON_ADDRESS, xChainType: 'ICON' });
  });

  it('rejects a forged non-ICON payload and returns undefined', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pending = new IconHanaXConnector().connect();
    await flushQueue();
    dispatchAddress('evil.com');

    await expect(pending).resolves.toBeUndefined();
  });
});
