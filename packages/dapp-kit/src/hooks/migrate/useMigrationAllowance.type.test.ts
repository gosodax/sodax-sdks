/**
 * Compile-time contract for `useMigrationAllowance`: accepts every migration params variant (ICX, ICX
 * revert, BALN, and bnUSD from any chain, its K inferred without a type argument) plus the action; the
 * query data is the same allowance flag for each.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  BalnMigrateParams,
  ChainKeys,
  IcxCreateRevertMigrationParams,
  IcxMigrateParams,
  MigrationAction,
  SpokeChainKey,
  UnifiedBnUSDMigrateParams,
} from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from '../shared/types.js';
import { useMigrationAllowance } from './useMigrationAllowance.js';

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

type Inputs<K extends SpokeChainKey> = {
  params:
    | IcxMigrateParams
    | IcxCreateRevertMigrationParams
    | UnifiedBnUSDMigrateParams<K>
    | BalnMigrateParams
    | undefined;
  action: MigrationAction | undefined;
};
type Expected = UseQueryResult<boolean, Error>;

declare const icx: IcxMigrateParams;
declare const revert: IcxCreateRevertMigrationParams;
declare const baln: BalnMigrateParams;
declare const bscBnUSD: UnifiedBnUSDMigrateParams<BSC>;
declare const sonicBnUSD: UnifiedBnUSDMigrateParams<SONIC>;
declare const iconBnUSD: UnifiedBnUSDMigrateParams<ICON>;
declare const suiBnUSD: UnifiedBnUSDMigrateParams<SUI>;
declare const solanaBnUSD: UnifiedBnUSDMigrateParams<SOLANA>;
declare const stellarBnUSD: UnifiedBnUSDMigrateParams<STELLAR>;
declare const injectiveBnUSD: UnifiedBnUSDMigrateParams<INJECTIVE>;
declare const nearBnUSD: UnifiedBnUSDMigrateParams<NEAR>;
declare const stacksBnUSD: UnifiedBnUSDMigrateParams<STACKS>;
declare const bitcoinBnUSD: UnifiedBnUSDMigrateParams<BITCOIN>;

// Never invoked: each call exists only for the K it infers from its params.
const calls = () => ({
  icx: useMigrationAllowance({ params: { params: icx, action: 'migrate' } }),
  revert: useMigrationAllowance({ params: { params: revert, action: 'revert' } }),
  baln: useMigrationAllowance({ params: { params: baln, action: 'migrate' } }),
  bsc: useMigrationAllowance({ params: { params: bscBnUSD, action: 'migrate' } }),
  sonic: useMigrationAllowance({ params: { params: sonicBnUSD, action: 'migrate' } }),
  icon: useMigrationAllowance({ params: { params: iconBnUSD, action: 'migrate' } }),
  sui: useMigrationAllowance({ params: { params: suiBnUSD, action: 'migrate' } }),
  solana: useMigrationAllowance({ params: { params: solanaBnUSD, action: 'migrate' } }),
  stellar: useMigrationAllowance({ params: { params: stellarBnUSD, action: 'migrate' } }),
  injective: useMigrationAllowance({ params: { params: injectiveBnUSD, action: 'migrate' } }),
  near: useMigrationAllowance({ params: { params: nearBnUSD, action: 'migrate' } }),
  stacks: useMigrationAllowance({ params: { params: stacksBnUSD, action: 'migrate' } }),
  bitcoin: useMigrationAllowance({ params: { params: bitcoinBnUSD, action: 'migrate' } }),
  disabled: useMigrationAllowance(),
});
type Calls = ReturnType<typeof calls>;

describe('useMigrationAllowance', () => {
  it('accepts every migration params variant, the bnUSD one keyed by K', () => {
    expectTypeOf<Parameters<typeof useMigrationAllowance<BSC>>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Inputs<BSC>> | undefined
    >();
    expectTypeOf<Parameters<typeof useMigrationAllowance>[0]>().toEqualTypeOf<
      ReadHookParams<boolean, Inputs<SpokeChainKey>> | undefined
    >();
  });

  it('returns the same allowance query for every variant and chain', () => {
    expectTypeOf<Calls['icx']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['revert']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['baln']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['bsc']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['sonic']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['icon']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['sui']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['solana']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['stellar']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['injective']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['near']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['stacks']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['bitcoin']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['disabled']>().toEqualTypeOf<Expected>();
    expectTypeOf<Calls['bsc']['data']>().toEqualTypeOf<boolean | undefined>();
  });

  it('rejects an unknown action', () => {
    const invalid = () =>
      // @ts-expect-error — the action is 'migrate' or 'revert'
      useMigrationAllowance({ params: { params: icx, action: 'approve' } });
    expectTypeOf(invalid).toBeFunction();
    expectTypeOf(calls).toBeFunction();
  });
});
