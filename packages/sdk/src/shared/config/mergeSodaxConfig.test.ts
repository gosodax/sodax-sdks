/**
 * Tests for mergeSodaxConfig — the config-aware layering used by both `new Sodax(...)` and
 * ConfigService.initialize().
 *
 * The contract: every field deep-merges, so a partial override keeps untouched siblings. Each
 * feature exposes an optional `partnerFee` override slot (`swaps` / `moneyMarket` / `bridge` /
 * `leverageYield`). These slots are `SodaxOptions`/feature-options fields, NOT part of
 * `SodaxDefaultConfig` or the backend dynamic config, so a `partnerFee` never travels on the wire
 * and the base config never carries one. Every override therefore lands on an empty slot, and a
 * complete `PartnerFee` is written wholesale — no partial-variant hybrid (`{address, amount, percentage}`)
 * can arise from merging two different variants, because there is no base variant to merge against.
 *
 * (The global `fee` is NOT part of SodaxConfig merging — it is a `SodaxOptions` client option held by
 * ConfigService, never merged here.)
 *
 * We keep calculateFeeAmount as an oracle on the fee-applied cases: it proves the merged config
 * charges exactly the user's intended fee, not just that the structural shape matches.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKEND_API_BASE_PATH,
  DEFAULT_API_BASE_URL,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  sodaxConfig,
  type PartnerFee,
  type SodaxConfig,
  type SodaxOptions,
} from '@sodax/types';
import { mergeSodaxConfig } from './mergeSodaxConfig.js';
import { calculateFeeAmount } from '../utils/shared-utils.js';
import { resolveBaseApiConfig, resolveSwapsApiConfig } from '../../backendApi/apiConfig.js';

const USER_ADDR = '0x1111111111111111111111111111111111111111';
const INPUT = 1_000_000n;

function freshConfig(): SodaxConfig {
  return structuredClone(sodaxConfig) as SodaxConfig;
}

type FeeField = {
  name: string;
  get: (cfg: SodaxConfig) => PartnerFee | undefined;
  override: (fee: PartnerFee) => SodaxOptions;
  // Distinct percentage variant per feature so a cross-feature leak would change the charged amount.
  userFee: PartnerFee;
  // A static default sibling that must survive a partnerFee-only override. Bridge has none
  // (BridgeDefaultConfig is `{}`), so the sibling case is skipped for it.
  sibling?: { name: string; get: (cfg: SodaxConfig) => unknown };
};

const FEE_FIELDS: FeeField[] = [
  {
    name: 'swaps.partnerFee',
    get: cfg => cfg.swaps.partnerFee,
    override: fee => ({ swaps: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 25 },
    sibling: { name: 'swaps.supportedTokens', get: cfg => cfg.swaps.supportedTokens },
  },
  {
    name: 'moneyMarket.partnerFee',
    get: cfg => cfg.moneyMarket.partnerFee,
    override: fee => ({ moneyMarket: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 50 },
    sibling: { name: 'moneyMarket.lendingPool', get: cfg => cfg.moneyMarket.lendingPool },
  },
  {
    name: 'bridge.partnerFee',
    get: cfg => cfg.bridge.partnerFee,
    override: fee => ({ bridge: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 75 },
  },
  {
    name: 'leverageYield.partnerFee',
    get: cfg => cfg.leverageYield.partnerFee,
    override: fee => ({ leverageYield: { partnerFee: fee } }),
    userFee: { address: USER_ADDR, percentage: 100 },
    sibling: { name: 'leverageYield.vaults', get: cfg => cfg.leverageYield.vaults },
  },
];

describe('mergeSodaxConfig — per-feature partnerFee overrides', () => {
  it('lands every feature fee on its empty slot without leaking across features, keeping static siblings', () => {
    // Base has no partnerFee on any feature: both the constructor and the ConfigService.initialize
    // re-layer merge onto an empty slot, since a partnerFee never travels on the wire.
    const base = freshConfig();
    for (const field of FEE_FIELDS) expect(field.get(base), field.name).toBeUndefined();

    for (const field of FEE_FIELDS) {
      const merged = mergeSodaxConfig(base, field.override(field.userFee));
      expect(field.get(merged), field.name).toEqual(field.userFee);
      // Oracle: the merged config charges exactly the user's intended fee.
      expect(calculateFeeAmount(INPUT, field.get(merged))).toBe(calculateFeeAmount(INPUT, field.userFee));
      for (const other of FEE_FIELDS) {
        if (other !== field) expect(other.get(merged), `${field.name} leaked into ${other.name}`).toBeUndefined();
      }
      if (field.sibling) {
        const originalSibling = field.sibling.get(base);
        // deepMerge keeps untouched nested refs, so the sibling survives by reference; base is not mutated.
        expect(field.sibling.get(merged), field.sibling.name).toBe(originalSibling);
        expect(field.sibling.get(base), field.sibling.name).toBe(originalSibling);
      }
    }
  });
});

// `api` is the `ApiConfig` union (`BaseApiConfig | CustomApiConfig`). mergeSodaxConfig must
// produce an `api` value that the per-service resolvers reduce to the correct base/swaps
// endpoints — for BOTH variants and partial overrides. The resolvers are the oracle here
// (mirrors how the PartnerFee tests use calculateFeeAmount): they prove which values actually
// reach BackendApiService (base) and SwapsApiService (swaps), independent of the merged shape.
describe('mergeSodaxConfig — api ApiConfig union resolves correctly per service', () => {
  const D = DEFAULT_BACKEND_API_HEADERS;
  const DEFAULT_RESOLVED = {
    baseURL: DEFAULT_API_BASE_URL,
    timeout: DEFAULT_BACKEND_API_TIMEOUT,
    headers: { ...D },
  };
  // Every service resolves the same gateway root; only the backend data API appends a mount below it.
  const withMount = <T extends object>(resolved: T) => ({ ...resolved, basePath: BACKEND_API_BASE_PATH });

  it('CustomApiConfig with swapsApiConfig only → base = defaults, swaps = custom (slice not dropped, base not mutated)', () => {
    const baseConfig = freshConfig();
    const before = structuredClone(baseConfig.api);
    const mergedApi = mergeSodaxConfig(baseConfig, {
      api: { swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: { 'X-S': '1' } } },
    }).api;
    expect(baseConfig.api).toEqual(before);
    const base = resolveBaseApiConfig(mergedApi);
    const swaps = resolveSwapsApiConfig(mergedApi);
    expect(base).toEqual(withMount(DEFAULT_RESOLVED));
    expect(swaps).toEqual({ baseURL: 'https://swaps.example', timeout: 2, headers: { ...D, 'X-S': '1' } });
    // the deep-merge must carry the override's custom slice through verbatim
    expect((mergedApi as { swapsApiConfig?: unknown }).swapsApiConfig).toEqual({
      baseURL: 'https://swaps.example',
      timeout: 2,
      headers: { 'X-S': '1' },
    });
  });
});

// Hub RPC failover fields (issue #225). The contract that matters: an `rpcUrls` array replaces
// wholesale (ordered failover list — element-wise merge would be wrong), an absent `rpcUrls`
// preserves whatever the base carries (backend payloads may omit it), and the single-endpoint
// `rpcUrl` plus sibling hub fields survive a failover-only override.
describe('mergeSodaxConfig — hub RPC failover fields', () => {
  const A = 'https://a.example';
  const B = 'https://b.example';

  it('replaces a pre-seeded rpcUrls wholesale (no element-wise merge) and preserves it when the override omits it', () => {
    const base = mergeSodaxConfig(freshConfig(), { hub: { rpcUrls: [A, B] } });

    expect(mergeSodaxConfig(base, { hub: { rpcUrls: [B] } }).hub.rpcUrls).toEqual([B]);

    const merged = mergeSodaxConfig(base, { hub: { rpcUrl: 'https://primary.example' } });
    expect(merged.hub.rpcUrl).toBe('https://primary.example'); // overridden
    expect(merged.hub.rpcUrls).toEqual([A, B]); // absent key preserves the array
  });

  it('deep-merges rpcOptions key-by-key', () => {
    const base = mergeSodaxConfig(freshConfig(), { hub: { rpcOptions: { retryCount: 5, rank: false } } });

    const merged = mergeSodaxConfig(base, { hub: { rpcOptions: { rank: true } } });

    expect(merged.hub.rpcOptions).toEqual({ retryCount: 5, rank: true });
  });
});
