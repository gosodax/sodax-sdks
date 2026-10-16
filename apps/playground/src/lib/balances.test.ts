import { ChainKeys, type ChainKey } from '@sodax/dapp-kit';
import { describe, expect, it } from 'vitest';
import { type BalanceMap, groupBalance, groupBalanceText, tokenBalance, tokenBalanceText } from './balances';
import type { TokenChoice } from './chains';

const HUB = '0x0000000000000000000000000000000000000000';

function choice(chain: ChainKey, address: string, decimals: number): TokenChoice {
  return {
    chain,
    token: { symbol: 'USDC', name: 'USD Coin', decimals, address, chainKey: chain, hubAsset: HUB, vault: HUB },
  };
}

const SONIC = choice(ChainKeys.SONIC_MAINNET, '0xsonic', 6);
const BASE = choice(ChainKeys.BASE_MAINNET, '0xbase', 6);
const SOLANA = choice(ChainKeys.SOLANA_MAINNET, 'SoLaNa', 18);

const BALANCES: BalanceMap = {
  [ChainKeys.SONIC_MAINNET]: { '0xsonic': 1_500_000n },
  [ChainKeys.BASE_MAINNET]: { '0xbase': 2_250_000n },
  [ChainKeys.SOLANA_MAINNET]: { SoLaNa: 3_000_000_000_000_000_000n },
};

describe('tokenBalance', () => {
  it('reads the amount held on the choice’s own chain', () => {
    expect(tokenBalance(BALANCES, SONIC)).toBe(1_500_000n);
  });

  // Every EVM chain shares 0x0 for its native token, so a chain-blind lookup would report one
  // chain's holding on all of them.
  it('is zero for a chain the map has nothing for', () => {
    expect(tokenBalance(BALANCES, choice(ChainKeys.ARBITRUM_MAINNET, '0xsonic', 6))).toBe(0n);
  });

  it('is zero for a token the chain’s map does not carry', () => {
    expect(tokenBalance(BALANCES, choice(ChainKeys.SONIC_MAINNET, '0xother', 6))).toBe(0n);
  });
});

describe('groupBalance', () => {
  it('adds equal-decimal chains at their shared scale', () => {
    expect(groupBalance(BALANCES, [SONIC, BASE])).toEqual({ amount: 3_750_000n, decimals: 6 });
  });

  // The same symbol is six decimals on one chain and eighteen on another; adding the raw amounts
  // would report a Solana holding as a trillion times an EVM one.
  it('scales mixed decimals to the widest in the group', () => {
    const { amount, decimals } = groupBalance(BALANCES, [SONIC, SOLANA]);

    expect(decimals).toBe(18);
    expect(amount).toBe(4_500_000_000_000_000_000n);
  });

  it('is zero when the wallet holds none of the asset', () => {
    expect(groupBalance({}, [SONIC, SOLANA]).amount).toBe(0n);
  });
});

describe('groupBalanceText', () => {
  it('states the total across networks', () => {
    expect(groupBalanceText(BALANCES, [SONIC, BASE])).toBe('3.75');
  });

  it('caps at the tile’s four decimals', () => {
    expect(groupBalanceText({ [ChainKeys.SONIC_MAINNET]: { '0xsonic': 1_533_777_845n } }, [SONIC])).toBe('1533.7778');
  });

  // Nothing held and nothing known are the same to the picker: neither draws a number.
  it('is undefined on a zero balance', () => {
    expect(groupBalanceText({}, [SONIC])).toBeUndefined();
  });
});

describe('tokenBalanceText', () => {
  it('states one chain’s holding', () => {
    expect(tokenBalanceText(BALANCES, SOLANA)).toBe('3');
  });

  it('is undefined where the asset is not held', () => {
    expect(tokenBalanceText(BALANCES, choice(ChainKeys.ARBITRUM_MAINNET, '0xarb', 6))).toBeUndefined();
  });
});
