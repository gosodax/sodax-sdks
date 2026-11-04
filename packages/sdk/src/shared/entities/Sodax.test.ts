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

// --- typed accessor for `__type` / `__args` (the fake-class markers) ------

type FakeInstance = { readonly __type: string; readonly __args: unknown };
const asFake = (value: unknown): FakeInstance => value as FakeInstance;

// =========================================================================
// instanceConfig — the `config ? deepMerge(...) : sodaxConfig` ternary
// =========================================================================

describe('Sodax constructor — instanceConfig', () => {
  it('uses the imported sodaxConfig reference as-is when called with no arguments', () => {
    const sodax = new Sodax();
    // Referential identity — the falsy branch of the ternary returns the imported default
    // directly, no clone. Mutation `config ? deepMerge(...) : deepMerge(...)` would break this.
    expect(sodax.instanceConfig).toBe(sodaxConfig);
  });

  it('treats explicit undefined the same as no argument (falsy ternary branch)', () => {
    const sodax = new Sodax(undefined);
    expect(sodax.instanceConfig).toBe(sodaxConfig);
  });

  it('produces a NEW object when given an empty override (truthy ternary branch, even if no-op)', () => {
    const sodax = new Sodax({});
    // `{}` is truthy → deepMerge runs. Empty source means every key is preserved by reference,
    // but the top-level result is a fresh `{ ...target }`. Pins the truthy-branch invariant.
    expect(sodax.instanceConfig).not.toBe(sodaxConfig);
    expect(sodax.instanceConfig).toEqual(sodaxConfig);
  });

  it('applies a nested override while preserving sibling defaults under the same parent', () => {
    const customTimeout = 99_999;
    const sodax = new Sodax({ api: { timeout: customTimeout } });
    const api = sodax.instanceConfig.api;
    invariant(
      !('baseApiConfig' in api) && !('swapsApiConfig' in api) && !('sponsoringApiConfig' in api),
      'default api config is the flat variant',
    );
    expect(api.timeout).toBe(customTimeout);
    // baseURL was NOT touched by the override — must equal the default. Catches a deepMerge
    // mutation that would replace the entire `api` object instead of merging key-by-key.
    expect(api.baseURL).toBe(sodaxConfig.api.baseURL);
    expect(api.headers).toEqual(sodaxConfig.api.headers);
  });

  it('leaves untouched top-level fields untouched (override one branch, others survive)', () => {
    const partnerFee = { address: '0x2222222222222222222222222222222222222222' as const, percentage: 50 };
    const sodax = new Sodax({ bridge: { partnerFee } });
    // `chains` was not in the source — deepMerge preserves the reference, not just deep equality.
    expect(sodax.instanceConfig.chains).toBe(sodaxConfig.chains);
    expect(sodax.instanceConfig.relay).toBe(sodaxConfig.relay);
    expect(sodax.instanceConfig.api).toBe(sodaxConfig.api);
  });

  it('does not mutate the imported sodaxConfig default when an override is applied', () => {
    // The packaged default declares `bridge` without partnerFee; widen to read the optional slot.
    const bridgeDefaults = sodaxConfig.bridge as { partnerFee?: unknown };
    const before = bridgeDefaults.partnerFee;
    new Sodax({ bridge: { partnerFee: { address: '0x3333333333333333333333333333333333333333', percentage: 25 } } });
    // Critical immutability invariant — the singleton default must remain pristine across
    // instances. Catches a deepMerge mutation that writes into `target` instead of cloning.
    expect(bridgeDefaults.partnerFee).toBe(before);
  });
});

// =========================================================================
// Sub-services — every public field is wired to the right collaborator
// =========================================================================
//
// The fake classes set `__type` to the canonical class name. Asserting `__type` is a stronger
// signal than `instanceof` because it directly catches a mutation that swaps two `new XService(...)`
// lines (e.g. `this.swaps = new MoneyMarketService(...)`) — instanceof would still pass since
// both fakes share `Object` as their ultimate prototype, but `__type` would not.

describe('Sodax constructor — sub-services are instantiated as the correct class', () => {
  const FIELDS = [
    ['backendApi', 'BackendApiService'],
    ['config', 'ConfigService'],
    ['hubProvider', 'EvmHubProvider'],
    ['spoke', 'SpokeService'],
    ['swaps', 'SwapService'],
    ['moneyMarket', 'MoneyMarketService'],
    ['dex', 'DexService'],
    ['migration', 'MigrationService'],
    ['bridge', 'BridgeService'],
    ['staking', 'StakingService'],
    ['partners', 'PartnerService'],
    ['recovery', 'RecoveryService'],
  ] as const;

  it.each(FIELDS)('sodax.%s is a %s instance', (field, expectedType) => {
    const sodax = new Sodax();
    const instance = sodax[field];
    expect(asFake(instance).__type).toBe(expectedType);
  });
});

// =========================================================================
// Dependency wiring — exactly which args reach each constructor
// =========================================================================

describe('Sodax constructor — dependency wiring', () => {
  it('BackendApiService receives instanceConfig.api (the merged value, not the raw default)', () => {
    const sodax = new Sodax();
    // Sodax passes the post-merge `instanceConfig.api`. Because no override was given this is
    // referentially equal to `sodaxConfig.api`, but the SOURCE is the merged config — verified
    // by the override-propagation test below.
    expect(helpers.captured.backendApi).toHaveLength(1);
    expect(helpers.captured.backendApi[0]).toBe(sodax.instanceConfig.api);
  });

  it('ConfigService receives { api, config: instanceConfig, userConfig: undefined } when constructed without overrides', () => {
    const sodax = new Sodax();
    expect(helpers.captured.config).toHaveLength(1);
    const args = helpers.captured.config[0] as { api: unknown; config: unknown; userConfig: unknown };
    expect(args.api).toBe(sodax.backendApi);
    expect(args.config).toBe(sodax.instanceConfig);
    // No override was passed → userConfig must be undefined so initialize() uses dynamic config as-is.
    expect(args.userConfig).toBeUndefined();
  });

  it('EvmHubProvider receives { config: <ConfigService instance> }', () => {
    const sodax = new Sodax();
    expect(helpers.captured.evmHub).toHaveLength(1);
    const args = helpers.captured.evmHub[0] as { config: unknown };
    expect(args.config).toBe(sodax.config);
  });

  it('SpokeService receives { config, hubProvider } pointing at the same Sodax-owned instances', () => {
    const sodax = new Sodax();
    expect(helpers.captured.spoke).toHaveLength(1);
    const args = helpers.captured.spoke[0] as { config: unknown; hubProvider: unknown };
    expect(args.config).toBe(sodax.config);
    expect(args.hubProvider).toBe(sodax.hubProvider);
  });

  // The downstream services all take the same { config, hubProvider, spoke } triple. We check
  // each one independently — a mutation that drops one field on, say, `MoneyMarketService` but
  // not on `SwapService` is exactly the kind of regression a parameterized test catches.
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

  it.each(
    TRIPLE_SERVICES,
  )('%s service receives { config, hubProvider, spoke } pointing at the shared instances', (sinkKey, fieldName) => {
    const sodax = new Sodax();
    const sink = helpers.captured[sinkKey];
    expect(sink).toHaveLength(1);
    const args = sink[0] as { config: unknown; hubProvider: unknown; spoke: unknown };
    expect(args.config).toBe(sodax.config);
    expect(args.hubProvider).toBe(sodax.hubProvider);
    expect(args.spoke).toBe(sodax.spoke);
    // Defensive: also pin that the field-name → sink-name mapping is correct so a mutation
    // that swaps `this.swaps = new SwapService(...)` and `this.moneyMarket = new MoneyMarket(...)`
    // gets caught.
    expect((sodax as unknown as Record<string, FakeInstance>)[fieldName]?.__args).toBe(args);
  });

  it('shares ONE config instance across every service that needs it', () => {
    const sodax = new Sodax();
    const allConfigArgs = [
      (helpers.captured.evmHub[0] as { config: unknown }).config,
      (helpers.captured.spoke[0] as { config: unknown }).config,
      (helpers.captured.swap[0] as { config: unknown }).config,
      (helpers.captured.moneyMarket[0] as { config: unknown }).config,
      (helpers.captured.dex[0] as { config: unknown }).config,
      (helpers.captured.migration[0] as { config: unknown }).config,
      (helpers.captured.bridge[0] as { config: unknown }).config,
      (helpers.captured.staking[0] as { config: unknown }).config,
      (helpers.captured.partner[0] as { config: unknown }).config,
      (helpers.captured.recovery[0] as { config: unknown }).config,
    ];
    for (const cfg of allConfigArgs) expect(cfg).toBe(sodax.config);
  });

  it('shares ONE hubProvider instance across every service that needs it', () => {
    const sodax = new Sodax();
    const allHubArgs = [
      (helpers.captured.spoke[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.swap[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.moneyMarket[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.dex[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.migration[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.bridge[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.staking[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.partner[0] as { hubProvider: unknown }).hubProvider,
      (helpers.captured.recovery[0] as { hubProvider: unknown }).hubProvider,
    ];
    for (const hub of allHubArgs) expect(hub).toBe(sodax.hubProvider);
  });

  it('shares ONE spoke instance across every service that needs it', () => {
    const sodax = new Sodax();
    const allSpokeArgs = [
      (helpers.captured.swap[0] as { spoke: unknown }).spoke,
      (helpers.captured.moneyMarket[0] as { spoke: unknown }).spoke,
      (helpers.captured.dex[0] as { spoke: unknown }).spoke,
      (helpers.captured.migration[0] as { spoke: unknown }).spoke,
      (helpers.captured.bridge[0] as { spoke: unknown }).spoke,
      (helpers.captured.staking[0] as { spoke: unknown }).spoke,
      (helpers.captured.partner[0] as { spoke: unknown }).spoke,
      (helpers.captured.recovery[0] as { spoke: unknown }).spoke,
    ];
    for (const spoke of allSpokeArgs) expect(spoke).toBe(sodax.spoke);
  });
});

// =========================================================================
// Override propagation — overrides must reach the downstream constructors
// =========================================================================

describe('Sodax constructor — config override propagates downstream', () => {
  it('a partial { api: { timeout } } override reaches BackendApiService at construction time', () => {
    const customTimeout = 12_345;
    const sodax = new Sodax({ api: { timeout: customTimeout } });
    const backendApiArg = helpers.captured.backendApi[0] as { timeout: number };
    expect(backendApiArg.timeout).toBe(customTimeout);
    // The arg passed to BackendApiService must be `instanceConfig.api`, not `sodaxConfig.api`.
    expect(backendApiArg).toBe(sodax.instanceConfig.api);
  });

  it('the merged instanceConfig (not the raw default) is what ConfigService stores', () => {
    const sodax = new Sodax({ api: { timeout: 75 } });
    const configArg = helpers.captured.config[0] as { config: SodaxConfig };
    expect(configArg.config).toBe(sodax.instanceConfig);
    const storedApi = configArg.config.api;
    invariant(
      !('baseApiConfig' in storedApi) && !('swapsApiConfig' in storedApi) && !('sponsoringApiConfig' in storedApi),
      'default api config is the flat variant',
    );
    expect(storedApi.timeout).toBe(75);
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
  it('delegates to config.initialize and propagates its ok:true result unchanged', async () => {
    const expected: Result<void> = { ok: true, value: undefined };
    helpers.captured.configInitialize.mockResolvedValueOnce(expected);

    const sodax = new Sodax();
    const result = await sodax.initialize();

    // Identity (`toBe`) — the facade returns the awaited promise's value as-is, no re-wrapping.
    expect(result).toBe(expected);
    expect(helpers.captured.configInitialize).toHaveBeenCalledTimes(1);
    expect(helpers.captured.configInitialize).toHaveBeenCalledWith();
  });

  it('propagates an ok:false result returned by config.initialize', async () => {
    const failure: Result<void> = { ok: false, error: new Error('config init failed') };
    helpers.captured.configInitialize.mockResolvedValueOnce(failure);

    const sodax = new Sodax();
    const result = await sodax.initialize();

    expect(result).toBe(failure);
  });

  it('invokes config.initialize exactly once per call (no retry, no extra args)', async () => {
    helpers.captured.configInitialize.mockResolvedValue({ ok: true, value: undefined });
    const sodax = new Sodax();

    await sodax.initialize();
    expect(helpers.captured.configInitialize).toHaveBeenCalledTimes(1);

    await sodax.initialize();
    expect(helpers.captured.configInitialize).toHaveBeenCalledTimes(2);
    // Both invocations must pass zero arguments — the facade does not synthesize any.
    for (const call of helpers.captured.configInitialize.mock.calls) {
      expect(call).toEqual([]);
    }
  });
});

// =========================================================================
// Multiple-instance isolation
// =========================================================================

describe('Sodax — multiple instances', () => {
  it('two new Sodax() calls produce independent service instances', () => {
    const a = new Sodax();
    const b = new Sodax();
    // Identity, not just equality — each `new Sodax()` MUST produce a fresh facade. A mutation
    // that turned a public field into a static singleton would break this.
    expect(a).not.toBe(b);
    expect(a.config).not.toBe(b.config);
    expect(a.hubProvider).not.toBe(b.hubProvider);
    expect(a.spoke).not.toBe(b.spoke);
    expect(a.swaps).not.toBe(b.swaps);
  });

  it('an override on one instance does not leak into a sibling constructed without overrides', () => {
    const fee = { address: '0x5555555555555555555555555555555555555555' as const, percentage: 10 };
    new Sodax({ fee });
    const defaulted = new Sodax();

    // `fee` is forwarded per-instance (ConfigService is mocked, so assert via the captured args).
    expect((helpers.captured.config[0] as { fee?: unknown }).fee).toEqual(fee);
    expect((helpers.captured.config[1] as { fee?: unknown }).fee).toBeUndefined();
    expect(defaulted.instanceConfig).toBe(sodaxConfig); // sibling default untouched
  });
});
