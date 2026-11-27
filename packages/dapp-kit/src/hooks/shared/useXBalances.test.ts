import { describe, expect, it, vi } from 'vitest';
import type { IXServiceBase, XToken } from '@sodax/sdk';
import { getXBalancesQueryOptions } from './useXBalances.js';

const makeToken = (symbol: string, address: string): XToken =>
  ({
    symbol,
    name: symbol,
    decimals: 18,
    address,
    chainKey: 'sonic',
    hubAsset: '0x0000000000000000000000000000000000000000',
    vault: '0x0000000000000000000000000000000000000000',
  }) as XToken;

const makeXService = (balances: Record<string, bigint>): IXServiceBase => ({
  xChainType: 'EVM',
  getBalance: vi.fn(),
  getBalances: vi.fn().mockResolvedValue(balances),
});

describe('getXBalancesQueryOptions', () => {
  const tokenA = makeToken('AAA', '0xaaa');
  const tokenB = makeToken('BBB', '0xbbb');

  it('builds a queryKey pairing each token symbol with its address', () => {
    const opts = getXBalancesQueryOptions({
      xService: makeXService({}),
      xChainId: 'sonic',
      xTokens: [tokenA, tokenB],
      address: '0xuser',
    });

    expect(opts.queryKey).toEqual([
      'shared',
      'xBalances',
      'sonic',
      [
        ['AAA', '0xaaa'],
        ['BBB', '0xbbb'],
      ],
      '0xuser',
    ]);
  });

  it('is enabled only when xService, address, and xTokens are all present', () => {
    const inputs = { xService: makeXService({}), xChainId: 'sonic' as const, xTokens: [tokenA], address: '0xuser' };
    expect(getXBalancesQueryOptions(inputs).enabled).toBe(true);
    expect(getXBalancesQueryOptions({ ...inputs, xService: undefined }).enabled).toBe(false);
    expect(getXBalancesQueryOptions({ ...inputs, address: undefined }).enabled).toBe(false);
    expect(getXBalancesQueryOptions({ ...inputs, xTokens: [] }).enabled).toBe(false);
  });

  it('queryFn delegates to xService.getBalances with address and tokens', async () => {
    const expected = { '0xaaa': 42n };
    const xService = makeXService(expected);

    const opts = getXBalancesQueryOptions({
      xService,
      xChainId: 'sonic',
      xTokens: [tokenA],
      address: '0xuser',
    });

    const result = await opts.queryFn();
    expect(result).toEqual(expected);
    expect(xService.getBalances).toHaveBeenCalledWith('0xuser', [tokenA]);
  });

  it('queryFn returns {} when xService is undefined (defensive, enabled should prevent this)', async () => {
    const opts = getXBalancesQueryOptions({
      xService: undefined,
      xChainId: 'sonic',
      xTokens: [tokenA],
      address: '0xuser',
    });

    const result = await opts.queryFn();
    expect(result).toEqual({});
  });
});
