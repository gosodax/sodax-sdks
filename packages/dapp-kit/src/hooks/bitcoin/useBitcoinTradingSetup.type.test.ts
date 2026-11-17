/**
 * Compile-time contract: `useBitcoinTradingSetup` takes one side's chain, wallet and address and
 * returns the Bitcoin wallet and trading balance, both `undefined` off Bitcoin.
 */
import type { IBitcoinWalletProvider, IWalletProvider, RadfiWalletBalance, SpokeChainKey } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinTradingSetup,
  UseBitcoinTradingSetupParams,
  useBitcoinTradingSetup,
} from './useBitcoinTradingSetup.js';

type Params = { chainKey: SpokeChainKey; walletProvider: IWalletProvider | undefined; address: string | undefined };
type Setup = { wallet: IBitcoinWalletProvider | undefined; tradingBalance: RadfiWalletBalance | undefined };

describe('useBitcoinTradingSetup', () => {
  it('accepts any spoke chain and wallet provider', () => {
    expectTypeOf<UseBitcoinTradingSetupParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useBitcoinTradingSetup>>().toEqualTypeOf<[params: Params]>();
  });

  it('returns the Bitcoin setup, whatever the chain', () => {
    expectTypeOf<BitcoinTradingSetup>().toEqualTypeOf<Setup>();
    expectTypeOf<ReturnType<typeof useBitcoinTradingSetup>>().toEqualTypeOf<Setup>();
  });
});
