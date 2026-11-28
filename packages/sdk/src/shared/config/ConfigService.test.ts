/**
 * Tests for ConfigService — the config-v2 surface (held global `fee`, per-feature partner-fee
 * fallback) plus the dynamic-config merge contract of initialize().
 *
 * NOTE: `ConfigService.initialize()` is currently a deliberate no-op (`// TODO(config-v2): enable once
 * the config v2 endpoint is live`) — it returns `{ ok: true }` without fetching or merging. The active
 * `no-op contract` suite asserts that disabled behavior; when initialize() is re-enabled it needs tests
 * for the dynamic merge (user override kept over remote config, stale/unversioned/failed fetch keeps
 * the merged config, the held `fee` survives, and a rebuild failure commits nothing).
 * The previously parked (commented-out) suites for this are at `git show 6d7ee73:packages/sdk/src/shared/config/ConfigService.test.ts`.
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

describe('ConfigService — global fee and apiKey are held client options, not dynamic config', () => {
  it('exposes the resolved fee and apiKey options and keeps the fee off the SodaxConfig data shape', () => {
    // The held fields are the authoritative read path (they survive the dynamic-config swap); the
    // merge layer may still copy option keys onto the merged config.
    const { service } = makeService(undefined, ok(remoteConfig()), USER_FEE, 'global-key');

    expect(service.fee).toEqual(USER_FEE);
    expect(service.apiKey).toBe('global-key');
    expect('fee' in service.sodaxConfig).toBe(false); // global fee is not part of SodaxConfig
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

  it('per-feature fee wins, else the global fee, else undefined, for every feature', () => {
    for (const { name, override, get } of FEATURES) {
      expect(get(makeService(override(REMOTE_FEE), ok(remoteConfig()), USER_FEE).service), name).toEqual(REMOTE_FEE);
      expect(get(makeService(undefined, ok(remoteConfig()), USER_FEE).service), name).toEqual(USER_FEE);
      expect(get(makeService(undefined, ok(remoteConfig())).service), name).toBeUndefined();
    }
  });
});
