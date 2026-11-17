/**
 * Compile-time contract: `useMMAllowance` reads a `boolean` on every chain; its money market action payload narrows
 * to the chain `K` is inferred from (or locked to), and with no type argument it spans every chain.
 */
import type { ChainKeys, MoneyMarketParams, MoneyMarketSupplyParams, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import { useMMAllowance } from './useMMAllowance.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

type Payload<K extends SpokeChainKey> = NonNullable<
  NonNullable<Parameters<typeof useMMAllowance<K>>[0]>['params']
>['payload'];

// Never invoked: the calls exist only for their inferred types; `K` comes from the payload.
const calls = () => ({
  bsc: (payload: MoneyMarketParams<BSC>) => useMMAllowance({ params: { payload } }),
  icon: (payload: MoneyMarketParams<ICON>) => useMMAllowance({ params: { payload } }),
  none: () => useMMAllowance(),
});

describe('useMMAllowance', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useMMAllowance<BSC>>[0]>().toEqualTypeOf<
      | { params?: { payload: MoneyMarketParams<BSC> | undefined }; queryOptions?: ReadQueryOptions<boolean, Error> }
      | undefined
    >();
  });

  it('returns a boolean query whatever the chain', () => {
    expectTypeOf<ReturnType<typeof useMMAllowance>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    type Calls = ReturnType<typeof calls>;
    expectTypeOf<ReturnType<Calls['bsc']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['icon']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['none']>['data']>().toEqualTypeOf<boolean | undefined>();
  });

  it('narrows the payload to the chain', () => {
    expectTypeOf<Payload<SpokeChainKey>>().toEqualTypeOf<MoneyMarketParams<SpokeChainKey> | undefined>();
    expectTypeOf<Payload<BSC>>().toEqualTypeOf<MoneyMarketParams<BSC> | undefined>();
    expectTypeOf<Payload<SONIC>>().toEqualTypeOf<MoneyMarketParams<SONIC> | undefined>();
    expectTypeOf<Payload<ICON>>().toEqualTypeOf<MoneyMarketParams<ICON> | undefined>();
    expectTypeOf<Payload<SUI>>().toEqualTypeOf<MoneyMarketParams<SUI> | undefined>();
    expectTypeOf<Payload<SOLANA>>().toEqualTypeOf<MoneyMarketParams<SOLANA> | undefined>();
    expectTypeOf<Payload<STELLAR>>().toEqualTypeOf<MoneyMarketParams<STELLAR> | undefined>();
    expectTypeOf<Payload<INJECTIVE>>().toEqualTypeOf<MoneyMarketParams<INJECTIVE> | undefined>();
    expectTypeOf<Payload<NEAR>>().toEqualTypeOf<MoneyMarketParams<NEAR> | undefined>();
    expectTypeOf<Payload<STACKS>>().toEqualTypeOf<MoneyMarketParams<STACKS> | undefined>();
    expectTypeOf<Payload<BITCOIN>>().toEqualTypeOf<MoneyMarketParams<BITCOIN> | undefined>();
  });

  it('rejects a malformed payload', () => {
    const invalid = (payload: Omit<MoneyMarketSupplyParams<ICON>, 'action'>) =>
      // @ts-expect-error — a payload without its `action` is not a money market action
      useMMAllowance({ params: { payload } });
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
