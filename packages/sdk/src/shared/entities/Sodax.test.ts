/**
 * Tests for the Sodax facade — the main SDK entry point at `src/shared/entities/Sodax.ts`.
 *
 * Mirrors the pattern from MoneyMarketService.test.ts (PR #1193) and SwapService.test.ts (PR #1174):
 *   1. Module-source mocks via `vi.mock` + `vi.hoisted` for every collaborator class so the
 *      facade can be exercised in isolation. Each fake class records its constructor args into a
 *      shared sink, lets us assert exact dependency wiring without instantiating real services
 *      (which would touch RPCs, viem clients, the backend API, etc.).
 *   2. A fresh `new Sodax()` per test (in `beforeEach`), with the captured-arg sinks reset on
 *      every iteration so tests don't bleed into each other.
 *   3. One top-level `describe` per facet (instanceConfig merge, sub-service instantiation,
 *      dependency wiring, override propagation, `initialize()` delegation, instance isolation).
 *
 * The Sodax class itself is a thin facade: a constructor that wires up 12 collaborators with
 * shared dependencies, plus an `initialize()` method that delegates to `config.initialize()`.
 * The behavioral surface is therefore the wiring, not business logic — every assertion either
 * pins a constructor argument or pins the merge/delegation contract.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { sodaxConfig, type Result, type SodaxConfig } from '@sodax/types';
import { invariant } from '../utils/tiny-invariant.js';

// --- hoisted shared state -------------------------------------------------
//
// `vi.hoisted` lifts this block alongside the `vi.mock` factories so the factories below can
// close over `helpers.captured` and `helpers.makeFakeService`. Without hoisting, the factories
// would run before these bindings exist (vi.mock is hoisted to the top of the file by Vitest).
//
// Each `captured.<service>` array is the constructor-args sink for the corresponding fake class.
// `configInitialize` is the stub method that fake ConfigService instances expose, allowing us to
// drive `Sodax.initialize()` outcomes without a real ConfigService implementation.

const helpers = vi.hoisted(() => {
  const captured = {
    backendApi: [] as unknown[],
    config: [] as unknown[],
    evmHub: [] as unknown[],
    spoke: [] as unknown[],
    swap: [] as unknown[],
    moneyMarket: [] as unknown[],
    dex: [] as unknown[],
    migration: [] as unknown[],
    bridge: [] as unknown[],
    staking: [] as unknown[],
    partner: [] as unknown[],
    recovery: [] as unknown[],
    configInitialize: vi.fn(),
  };

  // Class factory used by every service mock except ConfigService (which needs an `initialize`
  // method bound to the shared stub). Each instance carries `__type` (so tests can identify it
  // without relying on the imported class identity) and `__args` (a snapshot of its constructor
  // input — useful for per-instance assertions even if multiple instances exist).
  function makeFakeService(typeName: string, sink: unknown[]) {
    return class FakeService {
      public readonly __args: unknown;
      public readonly __type: string = typeName;
      constructor(args: unknown) {
        this.__args = args;
        sink.push(args);
      }
    };
  }

  return { captured, makeFakeService };
});

vi.mock('../../backendApi/BackendApiService.js', () => ({
  BackendApiService: helpers.makeFakeService('BackendApiService', helpers.captured.backendApi),
}));

vi.mock('../config/index.js', () => ({
  // ConfigService also exposes an `initialize` instance method that Sodax.initialize() delegates
  // to — bind it to the hoisted vi.fn so per-test `mockResolvedValueOnce` calls take effect.
  ConfigService: class FakeConfigService {
    public readonly __args: unknown;
    public readonly __type = 'ConfigService';
    public readonly initialize = helpers.captured.configInitialize;
    constructor(args: unknown) {
      this.__args = args;
      helpers.captured.config.push(args);
    }
  },
}));

vi.mock('./EvmHubProvider.js', () => ({
  EvmHubProvider: helpers.makeFakeService('EvmHubProvider', helpers.captured.evmHub),
}));

vi.mock('../services/spoke/SpokeService.js', () => ({
  SpokeService: helpers.makeFakeService('SpokeService', helpers.captured.spoke),
}));

vi.mock('../../swap/SwapService.js', () => ({
  SwapService: helpers.makeFakeService('SwapService', helpers.captured.swap),
}));

vi.mock('../../moneyMarket/MoneyMarketService.js', () => ({
  MoneyMarketService: helpers.makeFakeService('MoneyMarketService', helpers.captured.moneyMarket),
}));

vi.mock('../../dex/DexService.js', () => ({
  DexService: helpers.makeFakeService('DexService', helpers.captured.dex),
}));

vi.mock('../../migration/MigrationService.js', () => ({
  MigrationService: helpers.makeFakeService('MigrationService', helpers.captured.migration),
}));

vi.mock('../../bridge/BridgeService.js', () => ({
  BridgeService: helpers.makeFakeService('BridgeService', helpers.captured.bridge),
}));

vi.mock('../../staking/StakingService.js', () => ({
  StakingService: helpers.makeFakeService('StakingService', helpers.captured.staking),
}));

vi.mock('../../partner/PartnerService.js', () => ({
  PartnerService: helpers.makeFakeService('PartnerService', helpers.captured.partner),
}));

vi.mock('../../recovery/RecoveryService.js', () => ({
  RecoveryService: helpers.makeFakeService('RecoveryService', helpers.captured.recovery),
}));

import { Sodax } from './Sodax.js';

// --- per-test reset -------------------------------------------------------
//
// The captured arrays accumulate across `new Sodax()` calls — without a per-test reset, tests
// that introspect the most-recent constructor call would race with prior tests. Truncate via
// `length = 0` (preserves the array reference, which the hoisted mock factories already closed
// over) rather than reassigning.

const SINK_KEYS = [
  'backendApi',
  'config',
  'evmHub',
  'spoke',
  'swap',
  'moneyMarket',
  'dex',
  'migration',
  'bridge',
  'staking',
  'partner',
  'recovery',
] as const satisfies readonly (keyof typeof helpers.captured)[];

beforeEach(() => {
  for (const key of SINK_KEYS) {
    (helpers.captured[key] as unknown[]).length = 0;
  }
  helpers.captured.configInitialize.mockReset();
});

// --- type for `__type` / `__args` (the fake-class markers) ------

type FakeInstance = { readonly __type: string; readonly __args: unknown };

// =========================================================================
// instanceConfig — the `config ? deepMerge(...) : sodaxConfig` ternary
// =========================================================================

describe('Sodax constructor — instanceConfig', () => {
  it('uses the imported sodaxConfig reference as-is for no argument or explicit undefined', () => {
    // Referential identity — the falsy branch of the ternary returns the imported default
    // directly, no clone. Mutation `config ? deepMerge(...) : deepMerge(...)` would break this.
    expect(new Sodax().instanceConfig).toBe(sodaxConfig);
    expect(new Sodax(undefined).instanceConfig).toBe(sodaxConfig);
  });
});

// =========================================================================
// Dependency wiring — exactly which args reach each constructor
// =========================================================================

describe('Sodax constructor — dependency wiring', () => {
  it('wires BackendApiService, ConfigService, EvmHubProvider and SpokeService to the Sodax-owned instances', () => {
    const sodax = new Sodax();
    // Sodax passes the post-merge `instanceConfig.api` (referentially `sodaxConfig.api` without overrides).
    expect(helpers.captured.backendApi).toHaveLength(1);
    expect(helpers.captured.backendApi[0]).toBe(sodax.instanceConfig.api);

    expect(helpers.captured.config).toHaveLength(1);
    const configArgs = helpers.captured.config[0] as { api: unknown; config: unknown; userConfig: unknown };
    expect(configArgs.api).toBe(sodax.backendApi);
    expect(configArgs.config).toBe(sodax.instanceConfig);
    // No override was passed → userConfig must be undefined so initialize() uses dynamic config as-is.
    expect(configArgs.userConfig).toBeUndefined();

    expect(helpers.captured.evmHub).toHaveLength(1);
    expect((helpers.captured.evmHub[0] as { config: unknown }).config).toBe(sodax.config);

    expect(helpers.captured.spoke).toHaveLength(1);
    const spokeArgs = helpers.captured.spoke[0] as { config: unknown; hubProvider: unknown };
    expect(spokeArgs.config).toBe(sodax.config);
    expect(spokeArgs.hubProvider).toBe(sodax.hubProvider);
  });

  // The downstream services all take the same { config, hubProvider, spoke } triple. Each is checked
  // independently — a mutation that drops one field on one service but not another is caught.
  const TRIPLE_SERVICES = [
    ['swap', 'swaps'],
    ['moneyMarket', 'moneyMarket'],
    ['dex', 'dex'],
    ['migration', 'migration'],
    ['bridge', 'bridge'],
    ['staking', 'staking'],
    ['partner', 'partners'],
    ['recovery', 'recovery'],
  ] as const;

  it('every feature service receives the ONE shared { config, hubProvider, spoke } and lands on its own field', () => {
    const sodax = new Sodax();
    for (const [sinkKey, fieldName] of TRIPLE_SERVICES) {
      const sink = helpers.captured[sinkKey];
      expect(sink, sinkKey).toHaveLength(1);
      const args = sink[0] as { config: unknown; hubProvider: unknown; spoke: unknown };
      expect(args.config, sinkKey).toBe(sodax.config);
      expect(args.hubProvider, sinkKey).toBe(sodax.hubProvider);
      expect(args.spoke, sinkKey).toBe(sodax.spoke);
      // Pins the field-name → sink-name mapping so swapped `this.x = new Y(...)` lines get caught.
      expect((sodax as unknown as Record<string, FakeInstance>)[fieldName]?.__args, sinkKey).toBe(args);
    }
  });
});

// =========================================================================
// Override propagation — overrides must reach the downstream constructors
// =========================================================================

describe('Sodax constructor — config override propagates downstream', () => {
  it('a partial { api: { timeout } } override reaches BackendApiService and the ConfigService-stored config', () => {
    const customTimeout = 12_345;
    const sodax = new Sodax({ api: { timeout: customTimeout } });
    const backendApiArg = helpers.captured.backendApi[0] as { timeout: number };
    expect(backendApiArg.timeout).toBe(customTimeout);
    // The arg passed to BackendApiService must be `instanceConfig.api`, not `sodaxConfig.api`.
    expect(backendApiArg).toBe(sodax.instanceConfig.api);

    const configArg = helpers.captured.config[0] as { config: SodaxConfig };
    expect(configArg.config).toBe(sodax.instanceConfig);
    const storedApi = configArg.config.api;
    invariant(
      !('baseApiConfig' in storedApi) && !('swapsApiConfig' in storedApi) && !('sponsoringApiConfig' in storedApi),
      'default api config is the flat variant',
    );
    expect(storedApi.timeout).toBe(customTimeout);
  });

  it('forwards the global fee option to ConfigService as a separate held option', () => {
    const fee = { address: '0x4444444444444444444444444444444444444444' as const, percentage: 75 };
    new Sodax({ fee });
    // `fee` is a client-side option (like `logger`): handed to ConfigService as its own constructor
    // arg, never read off the merged data config.
    const configArg = helpers.captured.config[0] as { config: SodaxConfig; fee?: unknown };
    expect(configArg.fee).toEqual(fee);
  });

  it('the unmerged override (apiKey stripped, not the merged result) is forwarded to ConfigService as userConfig', () => {
    // ConfigService needs the unmerged partial so initialize() can re-layer it on top of the
    // dynamic config. The credential is stripped from that copy too, so a future re-merge
    // cannot land it back on the swapped config.
    const override = { api: { timeout: 5 }, apiKey: 'secret-key' };
    new Sodax(override);
    const configArg = helpers.captured.config[0] as { config: SodaxConfig; userConfig: unknown };
    expect(configArg.userConfig).toEqual({ api: { timeout: 5 }, apiKey: undefined });
    // And it is distinct from the merged config the service also receives.
    expect(configArg.userConfig).not.toBe(configArg.config);
  });
});

// =========================================================================
// initialize() — single-line delegation to config.initialize()
// =========================================================================

describe('Sodax.initialize', () => {
  it('delegates to config.initialize once per call with no args and returns its ok:true result unchanged', async () => {
    const expected: Result<void> = { ok: true, value: undefined };
    helpers.captured.configInitialize.mockResolvedValue(expected);
    const sodax = new Sodax();

    // Identity (`toBe`) — the facade returns the awaited promise's value as-is, no re-wrapping.
    expect(await sodax.initialize()).toBe(expected);
    expect(helpers.captured.configInitialize).toHaveBeenCalledTimes(1);

    await sodax.initialize();
    expect(helpers.captured.configInitialize).toHaveBeenCalledTimes(2);
    // Both invocations must pass zero arguments — the facade does not synthesize any.
    for (const call of helpers.captured.configInitialize.mock.calls) {
      expect(call).toEqual([]);
    }
  });
});
