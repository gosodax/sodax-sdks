/**
 * Tests flat and per-service API config resolution.
 *
 * The invariant under test: `baseURL` is the GATEWAY ROOT, shared by every service, and each service
 * owns its own path below it. Only the backend data API carries a `basePath` (`/be`); swaps, bridge,
 * leverage-yield and sponsoring keep their segment in their route tables, so their resolved config
 * must never gain one.
 * Sponsoring additionally keeps its independent origin and credential scope.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKEND_API_BASE_PATH,
  DEFAULT_API_BASE_URL,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_SPONSORING_API_ENDPOINT,
  type ApiConfig,
} from '@sodax/types';
import {
  hasLegacyBackendBaseURL,
  isMissingVersionPrefix,
  resolveBaseApiConfig,
  resolveBridgeApiConfig,
  resolveLeverageYieldApiConfig,
  resolveSponsoringApiConfig,
  resolveSwapsApiConfig,
} from './apiConfig.js';

// Cast helper: tests intentionally pass partial / post-merge shapes that the strict
// `ApiConfig` type would reject but that arise at runtime via `DeepPartial` overrides.
const asConfig = (c: unknown): ApiConfig => c as ApiConfig;
const D = DEFAULT_BACKEND_API_HEADERS;
const BE = BACKEND_API_BASE_PATH;

describe('resolveBaseApiConfig', () => {
  it('returns a full flat config, merging default headers underneath', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://base.example',
      basePath: BE,
      timeout: 11,
      headers: { ...D, 'X-A': '1' },
    });
  });

  it('fills omitted fields of a partial flat config from defaults', () => {
    expect(resolveBaseApiConfig(asConfig({ timeout: 5 }))).toEqual({
      baseURL: DEFAULT_API_BASE_URL,
      basePath: BE,
      timeout: 5,
      headers: { ...D },
    });
  });

  it('returns all defaults for an empty config', () => {
    expect(resolveBaseApiConfig(asConfig({}))).toEqual({
      baseURL: DEFAULT_API_BASE_URL,
      basePath: BE,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('uses the baseApiConfig slice of a CustomApiConfig (ignoring swapsApiConfig)', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: {} },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://base.example',
      basePath: BE,
      timeout: 7,
      headers: { ...D, 'X-B': '1' },
    });
  });

  it('falls back to defaults when a CustomApiConfig has no baseApiConfig', () => {
    expect(
      resolveBaseApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: {} } })),
    ).toEqual({
      baseURL: DEFAULT_API_BASE_URL,
      basePath: BE,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('fills omitted fields of a partial baseApiConfig slice', () => {
    expect(resolveBaseApiConfig(asConfig({ baseApiConfig: { baseURL: 'https://base.example' } }))).toEqual({
      baseURL: 'https://base.example',
      basePath: BE,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  // A merged config carries the flat fields it started with alongside any slice the consumer added.
  it('keeps top-level flat fields when a slice is present (post-merge shape)', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { 'X-A': '1' },
        sponsoringApiConfig: { apiKey: 'k' },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://flat.example',
      basePath: BE,
      timeout: 11,
      headers: { ...D, 'X-A': '1' },
    });
  });

  it('lets baseApiConfig override the top-level flat fields it defines', () => {
    const resolved = resolveBaseApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { 'X-Flat': '1' },
        baseApiConfig: { baseURL: 'https://base.example' },
      }),
    );
    // slice wins on baseURL; the flat layer still supplies what the slice omits
    expect(resolved).toEqual({
      baseURL: 'https://base.example',
      basePath: BE,
      timeout: 11,
      headers: { ...D, 'X-Flat': '1' },
    });
  });
});

describe('resolveSwapsApiConfig', () => {
  it('shares a flat config with the base API', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } }),
    );
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 11, headers: { ...D, 'X-A': '1' } });
  });

  it('swapsApiConfig fields override baseApiConfig', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: {} },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-S': '1' } },
      }),
    );
    expect(resolved).toEqual({ baseURL: 'https://swaps.example', timeout: 9, headers: { ...D, 'X-S': '1' } });
  });

  it('inherits baseApiConfig fields (baseURL, timeout, headers) that swapsApiConfig omits', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { Authorization: 'tok' } },
        swapsApiConfig: { headers: { 'X-Swaps': '1' } },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://base.example', // inherited from base (swaps omits it)
      timeout: 7, // inherited from base
      headers: { ...D, Authorization: 'tok', 'X-Swaps': '1' }, // base auth header reaches swaps
    });
  });

  it('lets swapsApiConfig headers override baseApiConfig headers per key', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-H': 'base', 'X-Only-Base': 'b' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-H': 'swaps' } },
      }),
    );
    expect(resolved.headers['X-H']).toBe('swaps'); // swaps wins for the shared key
    expect(resolved.headers['X-Only-Base']).toBe('b'); // base-only header still inherited
  });

  it('falls back to baseApiConfig when swapsApiConfig is omitted', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({ baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } } }),
    );
    expect(resolved).toEqual({ baseURL: 'https://base.example', timeout: 7, headers: { ...D, 'X-B': '1' } });
  });

  it('falls back to defaults when neither slice is present', () => {
    expect(resolveSwapsApiConfig(asConfig({ baseApiConfig: undefined, swapsApiConfig: undefined }))).toEqual({
      baseURL: DEFAULT_API_BASE_URL,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('fills omitted fields of a partial swapsApiConfig slice', () => {
    expect(resolveSwapsApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://swaps.example' } }))).toEqual({
      baseURL: 'https://swaps.example',
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('inherits top-level flat fields the swaps slice omits (post-merge shape)', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { Authorization: 'tok' },
        swapsApiConfig: { headers: { 'X-S': '1' } },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://flat.example',
      timeout: 11,
      headers: { ...D, Authorization: 'tok', 'X-S': '1' },
    });
  });
});

describe('resolveSponsoringApiConfig', () => {
  const SPONSORING_DEFAULT = 'https://api.sodax.com/v1';

  it('defaults to the sponsoring endpoint when no slice is given', () => {
    expect(resolveSponsoringApiConfig(asConfig({}))).toEqual({
      baseURL: SPONSORING_DEFAULT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  it('NEVER inherits baseURL from the base API — sponsoring is routed to its own host', () => {
    for (const config of [
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax' }),
      asConfig({ baseApiConfig: { baseURL: 'https://backend.mydapp.com/sodax' } }),
      // post-merge shape: flat fields surviving beside the sponsoring slice
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', sponsoringApiConfig: { apiKey: 'k' } }),
    ]) {
      expect(resolveSponsoringApiConfig(config).baseURL).toBe(SPONSORING_DEFAULT);
    }
  });

  it('NEVER inherits headers from the base API — a credential is scoped to its origin', () => {
    const withAuth = { headers: { Authorization: 'Bearer USER_JWT' } };
    for (const config of [
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', ...withAuth }),
      asConfig({ baseApiConfig: { baseURL: 'https://backend.mydapp.com/sodax', ...withAuth } }),
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', ...withAuth, sponsoringApiConfig: { apiKey: 'k' } }),
    ]) {
      expect(resolveSponsoringApiConfig(config).headers).toEqual({ ...D });
      expect(resolveSponsoringApiConfig(config).headers).not.toHaveProperty('Authorization');
    }
  });

  it('DOES inherit timeout — it carries no credential and is origin-agnostic', () => {
    expect(resolveSponsoringApiConfig(asConfig({ baseApiConfig: { timeout: 1234 } })).timeout).toBe(1234);
    expect(resolveSponsoringApiConfig(asConfig({ timeout: 4321 })).timeout).toBe(4321);
    // post-merge shape: the flat timeout is still the one to inherit
    expect(resolveSponsoringApiConfig(asConfig({ timeout: 4321, sponsoringApiConfig: {} })).timeout).toBe(4321);
  });

  it('takes baseURL, timeout and headers from its own slice, which the caller chose for this host', () => {
    expect(
      resolveSponsoringApiConfig(
        asConfig({
          baseApiConfig: { baseURL: 'https://backend.mydapp.com', timeout: 1000, headers: { Authorization: 'leak' } },
          sponsoringApiConfig: { baseURL: 'http://localhost:3011', timeout: 5000, headers: { 'x-trace': 'abc' } },
        }),
      ),
    ).toEqual({
      baseURL: 'http://localhost:3011',
      timeout: 5000,
      headers: { ...D, 'x-trace': 'abc' },
    });
  });

  it('carries apiKey through, and omits the key entirely when unset', () => {
    expect(resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { apiKey: 'k' } })).apiKey).toBe('k');
    expect(
      resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { baseURL: 'https://x.example' } })),
    ).not.toHaveProperty('apiKey');
  });

  it('leaves base and swaps on the defaults for a sponsoring-only config', () => {
    const config = asConfig({ sponsoringApiConfig: { apiKey: 'k' } });
    const expected = {
      baseURL: DEFAULT_API_BASE_URL,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    };
    expect(resolveBaseApiConfig(config)).toEqual({ ...expected, basePath: BE });
    expect(resolveSwapsApiConfig(config)).toEqual(expected);
  });

  it.each([
    ['a trailing slash', 'https://api.sodax.com/v1/', 'https://api.sodax.com/v1'],
    ['several trailing slashes', 'http://localhost:3011///', 'http://localhost:3011'],
    ['no trailing slash (unchanged)', 'http://localhost:3011', 'http://localhost:3011'],
  ])('normalizes %s on the resolved baseURL', (_label, configured, expected) => {
    expect(resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { baseURL: configured } })).baseURL).toBe(
      expected,
    );
  });
});

describe('resolveBridgeApiConfig', () => {
  // Bridge hangs off the same gateway root as the base API and reads the same config source (it
  // ignores any swapsApiConfig slice and never reads a non-existent bridgeApiConfig slice) — but its
  // `/bridge/*` routes are siblings of `/be`, not children, so it must NOT carry the data API's basePath.
  it('shares a flat config with the base API, minus the data API mount', () => {
    const config = asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } });
    expect(resolveBridgeApiConfig(config)).toEqual({
      baseURL: 'https://base.example',
      timeout: 11,
      headers: { ...D, 'X-A': '1' },
    });
  });

  it('uses the baseApiConfig slice of a CustomApiConfig (ignoring swapsApiConfig)', () => {
    const config = asConfig({
      baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } },
      swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-S': '1' } },
    });
    expect(resolveBridgeApiConfig(config)).toEqual({
      baseURL: 'https://base.example',
      timeout: 7,
      headers: { ...D, 'X-B': '1' },
    });
  });

  it('falls back to defaults for an empty config', () => {
    expect(resolveBridgeApiConfig(asConfig({}))).toEqual({
      baseURL: DEFAULT_API_BASE_URL,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  // Restores the coupling the pre-`basePath` suite asserted with `toEqual(resolveBaseApiConfig(config))`:
  // bridge must track base field-for-field, so a field added to base resolution cannot skip the bridge
  // client. `basePath` is the single sanctioned divergence, so it is the only thing subtracted.
  it('tracks the base config field-for-field apart from the mount', () => {
    for (const config of [
      asConfig({}),
      asConfig({ baseURL: 'https://flat.example', timeout: 3, headers: { 'X-A': '1' } }),
      asConfig({ baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } } }),
    ]) {
      const { basePath: _mount, ...baseWithoutMount } = resolveBaseApiConfig(config);
      expect(resolveBridgeApiConfig(config)).toEqual(baseWithoutMount);
    }
  });

  it('never carries the data API basePath, whatever the base slice asks for', () => {
    for (const config of [
      asConfig({}),
      asConfig({ baseApiConfig: { basePath: '/be' } }),
      asConfig({ basePath: '/x' }),
    ]) {
      expect(resolveBridgeApiConfig(config)).not.toHaveProperty('basePath');
    }
  });
});

describe('resolveLeverageYieldApiConfig', () => {
  // Leverage-yield hangs off the same gateway root as the base API and reads the same config source
  // (there is deliberately no `leverageYieldApiConfig` slice) — but its `/leverage-yield/*` routes are
  // siblings of `/be`, not children, so it must NOT carry the data API's basePath.
  it('shares a flat config with the base API, minus the data API mount', () => {
    const config = asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } });
    expect(resolveLeverageYieldApiConfig(config)).toEqual({
      baseURL: 'https://base.example',
      timeout: 11,
      headers: { ...D, 'X-A': '1' },
    });
  });

  it('uses the baseApiConfig slice of a CustomApiConfig (ignoring swapsApiConfig)', () => {
    const config = asConfig({
      baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } },
      swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-S': '1' } },
    });
    expect(resolveLeverageYieldApiConfig(config)).toEqual({
      baseURL: 'https://base.example',
      timeout: 7,
      headers: { ...D, 'X-B': '1' },
    });
  });

  it('falls back to defaults for an empty config', () => {
    expect(resolveLeverageYieldApiConfig(asConfig({}))).toEqual({
      baseURL: DEFAULT_API_BASE_URL,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
  });

  // Same coupling the bridge suite asserts: leverage-yield must track base field-for-field, so a field
  // added to base resolution cannot skip this client. `basePath` is the single sanctioned divergence.
  it('tracks the base config field-for-field apart from the mount', () => {
    for (const config of [
      asConfig({}),
      asConfig({ baseURL: 'https://flat.example', timeout: 3, headers: { 'X-A': '1' } }),
      asConfig({ baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } } }),
    ]) {
      const { basePath: _mount, ...baseWithoutMount } = resolveBaseApiConfig(config);
      expect(resolveLeverageYieldApiConfig(config)).toEqual(baseWithoutMount);
    }
  });

  it('never carries the data API basePath, whatever the base slice asks for', () => {
    for (const config of [
      asConfig({}),
      asConfig({ baseApiConfig: { basePath: '/be' } }),
      asConfig({ basePath: '/x' }),
    ]) {
      expect(resolveLeverageYieldApiConfig(config)).not.toHaveProperty('basePath');
    }
  });
});

describe('basePath — the backend data API mount', () => {
  it('defaults to BACKEND_API_BASE_PATH', () => {
    expect(resolveBaseApiConfig(asConfig({})).basePath).toBe('/be');
  });

  it.each([
    ['an explicit path', '/data', '/data'],
    ['an empty path (service addressed at its origin)', '', ''],
    ['a missing leading slash', 'be', '/be'],
    ['a trailing slash', '/be/', '/be'],
    ['duplicate leading slashes', '//be', '/be'],
    ['surrounding whitespace', '  /be  ', '/be'],
    ['a lone slash (root mount)', '/', ''],
  ])('normalizes %s', (_label, configured, expected) => {
    expect(resolveBaseApiConfig(asConfig({ baseApiConfig: { basePath: configured } })).basePath).toBe(expected);
    expect(resolveBaseApiConfig(asConfig({ basePath: configured })).basePath).toBe(expected);
  });

  it('lets the baseApiConfig slice override a top-level flat basePath', () => {
    const resolved = resolveBaseApiConfig(asConfig({ basePath: '/flat', baseApiConfig: { basePath: '/slice' } }));
    expect(resolved.basePath).toBe('/slice');
  });

  it('is not leaked to the swaps, leverage-yield or sponsoring config', () => {
    const config = asConfig({ basePath: '/be' });
    expect(resolveSwapsApiConfig(config)).not.toHaveProperty('basePath');
    expect(resolveLeverageYieldApiConfig(config)).not.toHaveProperty('basePath');
    expect(resolveSponsoringApiConfig(config)).not.toHaveProperty('basePath');
  });
});

describe('the shared root does not extend to sponsoring', () => {
  // The other three services follow a retargeted `baseURL`; sponsoring resolves its own. Asserting it
  // against a NON-default root keeps this meaningful — comparing to the packaged default would pass
  // whether or not inheritance exists, since the two defaults are the same URL.
  const retargeted = asConfig({ baseURL: 'https://staging-api.example.com/v1' });

  it('moves base, swaps, bridge and leverage-yield but leaves sponsoring on its own default', () => {
    expect(resolveBaseApiConfig(retargeted).baseURL).toBe('https://staging-api.example.com/v1');
    expect(resolveSwapsApiConfig(retargeted).baseURL).toBe('https://staging-api.example.com/v1');
    expect(resolveBridgeApiConfig(retargeted).baseURL).toBe('https://staging-api.example.com/v1');
    expect(resolveLeverageYieldApiConfig(retargeted).baseURL).toBe('https://staging-api.example.com/v1');
    expect(resolveSponsoringApiConfig(retargeted).baseURL).toBe(DEFAULT_SPONSORING_API_ENDPOINT);
  });
});

describe('legacy /be-suffixed baseURL', () => {
  // Before `baseURL` became the shared gateway root it ended in `/be` — in the packaged default and in
  // every doc example. Such a value must keep working for the data API AND now resolve the sibling
  // services correctly, which is the bug this normalization fixes.
  const legacyBaseURL = `${DEFAULT_API_BASE_URL}${BACKEND_API_BASE_PATH}`;
  const legacy = asConfig({ baseURL: legacyBaseURL });

  it('reduces the data API to root + /be, i.e. the same final URLs as before', () => {
    const resolved = resolveBaseApiConfig(legacy);
    expect(resolved.baseURL).toBe(DEFAULT_API_BASE_URL);
    expect(`${resolved.baseURL}${resolved.basePath}`).toBe(legacyBaseURL);
  });

  it('stops nesting the sibling services under /be', () => {
    expect(resolveSwapsApiConfig(legacy).baseURL).toBe(DEFAULT_API_BASE_URL);
    expect(resolveBridgeApiConfig(legacy).baseURL).toBe(DEFAULT_API_BASE_URL);
    expect(resolveLeverageYieldApiConfig(legacy).baseURL).toBe(DEFAULT_API_BASE_URL);
  });

  it('is trimmed on the baseApiConfig slice too, and reported for a deprecation warning', () => {
    const sliced = asConfig({ baseApiConfig: { baseURL: 'https://backend.mydapp.com/v1/be' } });
    expect(resolveBaseApiConfig(sliced).baseURL).toBe('https://backend.mydapp.com/v1');
    expect(resolveSwapsApiConfig(sliced).baseURL).toBe('https://backend.mydapp.com/v1');
    expect(hasLegacyBackendBaseURL(sliced)).toBe(true);
    expect(hasLegacyBackendBaseURL(legacy)).toBe(true);
  });

  it('leaves a root base URL alone and reports no legacy suffix', () => {
    expect(hasLegacyBackendBaseURL(asConfig({}))).toBe(false);
    expect(hasLegacyBackendBaseURL(asConfig({ baseURL: DEFAULT_API_BASE_URL }))).toBe(false);
    expect(resolveBaseApiConfig(asConfig({ baseURL: 'https://base.example' })).baseURL).toBe('https://base.example');
  });

  it('stands down when an explicit basePath says the base URL is already a root', () => {
    // A proxy that genuinely serves the data API under `/be`, with the consumer stating the mount. The
    // trim must not eat a real path segment, and the deprecation warning must not fire.
    for (const config of [
      asConfig({ baseApiConfig: { baseURL: 'https://proxy.example.com/be', basePath: '' } }),
      asConfig({ baseURL: 'https://proxy.example.com/be', basePath: '' }),
    ]) {
      const resolved = resolveBaseApiConfig(config);
      expect(resolved.baseURL).toBe('https://proxy.example.com/be');
      expect(resolved.basePath).toBe('');
      expect(hasLegacyBackendBaseURL(config)).toBe(false);
      // Siblings keep the same untrimmed root, so `/swaps/*` sits beside the data API's routes.
      expect(resolveSwapsApiConfig(config).baseURL).toBe('https://proxy.example.com/be');
    }
  });

  it('still mounts below an explicitly-rooted base URL when basePath names a mount', () => {
    const config = asConfig({ baseApiConfig: { baseURL: 'https://gw.corp/be', basePath: '/data' } });
    const resolved = resolveBaseApiConfig(config);
    expect(`${resolved.baseURL}${resolved.basePath}`).toBe('https://gw.corp/be/data');
  });

  it('does not mangle a host whose authority merely ends in "be"', () => {
    // `'https://be'.endsWith('/be')` is true; trimming it would leave the invalid `https:/`.
    expect(resolveBaseApiConfig(asConfig({ baseURL: 'https://be' })).baseURL).toBe('https://be');
    expect(hasLegacyBackendBaseURL(asConfig({ baseURL: 'https://be' }))).toBe(false);
  });
});

describe('isMissingVersionPrefix', () => {
  // `baseURL` is origin + the deployment's version prefix. Dropping the prefix but keeping the packaged
  // host resolves a service one segment short, and only the data API has a `basePath` to compensate — so
  // this is diagnosed rather than silently repaired. The predicate takes a RESOLVED base URL, so it holds
  // however that URL was layered (flat field, `baseApiConfig`, or a per-service slice).
  it.each([
    ['the bare packaged origin', 'https://api.sodax.com'],
    ['a trailing slash on the origin', 'https://api.sodax.com/'],
    ['the origin plus a service segment, no version', 'https://api.sodax.com/be'],
  ])('is reported for %s', (_label, baseURL) => {
    expect(isMissingVersionPrefix(baseURL)).toBe(true);
  });

  it.each([
    ['the packaged default', DEFAULT_API_BASE_URL],
    ['the packaged default with a legacy mount', `${DEFAULT_API_BASE_URL}${BACKEND_API_BASE_PATH}`],
    ['a deeper path on the packaged host', `${DEFAULT_API_BASE_URL}/extra`],
  ])('is not reported for %s', (_label, baseURL) => {
    expect(isMissingVersionPrefix(baseURL)).toBe(false);
  });

  it.each([
    ['a local sponsoring service at its bare origin', 'http://localhost:3011'],
    ['a local swaps service at its bare origin', 'http://localhost:3008'],
    ['a self-hosted gateway at a bare origin', 'https://gw.mycorp.example'],
    ['a canary host', 'https://canary-api.sodax.com/v1'],
    ['a lookalike host that merely starts with the packaged origin', 'https://api.sodax.com.evil.example'],
  ])('never fires for %s — off the packaged host it is not ours to judge', (_label, baseURL) => {
    expect(isMissingVersionPrefix(baseURL)).toBe(false);
  });

  it('holds for a root reached through any slice, since it inspects the resolved value', () => {
    for (const config of [
      asConfig({ baseURL: 'https://api.sodax.com' }),
      asConfig({ baseApiConfig: { baseURL: 'https://api.sodax.com' } }),
    ]) {
      expect(isMissingVersionPrefix(resolveBaseApiConfig(config).baseURL)).toBe(true);
    }
    expect(
      isMissingVersionPrefix(
        resolveSwapsApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://api.sodax.com' } })).baseURL,
      ),
    ).toBe(true);
    expect(
      isMissingVersionPrefix(
        resolveSponsoringApiConfig(asConfig({ sponsoringApiConfig: { baseURL: 'https://api.sodax.com' } })).baseURL,
      ),
    ).toBe(true);
  });

  it('is not reported for the packaged default config on any service', () => {
    const config = asConfig({});
    expect(isMissingVersionPrefix(resolveBaseApiConfig(config).baseURL)).toBe(false);
    expect(isMissingVersionPrefix(resolveSwapsApiConfig(config).baseURL)).toBe(false);
    expect(isMissingVersionPrefix(resolveBridgeApiConfig(config).baseURL)).toBe(false);
    expect(isMissingVersionPrefix(resolveSponsoringApiConfig(config).baseURL)).toBe(false);
  });
});

describe('a set-but-empty baseURL falls back to the packaged default', () => {
  // `VITE_X=` / `process.env.X=''` reaches the resolver as `''`, which `??` would preserve — and an
  // empty base URL makes `fetch` throw on an unparseable URL instead of hitting the default host.
  it.each([
    ['flat', asConfig({ baseURL: '' })],
    ['baseApiConfig slice', asConfig({ baseApiConfig: { baseURL: '' } })],
    ['swapsApiConfig slice', asConfig({ swapsApiConfig: { baseURL: '' } })],
  ])('%s', (_label, config) => {
    expect(resolveBaseApiConfig(config).baseURL).toBe(DEFAULT_API_BASE_URL);
    expect(resolveSwapsApiConfig(config).baseURL).toBe(DEFAULT_API_BASE_URL);
  });
});
