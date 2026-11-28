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
  it('fills omitted fields from defaults (empty config, partial flat config, CustomApiConfig without baseApiConfig)', () => {
    const defaults = {
      baseURL: DEFAULT_API_BASE_URL,
      basePath: BE,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    };
    expect(resolveBaseApiConfig(asConfig({}))).toEqual(defaults);
    expect(resolveBaseApiConfig(asConfig({ timeout: 5 }))).toEqual({ ...defaults, timeout: 5 });
    expect(
      resolveBaseApiConfig(asConfig({ swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: {} } })),
    ).toEqual(defaults);
  });

  // A merged config carries the flat fields it started with alongside any slice the consumer added.
  it('keeps top-level flat fields beside a slice (post-merge shape), with baseApiConfig winning on what it defines', () => {
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

    const overridden = resolveBaseApiConfig(
      asConfig({
        baseURL: 'https://flat.example',
        timeout: 11,
        headers: { 'X-Flat': '1' },
        baseApiConfig: { baseURL: 'https://base.example' },
      }),
    );
    expect(overridden).toEqual({
      baseURL: 'https://base.example',
      basePath: BE,
      timeout: 11,
      headers: { ...D, 'X-Flat': '1' },
    });
  });
});

describe('resolveSwapsApiConfig', () => {
  it('swapsApiConfig fields override baseApiConfig, headers per key', () => {
    const resolved = resolveSwapsApiConfig(
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-H': 'base', 'X-Only-Base': 'b' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-H': 'swaps' } },
      }),
    );
    expect(resolved).toEqual({
      baseURL: 'https://swaps.example',
      timeout: 9,
      headers: { ...D, 'X-H': 'swaps', 'X-Only-Base': 'b' },
    });
  });

  it('inherits baseApiConfig fields (baseURL, timeout, headers) that swapsApiConfig omits or when it is absent', () => {
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
    expect(
      resolveSwapsApiConfig(
        asConfig({ baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } } }),
      ),
    ).toEqual({ baseURL: 'https://base.example', timeout: 7, headers: { ...D, 'X-B': '1' } });
  });
});

describe('resolveSponsoringApiConfig', () => {
  const SPONSORING_DEFAULT = 'https://api.sodax.com/v1';

  it('defaults to the sponsoring endpoint (and no apiKey) when no slice is given', () => {
    const resolved = resolveSponsoringApiConfig(asConfig({}));
    expect(resolved).toEqual({
      baseURL: SPONSORING_DEFAULT,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...D },
    });
    expect(resolved).not.toHaveProperty('apiKey');
  });

  it('NEVER inherits baseURL or headers from the base API — sponsoring has its own host, and a credential is scoped to its origin', () => {
    const withAuth = { headers: { Authorization: 'Bearer USER_JWT' } };
    for (const config of [
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', ...withAuth }),
      asConfig({ baseApiConfig: { baseURL: 'https://backend.mydapp.com/sodax', ...withAuth } }),
      // post-merge shape: flat fields surviving beside the sponsoring slice
      asConfig({ baseURL: 'https://backend.mydapp.com/sodax', ...withAuth, sponsoringApiConfig: { apiKey: 'k' } }),
    ]) {
      expect(resolveSponsoringApiConfig(config).baseURL).toBe(SPONSORING_DEFAULT);
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

  it('takes baseURL, timeout, headers and apiKey from its own slice, which the caller chose for this host', () => {
    expect(
      resolveSponsoringApiConfig(
        asConfig({
          baseApiConfig: { baseURL: 'https://backend.mydapp.com', timeout: 1000, headers: { Authorization: 'leak' } },
          sponsoringApiConfig: {
            baseURL: 'http://localhost:3011',
            timeout: 5000,
            headers: { 'x-trace': 'abc' },
            apiKey: 'k',
          },
        }),
      ),
    ).toEqual({
      baseURL: 'http://localhost:3011',
      timeout: 5000,
      headers: { ...D, 'x-trace': 'abc' },
      apiKey: 'k',
    });
  });
});

// Bridge and leverage-yield hang off the same gateway root as the base API and read the same config
// source (they ignore any swapsApiConfig slice; neither has a slice of its own) — but their routes are
// siblings of `/be`, not children, so they must NOT carry the data API's basePath.
describe.each([['resolveBridgeApiConfig', resolveBridgeApiConfig]])('%s', (_name, resolve) => {
  // Each must track base field-for-field, so a field added to base resolution cannot skip the client.
  // `basePath` is the single sanctioned divergence, so it is the only thing subtracted.
  it('tracks the base config field-for-field apart from the mount', () => {
    expect(resolve(asConfig({ baseURL: 'https://base.example', timeout: 11, headers: { 'X-A': '1' } }))).toEqual({
      baseURL: 'https://base.example',
      timeout: 11,
      headers: { ...D, 'X-A': '1' },
    });
    for (const config of [
      asConfig({}),
      asConfig({ baseURL: 'https://flat.example', timeout: 3, headers: { 'X-A': '1' } }),
      asConfig({
        baseApiConfig: { baseURL: 'https://base.example', timeout: 7, headers: { 'X-B': '1' } },
        swapsApiConfig: { baseURL: 'https://swaps.example', timeout: 9, headers: { 'X-S': '1' } },
      }),
    ]) {
      const { basePath: _mount, ...baseWithoutMount } = resolveBaseApiConfig(config);
      expect(resolve(config)).toEqual(baseWithoutMount);
    }
  });

  it('never carries the data API basePath, whatever the base slice asks for', () => {
    for (const config of [
      asConfig({}),
      asConfig({ baseApiConfig: { basePath: '/be' } }),
      asConfig({ basePath: '/x' }),
    ]) {
      expect(resolve(config)).not.toHaveProperty('basePath');
    }
  });
});

describe('basePath — the backend data API mount', () => {
  it.each([
    ['an empty path (service addressed at its origin)', '', ''],
    ['surrounding whitespace, duplicate leading and trailing slashes', '  //be/  ', '/be'],
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

describe('legacy /be-suffixed baseURL', () => {
  // Before `baseURL` became the shared gateway root it ended in `/be` — in the packaged default and in
  // every doc example. Such a value must keep working for the data API AND now resolve the sibling
  // services correctly, which is the bug this normalization fixes.
  const legacyBaseURL = `${DEFAULT_API_BASE_URL}${BACKEND_API_BASE_PATH}`;
  const legacy = asConfig({ baseURL: legacyBaseURL });

  it('reduces the data API to root + /be (the same final URLs as before) and stops nesting siblings under /be', () => {
    const resolved = resolveBaseApiConfig(legacy);
    expect(resolved.baseURL).toBe(DEFAULT_API_BASE_URL);
    expect(`${resolved.baseURL}${resolved.basePath}`).toBe(legacyBaseURL);

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
    // `'https://be'.endsWith('/be')` is true; trimming it would leave the invalid `https:/`.
    expect(resolveBaseApiConfig(asConfig({ baseURL: 'https://be' })).baseURL).toBe('https://be');
    expect(hasLegacyBackendBaseURL(asConfig({ baseURL: 'https://be' }))).toBe(false);
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
});

describe('isMissingVersionPrefix', () => {
  // `baseURL` is origin + the deployment's version prefix. Dropping the prefix but keeping the packaged
  // host resolves a service one segment short, and only the data API has a `basePath` to compensate — so
  // this is diagnosed rather than silently repaired. The predicate takes a RESOLVED base URL, so it holds
  // however that URL was layered (flat field, `baseApiConfig`, or a per-service slice).
  it.each([
    ['a trailing slash on the bare packaged origin', 'https://api.sodax.com/'],
    ['the origin plus a service segment, no version', 'https://api.sodax.com/be'],
  ])('is reported for %s', (_label, baseURL) => {
    expect(isMissingVersionPrefix(baseURL)).toBe(true);
  });

  it.each([
    ['the packaged default', DEFAULT_API_BASE_URL],
    ['a deeper path (or legacy mount) below the packaged default', `${DEFAULT_API_BASE_URL}${BACKEND_API_BASE_PATH}`],
  ])('is not reported for %s', (_label, baseURL) => {
    expect(isMissingVersionPrefix(baseURL)).toBe(false);
  });

  it.each([
    ['a lookalike host that merely starts with the packaged origin', 'https://api.sodax.com.evil.example'],
  ])('never fires for %s — off the packaged host it is not ours to judge', (_label, baseURL) => {
    expect(isMissingVersionPrefix(baseURL)).toBe(false);
  });
});

describe('a set-but-empty baseURL falls back to the packaged default', () => {
  // `VITE_X=` / `process.env.X=''` reaches the resolver as `''`, which `??` would preserve — and an
  // empty base URL makes `fetch` throw on an unparseable URL instead of hitting the default host.
  it('on the flat field, the baseApiConfig slice and the swapsApiConfig slice', () => {
    for (const config of [
      asConfig({ baseURL: '' }),
      asConfig({ baseApiConfig: { baseURL: '' } }),
      asConfig({ swapsApiConfig: { baseURL: '' } }),
    ]) {
      expect(resolveBaseApiConfig(config).baseURL).toBe(DEFAULT_API_BASE_URL);
      expect(resolveSwapsApiConfig(config).baseURL).toBe(DEFAULT_API_BASE_URL);
    }
  });
});
