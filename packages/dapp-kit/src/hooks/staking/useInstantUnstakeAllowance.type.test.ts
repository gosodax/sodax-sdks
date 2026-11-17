/**
 * Compile-time contract: `useInstantUnstakeAllowance` reads a `boolean` on every chain; its instant unstake payload narrows
 * to the chain `K` is inferred from (or locked to), and with no type argument it spans every chain.
 */
import type { ChainKeys, InstantUnstakeParams, SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import { useInstantUnstakeAllowance } from './useInstantUnstakeAllowance.js';

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
  NonNullable<Parameters<typeof useInstantUnstakeAllowance<K>>[0]>['params']
>['payload'];

// Never invoked: the calls exist only for their inferred types; `K` comes from the payload.
const calls = () => ({
  bsc: (payload: Omit<InstantUnstakeParams<BSC>, 'action'>) => useInstantUnstakeAllowance({ params: { payload } }),
  icon: (payload: Omit<InstantUnstakeParams<ICON>, 'action'>) => useInstantUnstakeAllowance({ params: { payload } }),
  none: () => useInstantUnstakeAllowance(),
});

describe('useInstantUnstakeAllowance', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useInstantUnstakeAllowance<BSC>>[0]>().toEqualTypeOf<
      | {
          params?: { payload: Omit<InstantUnstakeParams<BSC>, 'action'> | undefined };
          queryOptions?: ReadQueryOptions<boolean, Error>;
        }
      | undefined
    >();
  });

  it('returns a boolean query whatever the chain', () => {
    expectTypeOf<ReturnType<typeof useInstantUnstakeAllowance>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    type Calls = ReturnType<typeof calls>;
    expectTypeOf<ReturnType<Calls['bsc']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['icon']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['none']>['data']>().toEqualTypeOf<boolean | undefined>();
  });

  it('narrows the payload to the chain', () => {
    expectTypeOf<Payload<SpokeChainKey>>().toEqualTypeOf<
      Omit<InstantUnstakeParams<SpokeChainKey>, 'action'> | undefined
    >();
    expectTypeOf<Payload<BSC>>().toEqualTypeOf<Omit<InstantUnstakeParams<BSC>, 'action'> | undefined>();
    expectTypeOf<Payload<SONIC>>().toEqualTypeOf<Omit<InstantUnstakeParams<SONIC>, 'action'> | undefined>();
    expectTypeOf<Payload<ICON>>().toEqualTypeOf<Omit<InstantUnstakeParams<ICON>, 'action'> | undefined>();
    expectTypeOf<Payload<SUI>>().toEqualTypeOf<Omit<InstantUnstakeParams<SUI>, 'action'> | undefined>();
    expectTypeOf<Payload<SOLANA>>().toEqualTypeOf<Omit<InstantUnstakeParams<SOLANA>, 'action'> | undefined>();
    expectTypeOf<Payload<STELLAR>>().toEqualTypeOf<Omit<InstantUnstakeParams<STELLAR>, 'action'> | undefined>();
    expectTypeOf<Payload<INJECTIVE>>().toEqualTypeOf<Omit<InstantUnstakeParams<INJECTIVE>, 'action'> | undefined>();
    expectTypeOf<Payload<NEAR>>().toEqualTypeOf<Omit<InstantUnstakeParams<NEAR>, 'action'> | undefined>();
    expectTypeOf<Payload<STACKS>>().toEqualTypeOf<Omit<InstantUnstakeParams<STACKS>, 'action'> | undefined>();
    expectTypeOf<Payload<BITCOIN>>().toEqualTypeOf<Omit<InstantUnstakeParams<BITCOIN>, 'action'> | undefined>();
  });

  it('rejects a malformed payload', () => {
    const invalid = (payload: InstantUnstakeParams<ICON>) =>
      // @ts-expect-error — the hook owns `action`, so the payload must not carry it
      useInstantUnstakeAllowance({ params: { payload: { ...payload, action: payload.action } } });
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
