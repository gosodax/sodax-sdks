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
  DEFAULT_SPONSORING_API_ENDPOINT,
  sodaxConfig,
  type PartnerFee,
  type SodaxConfig,
  type SodaxOptions,
} from '@sodax/types';
import { mergeSodaxConfig } from './mergeSodaxConfig.js';
import { calculateFeeAmount } from '../utils/shared-utils.js';
import { resolveBaseApiConfig, resolveSponsoringApiConfig, resolveSwapsApiConfig } from '../../backendApi/apiConfig.js';

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

describe.each(FEE_FIELDS)('mergeSodaxConfig — $name override', field => {
  it('applies the user fee onto a base with no partnerFee (constructor scenario)', () => {
    const base = freshConfig(); // production default: no partnerFee on this feature
    expect(field.get(base)).toBeUndefined();

    const merged = mergeSodaxConfig(base, field.override(field.userFee));

    expect(field.get(merged)).toEqual(field.userFee);
    // Oracle: the merged config charges exactly the user's intended fee.
    expect(calculateFeeAmount(INPUT, field.get(merged))).toBe(calculateFeeAmount(INPUT, field.userFee));
  });

  it('re-layers the user fee onto a remote default with no partnerFee (ConfigService.initialize path)', () => {
    // The dynamic SodaxDefaultConfig fetched in ConfigService.initialize carries no per-feature
    // partnerFee — it never travels on the wire — so this is the same empty-slot merge as the
    // constructor, exercised explicitly as the initialize re-layer path.
    const base = freshConfig();

    const merged = mergeSodaxConfig(base, field.override(field.userFee));

    expect(field.get(merged)).toEqual(field.userFee);
  });

  it('leaves the feature without a partnerFee when the override omits it', () => {
    const base = freshConfig();

    const merged = mergeSodaxConfig(base, { api: { timeout: 12_345 } });

    // Treat an explicit `undefined` slot the same as an absent one.
    expect(field.get(merged)).toBeUndefined();
  });

  const siblingCase = field.sibling;
  if (siblingCase) {
    it(`preserves ${siblingCase.name} when only partnerFee is overridden`, () => {
      const base = freshConfig();
      const originalSibling = siblingCase.get(base);

      const merged = mergeSodaxConfig(base, field.override(field.userFee));

      // deepMerge keeps untouched nested refs, so the sibling survives by reference on the merged config.
      expect(siblingCase.get(merged)).toBe(originalSibling);
      // base must not be mutated by the merge.
      expect(siblingCase.get(base)).toBe(originalSibling);
    });
  }
});

describe('mergeSodaxConfig — non-union fields still deep-merge', () => {
  it('overrides a nested scalar while preserving its siblings', () => {
    const base = freshConfig();
    const originalBaseUrl = (base.api as { baseURL: string }).baseURL;

    const merged = mergeSodaxConfig(base, { api: { timeout: 99_999 } });

    expect((merged.api as { timeout: number }).timeout).toBe(99_999); // overridden
    expect((merged.api as { baseURL: string }).baseURL).toBe(originalBaseUrl); // sibling preserved
    expect((base.api as { timeout: number }).timeout).not.toBe(99_999); // base not mutated
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

  const resolveServices = (override: SodaxOptions) => {
    const merged = mergeSodaxConfig(freshConfig(), override);
    return {
      base: resolveBaseApiConfig(merged.api),
      swaps: resolveSwapsApiConfig(merged.api),
      sponsoring: resolveSponsoringApiConfig(merged.api),
      mergedApi: merged.api,
    };
  };

  it('no override → base and swaps both use the defaults', () => {
    const { base, swaps } = resolveServices({});
    expect(base).toEqual(withMount(DEFAULT_RESOLVED));
    expect(swaps).toEqual(DEFAULT_RESOLVED);
  });

  it('flat partial override (timeout) → applied to both, sibling baseURL preserved', () => {
    const { base, swaps } = resolveServices({ api: { timeout: 99_999 } });
    const expected = { baseURL: DEFAULT_API_BASE_URL, timeout: 99_999, headers: { ...D } };
    expect(base).toEqual(withMount(expected));
    expect(swaps).toEqual(expected);
  });

  it('flat full override → applied to both (swaps shares the base)', () => {
    const { base, swaps } = resolveServices({
      api: { baseURL: 'https://flat.example', timeout: 7, headers: { 'X-A': '1' } },
    });
    const expected = { baseURL: 'https://flat.example', timeout: 7, headers: { ...D, 'X-A': '1' } };
    expect(base).toEqual(withMount(expected));
    expect(swaps).toEqual(expected);
  });

  it('CustomApiConfig with swapsApiConfig only → base = defaults, swaps = custom (slice not dropped by merge)', () => {
    const { base, swaps, mergedApi } = resolveServices({
      api: { swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: { 'X-S': '1' } } },
    });
    expect(base).toEqual(withMount(DEFAULT_RESOLVED));
    expect(swaps).toEqual({ baseURL: 'https://swaps.example', timeout: 2, headers: { ...D, 'X-S': '1' } });
    // the deep-merge must carry the override's custom slice through verbatim
    expect((mergedApi as { swapsApiConfig?: unknown }).swapsApiConfig).toEqual({
      baseURL: 'https://swaps.example',
      timeout: 2,
      headers: { 'X-S': '1' },
    });
  });

  it('CustomApiConfig with baseApiConfig only → base = custom, swaps falls back to it', () => {
    const { base, swaps } = resolveServices({
      api: { baseApiConfig: { baseURL: 'https://base.example', timeout: 3, headers: { 'X-B': '1' } } },
    });
    const expected = { baseURL: 'https://base.example', timeout: 3, headers: { ...D, 'X-B': '1' } };
    expect(base).toEqual(withMount(expected));
    expect(swaps).toEqual(expected);
  });

  it('CustomApiConfig with both slices → swaps overrides baseURL/timeout, headers layer base under swaps', () => {
    const { base, swaps } = resolveServices({
      api: {
        baseApiConfig: { baseURL: 'https://base.example', timeout: 3, headers: { 'X-B': '1' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: { 'X-S': '1' } },
      },
    });
    expect(base).toEqual(withMount({ baseURL: 'https://base.example', timeout: 3, headers: { ...D, 'X-B': '1' } }));
    // swaps overrides baseURL/timeout; headers merge defaults → base → swaps (base 'X-B' inherited)
    expect(swaps).toEqual({ baseURL: 'https://swaps.example', timeout: 2, headers: { ...D, 'X-B': '1', 'X-S': '1' } });
  });

  it('CustomApiConfig: swaps inherits a baseApiConfig header (auth) it does not override', () => {
    const { base, swaps } = resolveServices({
      api: {
        baseApiConfig: { baseURL: 'https://base.example', timeout: 3, headers: { Authorization: 'tok' } },
        swapsApiConfig: { headers: { 'X-Swaps': '1' } },
      },
    });
    expect(base).toEqual(
      withMount({ baseURL: 'https://base.example', timeout: 3, headers: { ...D, Authorization: 'tok' } }),
    );
    // swaps inherits base's baseURL/timeout/Authorization, plus its own header
    expect(swaps).toEqual({
      baseURL: 'https://base.example',
      timeout: 3,
      headers: { ...D, Authorization: 'tok', 'X-Swaps': '1' },
    });
  });

  it('does not mutate the base config when merging a CustomApiConfig override', () => {
    const base = freshConfig();
    const before = structuredClone(base.api);
    mergeSodaxConfig(base, {
      api: { swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 2, headers: {} } },
    });
    expect(base.api).toEqual(before);
  });

  // The merge deep-merges into the FLAT default `api`, so a slice-only override always arrives
  // alongside surviving top-level flat fields. Those fields must keep applying: a consumer who adds
  // a slice to an existing flat config would otherwise be silently re-routed to the packaged default.
  describe('a slice override alongside top-level flat fields', () => {
    it('keeps a custom flat baseURL on base and swaps when only sponsoringApiConfig is added', () => {
      const { base, swaps, sponsoring } = resolveServices({
        api: { baseURL: 'https://backend.mydapp.com/sodax', sponsoringApiConfig: { apiKey: 'k' } },
      });
      const expected = { baseURL: 'https://backend.mydapp.com/sodax', timeout: DEFAULT_BACKEND_API_TIMEOUT };
      expect(base).toMatchObject(expected);
      expect(swaps).toMatchObject(expected);
      // sponsoring still routes to its own host and carries the key
      expect(sponsoring.baseURL).toBe(DEFAULT_SPONSORING_API_ENDPOINT);
      expect(sponsoring.apiKey).toBe('k');
    });

    it('keeps custom flat timeout and headers on base and swaps when swapsApiConfig is added', () => {
      const { base, swaps } = resolveServices({
        api: {
          baseURL: 'https://backend.mydapp.com/sodax',
          timeout: 4321,
          headers: { Authorization: 'tok' },
          swapsApiConfig: { headers: { 'X-S': '1' } },
        },
      });
      expect(base).toEqual(
        withMount({
          baseURL: 'https://backend.mydapp.com/sodax',
          timeout: 4321,
          headers: { ...D, Authorization: 'tok' },
        }),
      );
      // swaps inherits the flat layer it does not override
      expect(swaps).toEqual({
        baseURL: 'https://backend.mydapp.com/sodax',
        timeout: 4321,
        headers: { ...D, Authorization: 'tok', 'X-S': '1' },
      });
    });

    it('lets sponsoring inherit a flat timeout, but never the flat baseURL or headers', () => {
      const { sponsoring } = resolveServices({
        api: {
          baseURL: 'https://backend.mydapp.com/sodax',
          timeout: 4321,
          headers: { Authorization: 'Bearer USER_JWT' },
          sponsoringApiConfig: { apiKey: 'k' },
        },
      });
      expect(sponsoring).toEqual({
        baseURL: DEFAULT_SPONSORING_API_ENDPOINT,
        timeout: 4321,
        headers: { ...D },
        apiKey: 'k',
      });
    });

    it('leaves base and swaps on the defaults for a sponsoring-only override', () => {
      const { base, swaps } = resolveServices({ api: { sponsoringApiConfig: { apiKey: 'k' } } });
      expect(base).toEqual(withMount(DEFAULT_RESOLVED));
      expect(swaps).toEqual(DEFAULT_RESOLVED);
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

  it('lands rpcUrls onto a base that has none and preserves the single-endpoint rpcUrl', () => {
    const base = freshConfig();
    expect(base.hub.rpcUrls).toBeUndefined();

    const merged = mergeSodaxConfig(base, { hub: { rpcUrls: [A, B] } });

    expect(merged.hub.rpcUrls).toEqual([A, B]);
    expect(merged.hub.rpcUrl).toBe(base.hub.rpcUrl);
  });

  it('replaces a pre-seeded rpcUrls wholesale (no element-wise merge)', () => {
    const base = mergeSodaxConfig(freshConfig(), { hub: { rpcUrls: [A, B] } });

    const merged = mergeSodaxConfig(base, { hub: { rpcUrls: [B] } });

    expect(merged.hub.rpcUrls).toEqual([B]);
  });

  it('preserves a pre-seeded rpcUrls when the override omits it', () => {
    const base = mergeSodaxConfig(freshConfig(), { hub: { rpcUrls: [A, B] } });

    const merged = mergeSodaxConfig(base, { hub: { rpcUrl: 'https://primary.example' } });

    expect(merged.hub.rpcUrl).toBe('https://primary.example'); // overridden
    expect(merged.hub.rpcUrls).toEqual([A, B]); // absent key preserves the array
  });

  it('preserves sibling hub fields when only rpcUrls is overridden', () => {
    const base = freshConfig();
    const originalWallet = base.hub.addresses.hubWallet;

    const merged = mergeSodaxConfig(base, { hub: { rpcUrls: [A] } });

    expect(merged.hub.addresses.hubWallet).toBe(originalWallet);
  });

  it('deep-merges rpcOptions key-by-key', () => {
    const base = mergeSodaxConfig(freshConfig(), { hub: { rpcOptions: { retryCount: 5, rank: false } } });

    const merged = mergeSodaxConfig(base, { hub: { rpcOptions: { rank: true } } });

    expect(merged.hub.rpcOptions).toEqual({ retryCount: 5, rank: true });
  });
});
