/**
 * Compile-time contract: `useStakeAllowance` reads a `boolean` on every chain; its stake payload narrows
 * to the chain `K` is inferred from (or locked to), and with no type argument it spans every chain.
 */
import type { ChainKeys, SpokeChainKey, StakeParams } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import { useStakeAllowance } from './useStakeAllowance.js';

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
  NonNullable<Parameters<typeof useStakeAllowance<K>>[0]>['params']
>['payload'];

// Never invoked: the calls exist only for their inferred types; `K` comes from the payload.
const calls = () => ({
  bsc: (payload: Omit<StakeParams<BSC>, 'action'>) => useStakeAllowance({ params: { payload } }),
  icon: (payload: Omit<StakeParams<ICON>, 'action'>) => useStakeAllowance({ params: { payload } }),
  none: () => useStakeAllowance(),
});

describe('useStakeAllowance', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useStakeAllowance<BSC>>[0]>().toEqualTypeOf<
      | {
          params?: { payload: Omit<StakeParams<BSC>, 'action'> | undefined };
          queryOptions?: ReadQueryOptions<boolean, Error>;
        }
      | undefined
    >();
  });

  it('returns a boolean query whatever the chain', () => {
    expectTypeOf<ReturnType<typeof useStakeAllowance>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    type Calls = ReturnType<typeof calls>;
    expectTypeOf<ReturnType<Calls['bsc']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['icon']>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<Calls['none']>['data']>().toEqualTypeOf<boolean | undefined>();
  });

  it('narrows the payload to the chain', () => {
    expectTypeOf<Payload<SpokeChainKey>>().toEqualTypeOf<Omit<StakeParams<SpokeChainKey>, 'action'> | undefined>();
    expectTypeOf<Payload<BSC>>().toEqualTypeOf<Omit<StakeParams<BSC>, 'action'> | undefined>();
    expectTypeOf<Payload<SONIC>>().toEqualTypeOf<Omit<StakeParams<SONIC>, 'action'> | undefined>();
    expectTypeOf<Payload<ICON>>().toEqualTypeOf<Omit<StakeParams<ICON>, 'action'> | undefined>();
    expectTypeOf<Payload<SUI>>().toEqualTypeOf<Omit<StakeParams<SUI>, 'action'> | undefined>();
    expectTypeOf<Payload<SOLANA>>().toEqualTypeOf<Omit<StakeParams<SOLANA>, 'action'> | undefined>();
    expectTypeOf<Payload<STELLAR>>().toEqualTypeOf<Omit<StakeParams<STELLAR>, 'action'> | undefined>();
    expectTypeOf<Payload<INJECTIVE>>().toEqualTypeOf<Omit<StakeParams<INJECTIVE>, 'action'> | undefined>();
    expectTypeOf<Payload<NEAR>>().toEqualTypeOf<Omit<StakeParams<NEAR>, 'action'> | undefined>();
    expectTypeOf<Payload<STACKS>>().toEqualTypeOf<Omit<StakeParams<STACKS>, 'action'> | undefined>();
    expectTypeOf<Payload<BITCOIN>>().toEqualTypeOf<Omit<StakeParams<BITCOIN>, 'action'> | undefined>();
  });

  it('rejects a malformed payload', () => {
    const invalid = (payload: StakeParams<ICON>) =>
      // @ts-expect-error — the hook owns `action`, so the payload must not carry it
      useStakeAllowance({ params: { payload: { ...payload, action: payload.action } } });
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
