/**
 * Regression guard for the packaged API URL defaults.
 *
 * These assert the FULL request URL of one route per backend service, built from `new Sodax()` with no
 * `api` config at all — the exact path a consumer takes who never configures a base URL.
 *
 * This test exists because the resolver-level unit tests could not catch the defect it guards: they
 * asserted the resolved config against `DEFAULT_BACKEND_API_ENDPOINT`, so when that constant carried the
 * backend data API's `/be` mount and the sibling clients inherited it, the assertions agreed with the bug and
 * `sodax.api.swaps.submitTx()` silently posted to `/v1/be/swaps/submit-tx`. A URL is what the gateway
 * routes on, so a URL is what this file pins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sodax } from '../shared/entities/Sodax.js';
import { silentLogger } from '../shared/logger.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const okResponse = (data: unknown) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });

/** No `api` config whatsoever — the packaged defaults are the whole point. */
const sodax = new Sodax({ logger: silentLogger });

const requestedUrl = (): string => String(mockFetch.mock.calls.at(-1)?.[0]);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(okResponse({}));
});

describe('packaged API URL defaults', () => {
  it('backend data API mounts under /be', async () => {
    await sodax.backendApi.getAllMoneyMarketAssets();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/be/moneymarket/asset/all');
  });

  // The reported defect: swaps posted to `/v1/be/swaps/submit-tx`, which the gateway does not route.
  it('swaps, bridge and leverage-yield APIs are siblings of /be, not children of it', async () => {
    await sodax.api.swaps.getTokens();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/swaps/tokens');
    await sodax.api.bridge.getTokens();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/bridge/tokens');
    await sodax.api.leverageYield.getVaults();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/leverage-yield/vaults');
  });

  it('sponsoring API keeps its own route below the same root', async () => {
    await sodax.api.sponsoring.getStellarSponsorConfig();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/sponsorships/stellar/config');
  });

  it('every service resolves the same gateway root', () => {
    const root = 'https://api.sodax.com/v1';
    expect(sodax.backendApi.getBaseURL()).toBe(root);
    expect(sodax.backendApi.getBasePath()).toBe('/be');
    expect(sodax.api.swaps.getBaseURL()).toBe(root);
    expect(sodax.api.bridge.getBaseURL()).toBe(root);
    expect(sodax.api.leverageYield.getBaseURL()).toBe(root);
    expect(sodax.api.sponsoring.getBaseURL()).toBe(root);
  });
});

// Message shape and the no-warning cases are covered in BackendApiService.test.ts, beside the other
// logger assertions; the one facade-level case below stays here because only it exercises
// `new Sodax({ logger })` → `resolveLogger` → `BackendApiService`, i.e. that the warning reaches a
// consumer-supplied sink at all, once per construction.
describe('a legacy /be-suffixed baseURL still resolves every service', () => {
  // What consumers copied from the docs (and what the packaged default used to be). The data API keeps
  // its URLs; the siblings are corrected rather than nested one level deeper.
  it('leaves the data API URLs untouched and no longer nests swaps, bridge and leverage-yield under /be', async () => {
    const legacy = new Sodax({
      api: { baseApiConfig: { baseURL: 'https://api.sodax.com/v1/be' } },
      logger: silentLogger,
    });
    await legacy.backendApi.getAllConfig();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/be/config/all');
    await legacy.api.swaps.getTokens();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/swaps/tokens');
    await legacy.api.bridge.getTokens();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/bridge/tokens');
    await legacy.api.leverageYield.getVaults();
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/leverage-yield/vaults');
  });

  it('surfaces the deprecation warning through a consumer-supplied logger, once', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    new Sodax({ api: { baseURL: 'https://api.sodax.com/v1/be' }, logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('a legacy /be-suffixed per-call baseURL override', () => {
  // A per-call override means the same thing as a configured base URL — the gateway root — so the same
  // legacy trim applies. Without it the data API double-mounts (`/be/be/...`) and the siblings nest under
  // the data API's mount (`/be/swaps/...`), which is the original defect delivered through the override.
  const legacy = 'https://api.sodax.com/v1/be';

  it('resolves the data API to a single mount and does not nest any sibling client under it', async () => {
    await sodax.backendApi.getAllConfig({ baseURL: legacy });
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/be/config/all');
    await sodax.api.swaps.getTokens({ baseURL: legacy });
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/swaps/tokens');
    await sodax.api.bridge.getTokens({ baseURL: legacy });
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/bridge/tokens');
    await sodax.api.leverageYield.getVaults({ baseURL: legacy });
    expect(requestedUrl()).toBe('https://api.sodax.com/v1/leverage-yield/vaults');
  });

  it('is left exactly as given, for the data API and every sibling, when an explicit basePath opts the config out', async () => {
    // The config-level trim stands down for an explicit `basePath`; the per-call path must agree, or a
    // `/be` that is a real path segment for this deployment gets eaten out of the override. (PR review
    // finding 1: the opt-out once never reached the sibling clients.)
    const gw = new Sodax({
      api: { baseApiConfig: { baseURL: 'https://gw.example/be', basePath: '' } },
      logger: silentLogger,
    });
    await gw.backendApi.getAllConfig();
    expect(requestedUrl()).toBe('https://gw.example/be/config/all');
    await gw.backendApi.getAllConfig({ baseURL: 'https://gw2.example/be' });
    expect(requestedUrl()).toBe('https://gw2.example/be/config/all');
    await gw.api.swaps.getTokens({ baseURL: 'https://gw2.example/be' });
    expect(requestedUrl()).toBe('https://gw2.example/be/swaps/tokens');
    await gw.api.bridge.getTokens({ baseURL: 'https://gw2.example/be' });
    expect(requestedUrl()).toBe('https://gw2.example/be/bridge/tokens');
    await gw.api.leverageYield.getVaults({ baseURL: 'https://gw2.example/be' });
    expect(requestedUrl()).toBe('https://gw2.example/be/leverage-yield/vaults');
  });

  it('leaves a gateway-root override untouched for every service', async () => {
    const root = 'https://canary-api.sodax.com/v1';
    await sodax.backendApi.getAllConfig({ baseURL: root });
    expect(requestedUrl()).toBe(`${root}/be/config/all`);
    await sodax.api.swaps.getTokens({ baseURL: root });
    expect(requestedUrl()).toBe(`${root}/swaps/tokens`);
    await sodax.api.bridge.getTokens({ baseURL: root });
    expect(requestedUrl()).toBe(`${root}/bridge/tokens`);
    await sodax.api.leverageYield.getVaults({ baseURL: root });
    expect(requestedUrl()).toBe(`${root}/leverage-yield/vaults`);
  });
});

describe('a bare-origin baseURL on the packaged host', () => {
  // The version prefix is deployment-owned and lives in `baseURL`; dropping it silently shortens every
  // service path. Diagnosed at construction, since only the data API could be rescued with `basePath`.
  it('still resolves one segment short — and says so', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    new Sodax({ api: { baseURL: 'https://api.sodax.com' }, logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing the gateway'));
  });

  it.each([
    ['swapsApiConfig', 'api.swaps', { swapsApiConfig: { baseURL: 'https://api.sodax.com' } } as const],
    ['sponsoringApiConfig', 'api.sponsoring', { sponsoringApiConfig: { baseURL: 'https://api.sodax.com' } } as const],
  ])('is reported, naming the offending service, when the short root arrives through the %s slice', (_slice, service, api) => {
    // Finding 2 from the PR review: the old check layered only the flat fields and `baseApiConfig`, so a
    // root reaching its service through its own slice resolved one segment short with no warning.
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    new Sodax({ api, logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing the gateway'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(service));
  });

  it('stays quiet for a per-service slice that carries the prefix, and for a local service at its bare origin', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    new Sodax({ api: { swapsApiConfig: { baseURL: 'https://canary-api.sodax.com/v1' } }, logger });
    new Sodax({ api: { baseApiConfig: { baseURL: 'http://localhost:4000', basePath: '' } }, logger });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('basePath retargets a directly addressed backend', () => {
  // A local or non-gateway deployment serves `/config/*` at its origin, with no `/be` mount.
  it('drops the mount entirely when basePath is empty', async () => {
    const local = new Sodax({
      api: { baseApiConfig: { baseURL: 'http://localhost:4000', basePath: '' } },
      logger: silentLogger,
    });
    await local.backendApi.getAllConfig();
    expect(requestedUrl()).toBe('http://localhost:4000/config/all');
  });
});
