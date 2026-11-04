/**
 * Tests for ConfigService — the config-v2 surface (held global `fee`, per-feature partner-fee
 * fallback) plus the dynamic-config merge contract of initialize().
 *
 * NOTE: `ConfigService.initialize()` is currently a deliberate no-op (`// TODO(config-v2): enable once
 * the config v2 endpoint is live`) — it returns `{ ok: true }` without fetching or merging. The
 * dynamic-merge suites below are therefore COMMENTED OUT (not `.skip`, which biome's `noSkippedTests`
 * forbids) and restored verbatim when initialize() is re-enabled; the active `no-op contract` suite
 * asserts the current disabled behavior.
 *
 * The synchronous suites (held global `fee`, effective per-feature fee) exercise config-v2 surface that
 * does not depend on initialize() and run today.
 *
 * Each test constructs a real ConfigService backed by a fake BackendApiService whose `getAllConfig`
 * resolves to a scripted Result. The wiring mirrors Sodax exactly:
 *   - `config`     = deepMerge(sodaxConfig, userOverride)  (the merged instanceConfig)
 *   - `userConfig` = the raw partial override
 *   - `fee`        = the resolved client-side global fee option
 */
import { describe, expect, it, vi } from 'vitest';
import {
  sodaxConfig,
  CONFIG_VERSION,
  type SodaxConfig,
  type Result,
  type GetAllConfigApiResponse,
  type PartnerFee,
  type SodaxOptions,
} from '@sodax/types';
import { ConfigService } from './ConfigService.js';
import { deepMerge } from '../utils/deepMerge.js';
import type { BackendApiService } from '../../backendApi/BackendApiService.js';

function makeService(
  userConfig: SodaxOptions | undefined,
  response: Result<GetAllConfigApiResponse>,
  fee?: PartnerFee,
  apiKey?: string,
) {
  const getAllConfig = vi.fn().mockResolvedValue(response);
  const api = { getAllConfig } as unknown as BackendApiService;
  const config = userConfig ? deepMerge<SodaxConfig>(sodaxConfig, userConfig) : sodaxConfig;
  const service = new ConfigService({ api, config, userConfig, fee, apiKey });
  return { service, getAllConfig };
}

const USER_FEE: PartnerFee = { address: '0x1111111111111111111111111111111111111111', percentage: 123 };
const REMOTE_FEE: PartnerFee = { address: '0x9999999999999999999999999999999999999999', percentage: 1 };

/** A full, valid SodaxConfig cloned from the default so loadSodaxConfigDataStructures has real data. */
function remoteConfig(mutate?: (cfg: SodaxConfig) => void): SodaxConfig {
  const cfg = structuredClone(sodaxConfig) as SodaxConfig;
  mutate?.(cfg);
  return cfg;
}

const ok = (config: SodaxConfig, version = CONFIG_VERSION): Result<GetAllConfigApiResponse> => ({
  ok: true,
  // Deliberate cast: the dynamic-config path is disabled (getAllConfig is never called), so this
  // stub only needs to exist — it predates the flat v1 response shape and nothing reads it.
  value: { version, config } as unknown as GetAllConfigApiResponse,
});

describe('ConfigService.initialize — current no-op contract (dynamic fetch/merge disabled)', () => {
  it('returns ok, never calls getAllConfig, and leaves the constructor-merged config + isInitialized untouched', async () => {
    const { service, getAllConfig } = makeService(
      { bridge: { partnerFee: USER_FEE } },
      ok(
        remoteConfig(cfg => {
          cfg.bridge.partnerFee = REMOTE_FEE;
        }),
      ),
    );
    const before = service.sodaxConfig;

    const result = await service.initialize();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(getAllConfig).not.toHaveBeenCalled(); // initialize() does not fetch while disabled
    expect(service.sodaxConfig).toBe(before); // config reference unchanged
    expect(service.bridge.partnerFee).toEqual(USER_FEE); // constructor-merged user override retained
    expect(service.isInitialized()).toBe(false); // no-op never flips the flag
  });
});

describe('ConfigService — global fee is a held client option, not dynamic config', () => {
  it('exposes the resolved fee option and keeps it off the SodaxConfig data shape', () => {
    const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE);

    expect(service.fee).toEqual(USER_FEE);
    expect('fee' in service.sodaxConfig).toBe(false); // global fee is not part of SodaxConfig
  });

  it('defaults to undefined when no fee option is provided', () => {
    const { service } = makeService(undefined, ok(remoteConfig()));
    expect(service.fee).toBeUndefined();
  });
});

describe('ConfigService — global apiKey is a held client option, not dynamic config', () => {
  it('exposes the held apiKey option independently of the config object', () => {
    // The held field is the authoritative read path (it survives the dynamic-config swap); the
    // merge layer may still copy option keys onto the merged config, exactly as it does for `fee`.
    const { service } = makeService(undefined, ok(remoteConfig()), undefined, 'global-key');

    expect(service.apiKey).toBe('global-key');
  });

  it('defaults to undefined when no apiKey option is provided', () => {
    const { service } = makeService(undefined, ok(remoteConfig()));
    expect(service.apiKey).toBeUndefined();
  });
});

describe('ConfigService — effective per-feature fee falls back to the global fee', () => {
  // The bug this guards: a global `fee` with no per-feature override used to resolve to nothing.
  // Each effective-fee getter must be `featureFee ?? globalFee`.
  const FEATURES = [
    {
      name: 'swap',
      override: (f: PartnerFee): SodaxOptions => ({ swaps: { partnerFee: f } }),
      get: (s: ConfigService) => s.swapPartnerFee,
    },
    {
      name: 'moneyMarket',
      override: (f: PartnerFee): SodaxOptions => ({ moneyMarket: { partnerFee: f } }),
      get: (s: ConfigService) => s.moneyMarketPartnerFee,
    },
    {
      name: 'bridge',
      override: (f: PartnerFee): SodaxOptions => ({ bridge: { partnerFee: f } }),
      get: (s: ConfigService) => s.bridgePartnerFee,
    },
    {
      name: 'leverageYield',
      override: (f: PartnerFee): SodaxOptions => ({ leverageYield: { partnerFee: f } }),
      get: (s: ConfigService) => s.leverageYieldPartnerFee,
    },
  ];

  it.each(FEATURES)('$name: uses the global fee when the per-feature fee is unset', ({ get }) => {
    const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE);
    expect(get(service)).toEqual(USER_FEE); // global fee is the fallback
  });

  it.each(FEATURES)('$name: the per-feature fee overrides the global fee when both are set', ({ override, get }) => {
    const { service } = makeService(override(REMOTE_FEE), ok(remoteConfig()), USER_FEE);
    expect(get(service)).toEqual(REMOTE_FEE); // per-feature wins over global
  });

  it.each(FEATURES)('$name: undefined when neither the per-feature nor the global fee is set', ({ get }) => {
    const { service } = makeService(undefined, ok(remoteConfig()));
    expect(get(service)).toBeUndefined();
  });
});

/*
 * TODO(config-v2): restore the dynamic-config merge suites below verbatim when
 * ConfigService.initialize()'s fetch/merge is re-enabled (it is a no-op today, so these would fail).
 * Kept here — rather than deleted — so the behavioral contract is re-enabled alongside the impl.
 *
 * describe('ConfigService.initialize — user override is preserved over dynamic config', () => {
 *   it('re-applies a user override on top of a valid dynamic config', async () => {
 *     const { service } = makeService(
 *       { bridge: { partnerFee: USER_FEE } },
 *       ok(remoteConfig(cfg => { cfg.bridge.partnerFee = REMOTE_FEE; })),
 *     );
 *     const result = await service.initialize();
 *     expect(result).toEqual({ ok: true, value: undefined });
 *     expect(service.bridge.partnerFee).toEqual(USER_FEE); // user wins, not REMOTE_FEE
 *     expect(service.isInitialized()).toBe(true);
 *   });
 *
 *   it('user override beats the dynamic config at a nested key, siblings come from remote', async () => {
 *     const { service } = makeService(
 *       { api: { timeout: 99_999 } },
 *       ok(remoteConfig(cfg => { cfg.api = { ...cfg.api, timeout: 1, baseURL: 'https://remote.example/v1' }; })),
 *     );
 *     await service.initialize();
 *     expect(service.sodaxConfig.api.timeout).toBe(99_999); // user override survives
 *     expect(service.sodaxConfig.api.baseURL).toBe('https://remote.example/v1'); // sibling from remote
 *   });
 *
 *   it('adopts dynamic-config values for fields the user did not override', async () => {
 *     const { service } = makeService(
 *       { bridge: { partnerFee: USER_FEE } },
 *       ok(remoteConfig(cfg => { cfg.api = { ...cfg.api, timeout: 55_555 }; })),
 *     );
 *     await service.initialize();
 *     expect(service.sodaxConfig.api.timeout).toBe(55_555); // remote wins where user is silent
 *     expect(service.bridge.partnerFee).toEqual(USER_FEE); // user wins where set
 *   });
 *
 *   it('uses the dynamic config as-is (by reference) when no user override was provided', async () => {
 *     const remote = remoteConfig(cfg => { cfg.bridge.partnerFee = REMOTE_FEE; });
 *     const { service } = makeService(undefined, ok(remote));
 *     await service.initialize();
 *     expect(service.sodaxConfig).toBe(remote); // no needless merge clone when there is nothing to layer
 *     expect(service.bridge.partnerFee).toEqual(REMOTE_FEE);
 *   });
 * });
 *
 * describe('ConfigService.initialize — fallback paths keep the merged config', () => {
 *   it('keeps the user override when the dynamic config version is too old', async () => {
 *     const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 *     const { service } = makeService(
 *       { bridge: { partnerFee: USER_FEE } },
 *       ok(remoteConfig(cfg => { cfg.bridge.partnerFee = REMOTE_FEE; }), CONFIG_VERSION - 1),
 *     );
 *     const result = await service.initialize();
 *     expect(result).toEqual({ ok: true, value: undefined });
 *     expect(service.bridge.partnerFee).toEqual(USER_FEE); // stale remote ignored, merged config retained
 *     expect(service.isInitialized()).toBe(false);
 *     warn.mockRestore();
 *   });
 *
 *   it('keeps the user override when the dynamic config has no version', async () => {
 *     const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 *     const { service } = makeService(
 *       { bridge: { partnerFee: USER_FEE } },
 *       { ok: true, value: { config: remoteConfig(cfg => { cfg.bridge.partnerFee = REMOTE_FEE; }) } },
 *     );
 *     await service.initialize();
 *     expect(service.bridge.partnerFee).toEqual(USER_FEE);
 *     expect(service.isInitialized()).toBe(false);
 *     warn.mockRestore();
 *   });
 *
 *   it('propagates a failed config fetch and keeps the merged config', async () => {
 *     const error = new Error('network down');
 *     const { service } = makeService({ bridge: { partnerFee: USER_FEE } }, { ok: false, error });
 *     const result = await service.initialize();
 *     expect(result).toEqual({ ok: false, error });
 *     expect(service.bridge.partnerFee).toEqual(USER_FEE);
 *     expect(service.isInitialized()).toBe(false);
 *   });
 * });
 *
 * describe('ConfigService — global fee survives a dynamic config fetch', () => {
 *   it('never overwrites the fee option with a dynamic config fetch', async () => {
 *     const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE);
 *     await service.initialize();
 *     expect(service.isInitialized()).toBe(true);
 *     expect(service.fee).toEqual(USER_FEE);
 *   });
 * });
 *
 * describe('ConfigService.initialize — commit-last: a rebuild failure leaves prior state intact', () => {
 *   it('keeps the previously committed config and stays uninitialized when the rebuild throws', async () => {
 *     const malformed = remoteConfig(cfg => { Reflect.deleteProperty(cfg.dex, 'statATokenAddresses'); });
 *     const { service } = makeService({ bridge: { partnerFee: USER_FEE } }, ok(malformed));
 *     const before = service.sodaxConfig;
 *     const result = await service.initialize();
 *     expect(result.ok).toBe(false); // the throw is caught and surfaced
 *     expect(service.sodaxConfig).toBe(before); // no torn state — config reference not swapped
 *     expect(service.isInitialized()).toBe(false);
 *   });
 * });
 */
