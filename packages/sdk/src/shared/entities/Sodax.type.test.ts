/** Compile-time contract for `Sodax.ts`: `initialize` resolves to `Result<void>` and the facade exposes typed services. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BackendApiService,
  BridgeService,
  ConfigService,
  DexService,
  LeverageYieldService,
  MigrationService,
  MoneyMarketService,
  PartnerService,
  RecoveryService,
  Result,
  SodaxConfig,
  SponsoringService,
  SpokeService,
  StakingService,
  SwapService,
} from '../../index.js';
import type { Sodax } from './Sodax.js';

describe('Sodax type contract', () => {
  it('initialize resolves to Result<void>', () => {
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<Sodax['initialize']>>().toEqualTypeOf<Promise<Result<void>>>();
  });

  it('exposes each feature service with its exact type', () => {
    expectTypeOf<Sodax['instanceConfig']>().toEqualTypeOf<SodaxConfig>();
    expectTypeOf<Sodax['swaps']>().toEqualTypeOf<SwapService>();
    expectTypeOf<Sodax['moneyMarket']>().toEqualTypeOf<MoneyMarketService>();
    expectTypeOf<Sodax['migration']>().toEqualTypeOf<MigrationService>();
    expectTypeOf<Sodax['backendApi']>().toEqualTypeOf<BackendApiService>();
    expectTypeOf<Sodax['api']>().toEqualTypeOf<BackendApiService>();
    expectTypeOf<Sodax['bridge']>().toEqualTypeOf<BridgeService>();
    expectTypeOf<Sodax['staking']>().toEqualTypeOf<StakingService>();
    expectTypeOf<Sodax['partners']>().toEqualTypeOf<PartnerService>();
    expectTypeOf<Sodax['recovery']>().toEqualTypeOf<RecoveryService>();
    expectTypeOf<Sodax['dex']>().toEqualTypeOf<DexService>();
    expectTypeOf<Sodax['sponsoring']>().toEqualTypeOf<SponsoringService>();
    expectTypeOf<Sodax['leverageYield']>().toEqualTypeOf<LeverageYieldService>();
    expectTypeOf<Sodax['config']>().toEqualTypeOf<ConfigService>();
    expectTypeOf<Sodax['spoke']>().toEqualTypeOf<SpokeService>();
  });
});
