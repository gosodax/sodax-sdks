import { describe, expect, it, vi } from 'vitest';
import type { Result, Sodax, XToken } from '@sodax/sdk';
import { getBalancesQueryOptions } from './useBalances.js';

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

const makeSodax = (result: Result<Record<string, bigint>>) =>
  ({
    spoke: {
      getWalletBalances: vi.fn().mockResolvedValue(result),
    },
  }) as unknown as Sodax; // Minimal stub: only the `spoke.getWalletBalances` path the hook uses.

describe('getBalancesQueryOptions', () => {
  const tokenA = makeToken('AAA', '0xaaa');
  const tokenB = makeToken('BBB', '0xbbb');

  it('builds a queryKey pairing each token symbol with its address', () => {
    const opts = getBalancesQueryOptions(makeSodax({ ok: true, value: {} }), {
      chainKey: 'sonic',
      tokens: [tokenA, tokenB],
      address: '0xuser',
    });

    expect(opts.queryKey).toEqual([
      'shared',
      'balances',
      'sonic',
      [
        ['AAA', '0xaaa'],
        ['BBB', '0xbbb'],
      ],
      '0xuser',
    ]);
  });

  it('is disabled when chainKey is missing', () => {
    const opts = getBalancesQueryOptions(makeSodax({ ok: true, value: {} }), {
      chainKey: undefined,
      tokens: [tokenA],
      address: '0xuser',
    });
    expect(opts.enabled).toBe(false);
  });

  it('is disabled when address is missing', () => {
    const opts = getBalancesQueryOptions(makeSodax({ ok: true, value: {} }), {
      chainKey: 'sonic',
      tokens: [tokenA],
      address: undefined,
    });
    expect(opts.enabled).toBe(false);
  });

  it('is disabled when tokens is empty', () => {
    const opts = getBalancesQueryOptions(makeSodax({ ok: true, value: {} }), {
      chainKey: 'sonic',
      tokens: [],
      address: '0xuser',
    });
    expect(opts.enabled).toBe(false);
  });

  it('is enabled when all inputs are present', () => {
    const opts = getBalancesQueryOptions(makeSodax({ ok: true, value: {} }), {
      chainKey: 'sonic',
      tokens: [tokenA],
      address: '0xuser',
    });
    expect(opts.enabled).toBe(true);
  });

  it('queryFn delegates to sodax.spoke.getWalletBalances and unwraps the Result value', async () => {
    const expected = { '0xaaa': 42n, '0xbbb': 0n };
    const sodax = makeSodax({ ok: true, value: expected });

    const opts = getBalancesQueryOptions(sodax, { chainKey: 'sonic', tokens: [tokenA, tokenB], address: '0xuser' });

    const result = await opts.queryFn();
    expect(result).toEqual(expected);
    expect(sodax.spoke.getWalletBalances).toHaveBeenCalledWith({
      srcChainKey: 'sonic',
      srcAddress: '0xuser',
      tokens: [tokenA, tokenB],
    });
  });

  it('queryFn throws when the SDK returns an unsuccessful Result', async () => {
    const boom = new Error('rpc down');
    const opts = getBalancesQueryOptions(makeSodax({ ok: false, error: boom }), {
      chainKey: 'sonic',
      tokens: [tokenA],
      address: '0xuser',
    });

    await expect(opts.queryFn()).rejects.toThrow('rpc down');
  });

  it('queryFn returns {} when chainKey/address are missing (defensive, enabled should prevent this)', async () => {
    const opts = getBalancesQueryOptions(makeSodax({ ok: true, value: {} }), {
      chainKey: undefined,
      tokens: [tokenA],
      address: undefined,
    });

    const result = await opts.queryFn();
    expect(result).toEqual({});
  });
});
