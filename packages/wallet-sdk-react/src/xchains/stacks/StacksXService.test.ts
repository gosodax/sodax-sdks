import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { XToken } from '@sodax/types';

// Mock libs/stacks/core — same pattern as StacksWalletProvider.test.ts.
// `networkFrom` returns a stub that the SUT reads `client.baseUrl` from.
const networkFrom = vi.fn((selector: unknown) => ({
  client: { baseUrl: selector === 'testnet' ? 'https://stacks.test.example' : 'https://stacks.example' },
}));
const fetchCallReadOnlyFunction = vi.fn();

vi.mock('@sodax/libs/stacks/core', () => ({
  networkFrom,
  fetchCallReadOnlyFunction,
  Cl: { principal: (s: string) => ({ type: 'principal', value: s }) },
}));

const { StacksXService } = await import('./StacksXService.js');

const STX_TOKEN: XToken = {
  symbol: 'STX',
  address: 'native',
  decimals: 6,
  chainKey: 'stacks',
  name: 'Stacks',
  identifier: 'STX@stacks',
} as unknown as XToken;

const SIP010_TOKEN: XToken = {
  symbol: 'BNUSD',
  address: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0.bnusd',
  decimals: 8,
  chainKey: 'stacks',
  name: 'bnUSD',
  identifier: 'BNUSD@stacks',
} as unknown as XToken;

const USER = 'SP1USERSTACKS';

// The XService singleton is module-level state — reset it between tests so the
// `getInstance()` identity / network-update behaviour isn't polluted by earlier
// runs. Vitest doesn't reset module state across `it` blocks by default.
function resetSingleton() {
  (StacksXService as unknown as { instance?: unknown }).instance = undefined;
}

afterEach(() => {
  resetSingleton();
  vi.unstubAllGlobals();
});

describe('StacksXService.getInstance — singleton + network update', () => {
  beforeEach(() => {
    resetSingleton();
    networkFrom.mockClear();
  });

  it("defaults to 'mainnet' and reuses the singleton on repeated calls without a selector", () => {
    const a = StacksXService.getInstance();
    const b = StacksXService.getInstance();
    expect(a).toBe(b);
    expect(networkFrom).toHaveBeenCalledTimes(1);
    expect(networkFrom).toHaveBeenCalledWith('mainnet');
  });

  it('mutates `instance.network` on a subsequent call with a different network selector', () => {
    const first = StacksXService.getInstance('mainnet');
    expect(first.network.client.baseUrl).toBe('https://stacks.example');

    const second = StacksXService.getInstance('testnet');
    // Same identity — singleton is reused.
    expect(second).toBe(first);
    // But the network was rebuilt and overwritten in place.
    expect(second.network.client.baseUrl).toBe('https://stacks.test.example');
  });
});

describe('StacksXService.getBalance — native STX path', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('returns 0n when address is undefined (short-circuit)', async () => {
    const service = StacksXService.getInstance();
    const result = await service.getBalance(undefined, STX_TOKEN);
    expect(result).toBe(0n);
  });

  it('GETs /extended/v1/address/<addr>/balances and returns BigInt(data.stx.balance)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ stx: { balance: '500000' } }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const service = StacksXService.getInstance();
    const result = await service.getBalance(USER, STX_TOKEN);

    expect(result).toBe(500_000n);
    expect(fetchSpy).toHaveBeenCalledWith(`https://stacks.example/extended/v1/address/${USER}/balances`);
  });

  it('swallows !response.ok and returns 0n (error is logged but not thrown)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error' }));

    const service = StacksXService.getInstance();
    const result = await service.getBalance(USER, STX_TOKEN);

    expect(result).toBe(0n);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('StacksXService.getBalance — SIP-010 path', () => {
  beforeEach(() => {
    resetSingleton();
    fetchCallReadOnlyFunction.mockReset();
  });

  it('parses the contract id, calls get-balance, and unwraps ResponseOk<UIntCV> via .value.value', async () => {
    // The SUT casts the result to `ResponseOkCV<UIntCV>` and reads `.value.value`.
    fetchCallReadOnlyFunction.mockResolvedValueOnce({ value: { type: 'uint', value: 99_999n } });

    const service = StacksXService.getInstance();
    const result = await service.getBalance(USER, SIP010_TOKEN);

    expect(result).toBe(99_999n);
    expect(fetchCallReadOnlyFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: 'SP3031RGK734636C8KGW2Y76TEQBTVX59Q472EQH0',
        contractName: 'bnusd',
        functionName: 'get-balance',
        functionArgs: [{ type: 'principal', value: USER }],
        senderAddress: USER,
      }),
    );
  });

  it('swallows a read-only contract-call rejection and returns 0n', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchCallReadOnlyFunction.mockRejectedValueOnce(new Error('rpc down'));

    const service = StacksXService.getInstance();
    const result = await service.getBalance(USER, SIP010_TOKEN);

    expect(result).toBe(0n);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
