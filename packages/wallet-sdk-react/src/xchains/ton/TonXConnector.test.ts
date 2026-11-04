import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// TonConnectUI touches the DOM, so the module is mocked; the service creates it lazily on first use.
const PUBLIC_KEY = 'CD'.repeat(32);
const RAW_ADDRESS = `0:${'33'.repeat(32)}`;

let account: { address: string; publicKey?: string } | null;
let statusListener: ((wallet: unknown) => void) | undefined;
const ui = {
  get account() {
    return account;
  },
  connectionRestored: Promise.resolve(false),
  openModal: vi.fn(async () => {
    account = { address: RAW_ADDRESS, publicKey: PUBLIC_KEY };
    statusListener?.({ account });
  }),
  onStatusChange: vi.fn((cb: (wallet: unknown) => void) => {
    statusListener = cb;
    return () => {
      statusListener = undefined;
    };
  }),
  disconnect: vi.fn(async () => undefined),
  sendTransaction: vi.fn(async () => ({ boc: 'x' })),
  signData: vi.fn(async () => ({ signature: 'AA==', address: RAW_ADDRESS, timestamp: 1, domain: 'app.sodax.com' })),
};
// biome-ignore lint/complexity/useArrowFunction: the service calls this mock with `new`, which vitest 4 only allows for a `function`.
const TonConnectUI = vi.fn(function () {
  return ui;
});
vi.mock('@tonconnect/ui', () => ({ TonConnectUI }));

const { TonXService } = await import('./TonXService.js');
const { TonXConnector } = await import('./TonXConnector.js');

beforeEach(() => {
  account = null;
  vi.stubGlobal('window', {});
  TonXService.getInstance({ manifestUrl: 'https://app.sodax.com/tonconnect-manifest.json' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TonXConnector — identity', () => {
  it('registers as the TonConnect connector for the TON chain type', () => {
    const c = new TonXConnector();

    expect(c.xChainType).toBe('TON');
    expect(c.name).toBe('TonConnect');
    expect(c.icon).toMatch(/^data:image\/svg\+xml,/);
  });

  it('is always installable, since TonConnect lists every wallet including mobile ones', () => {
    expect(new TonXConnector().isInstalled).toBe(true);
  });
});

describe('TonXConnector.connect', () => {
  it('opens the TonConnect modal and reports the wallet public key as the account address', async () => {
    const result = await new TonXConnector().connect();

    expect(TonConnectUI).toHaveBeenCalledWith({ manifestUrl: 'https://app.sodax.com/tonconnect-manifest.json' });
    expect(ui.openModal).toHaveBeenCalled();
    // The relay identifies a TON user by public key, so that is the address the SDK receives.
    expect(result).toEqual({ address: `0x${PUBLIC_KEY.toLowerCase()}`, xChainType: 'TON' });
  });

  it('reuses a restored session without opening the modal again', async () => {
    account = { address: RAW_ADDRESS, publicKey: PUBLIC_KEY };

    await new TonXConnector().connect();

    expect(ui.openModal).not.toHaveBeenCalled();
  });

  it('refuses a wallet that does not expose its public key', async () => {
    ui.openModal.mockImplementationOnce(async () => {
      account = { address: RAW_ADDRESS };
      statusListener?.({ account });
    });

    await expect(new TonXConnector().connect()).rejects.toThrow(/did not expose its public key/);
  });
});

describe('TonXConnector.getTonConnect', () => {
  it('hands the wallet provider an adapter that reaches TonConnect lazily', async () => {
    account = { address: RAW_ADDRESS, publicKey: PUBLIC_KEY };
    const adapter = new TonXConnector().getTonConnect();
    const tx = { validUntil: 1, messages: [{ address: 'EQ', amount: '1', payload: 'x' }] };

    await adapter.sendTransaction(tx);
    await adapter.signData({ type: 'text', text: 'hello' });

    expect(ui.sendTransaction).toHaveBeenCalledWith(tx);
    expect(ui.signData).toHaveBeenCalledWith({ type: 'text', text: 'hello' });
    expect(adapter.account).toEqual({ address: RAW_ADDRESS, publicKey: PUBLIC_KEY });
  });
});

describe('TonXService', () => {
  it('asks for a manifest URL rather than failing inside TonConnect', async () => {
    const service = TonXService.getInstance();
    const manifestUrl = service.manifestUrl;
    service.manifestUrl = undefined;
    // A fresh service instance has no UI yet; reset the cached one for this check.
    (service as unknown as { ui?: unknown }).ui = undefined;

    await expect(service.tonConnect()).rejects.toThrow(/manifestUrl/);
    service.manifestUrl = manifestUrl;
  });
});
