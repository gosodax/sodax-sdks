import { afterEach, describe, expect, it, vi } from 'vitest';

const { construct } = vi.hoisted(() => ({ construct: vi.fn() }));
vi.mock('@tonconnect/ui', () => ({
  TonConnectUI: class {
    constructor(options: unknown) {
      construct(options);
    }
  },
}));

afterEach(() => {
  vi.resetModules();
  construct.mockReset();
});

describe('TonXService lazy initialization', () => {
  it('constructs once for concurrent callers and returns the same instance', async () => {
    const { TonXService } = await import('./TonXService.js');
    const service = TonXService.getInstance({ manifestUrl: 'https://example.com/tonconnect-manifest.json' });
    await import('@tonconnect/ui');
    const [a, b] = await Promise.all([service.tonConnect(), service.tonConnect()]);
    expect(construct).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('allows a failed initialization to be retried', async () => {
    const { TonXService } = await import('./TonXService.js');
    const service = TonXService.getInstance({ manifestUrl: 'https://example.com/tonconnect-manifest.json' });
    construct.mockImplementationOnce(() => {
      throw new Error('init failed');
    });
    await expect(service.tonConnect()).rejects.toThrow('init failed');
    await expect(service.tonConnect()).resolves.toBeDefined();
    expect(construct).toHaveBeenCalledTimes(2);
  });
});
