/**
 * Compile-time contract: `useDexAllowance` reads a `boolean` on every chain; its DEX deposit payload narrows
 * to the chain `K` is inferred from (or locked to), and with no type argument it spans every chain.
 */
import type { ChainKeys, CreateAssetDepositParams, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import { useDexAllowance } from './useDexAllowance.js';

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
  NonNullable<Parameters<typeof useDexAllowance<K>>[0]>['params']
>['payload'];

// Never invoked: the calls exist only for their inferred types; `K` comes from the payload.
const calls = () => ({
  bsc: (payload: CreateAssetDepositParams<BSC>) => useDexAllowance({ params: { payload } }),
  icon: (payload: CreateAssetDepositParams<ICON>) => useDexAllowance({ params: { payload } }),
  none: () => useDexAllowance(),
});

describe('useDexAllowance', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useDexAllowance<BSC>>[0]>().toEqualTypeOf<
      | {
          params?: { payload: CreateAssetDepositParams<BSC> | undefined };
          queryOptions?: ReadQueryOptions<boolean, Error>;
        }
      | undefined
    >();
  });

  it('returns a boolean query whatever the chain', () => {
    expectTypeOf<ReturnType<typeof useDexAllowance>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    type Calls = ReturnType<typeof calls>;
    expectTypeOf<ReturnType<Calls['bsc']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['icon']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['none']>['data']>().toEqualTypeOf<boolean | undefined>();
  });

  it('narrows the payload to the chain', () => {
    expectTypeOf<Payload<SpokeChainKey>>().toEqualTypeOf<CreateAssetDepositParams<SpokeChainKey> | undefined>();
    expectTypeOf<Payload<BSC>>().toEqualTypeOf<CreateAssetDepositParams<BSC> | undefined>();
    expectTypeOf<Payload<SONIC>>().toEqualTypeOf<CreateAssetDepositParams<SONIC> | undefined>();
    expectTypeOf<Payload<ICON>>().toEqualTypeOf<CreateAssetDepositParams<ICON> | undefined>();
    expectTypeOf<Payload<SUI>>().toEqualTypeOf<CreateAssetDepositParams<SUI> | undefined>();
    expectTypeOf<Payload<SOLANA>>().toEqualTypeOf<CreateAssetDepositParams<SOLANA> | undefined>();
    expectTypeOf<Payload<STELLAR>>().toEqualTypeOf<CreateAssetDepositParams<STELLAR> | undefined>();
    expectTypeOf<Payload<INJECTIVE>>().toEqualTypeOf<CreateAssetDepositParams<INJECTIVE> | undefined>();
    expectTypeOf<Payload<NEAR>>().toEqualTypeOf<CreateAssetDepositParams<NEAR> | undefined>();
    expectTypeOf<Payload<STACKS>>().toEqualTypeOf<CreateAssetDepositParams<STACKS> | undefined>();
    expectTypeOf<Payload<BITCOIN>>().toEqualTypeOf<CreateAssetDepositParams<BITCOIN> | undefined>();
  });

  it('rejects a malformed payload', () => {
    const invalid = (payload: Omit<CreateAssetDepositParams<ICON>, 'poolToken'>) =>
      // @ts-expect-error — a deposit payload needs its `poolToken`
      useDexAllowance({ params: { payload } });
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
