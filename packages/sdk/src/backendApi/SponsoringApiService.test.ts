import { beforeEach, describe, expect, it } from 'vitest';
import type { HttpUrl, SponsoringApiConfig } from '@sodax/types';
import { SponsoringApiService } from './SponsoringApiService.js';
import { silentLogger } from '../shared/logger.js';
import { jsonErrorResponse, okResponse, stubFetch } from '../test-utils/fetch.js';
import { expectErr } from '../test-utils/result.js';

const BASE = 'https://sponsoring.example.com';

const mockFetch = stubFetch();

const CONFIG_BODY = {
  sponsorAccount: 'GCV5PJ4H57MZFRH5GM3E3CNFLWQURNFNIHQOYGRQ7JHGWJLAR2SFVZO6',
  // Pin the exact wire value instead of trusting the Stellar SDK constant.
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
  minTotalFeeStroops: '3000',
  maxTotalFeeStroops: '10000',
  operationCount: 3,
  minPerOperationFeeStroops: '1000',
  maxPerOperationFeeStroops: '3333',
  recommendedPerOperationFeeStroops: '1000',
  maxTimeboundSeconds: 3600,
  requiredStartingBalance: '0',
};

const makeService = (overrides: Partial<SponsoringApiConfig> = {}) =>
  new SponsoringApiService(
    { baseURL: BASE, timeout: 5000, headers: { 'Content-Type': 'application/json' }, ...overrides },
    silentLogger,
  );

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getConfig', () => {
  it('GETs the config path under the configured base URL and returns the parsed body', async () => {
    const service = makeService();
    mockFetch.mockResolvedValueOnce(okResponse(CONFIG_BODY));

    const result = await service.getStellarSponsorConfig();

    expect(result).toEqual({ ok: true, value: CONFIG_BODY });
    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string }];
    expect(url).toBe(`${BASE}/sponsorships/stellar/config`);
    expect(init.method).toBe('GET');
  });

  it('rejects a config body missing the per-operation fee band or another required field as an invalid response shape', async () => {
    const service = makeService();
    const {
      operationCount: _c,
      minPerOperationFeeStroops: _min,
      maxPerOperationFeeStroops: _max,
      recommendedPerOperationFeeStroops: _rec,
      ...withoutPerOpBand
    } = CONFIG_BODY;
    const { maxTimeboundSeconds: _omitted, ...incomplete } = CONFIG_BODY;

    for (const body of [withoutPerOpBand, incomplete]) {
      mockFetch.mockResolvedValueOnce(okResponse(body));
      expectErr(await service.getStellarSponsorConfig(), undefined, { reason: 'invalid_response_shape' });
    }
  });
});

describe('createStellarSponsoredAccount', () => {
  it('POSTs exactly `{ data }` (the endpoint 400s on any extra field) and accepts a fresh activation', async () => {
    const service = makeService();
    const body = { hash: 'abc', alreadyActive: false };
    mockFetch.mockResolvedValueOnce(okResponse(body));

    await expect(service.createStellarSponsoredAccount({ data: 'XDR' })).resolves.toEqual({ ok: true, value: body });

    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${BASE}/sponsorships/stellar/accounts`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ data: 'XDR' });
  });

  it('rejects an uncorrelated hash/alreadyActive pair the union claims is impossible', async () => {
    // Preserve the wire correlation required by the discriminated union.
    const service = makeService();
    mockFetch.mockResolvedValueOnce(okResponse({ hash: 'abc', alreadyActive: true }));

    const result = await service.createStellarSponsoredAccount({ data: 'XDR' });

    expectErr(result, undefined, { reason: 'invalid_response_shape' });
  });

  it('surfaces the HTTP status on the error context and keeps the body on the cause', async () => {
    const service = makeService();
    const body = { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'conflict' };
    mockFetch.mockResolvedValueOnce(jsonErrorResponse(409, body));

    const result = await service.createStellarSponsoredAccount({ data: 'XDR' });

    const error = expectErr(result, 'EXTERNAL_API_ERROR', { api: 'sponsoring', status: 409 });
    // The transport layer tags `feature: 'backend'`; only the orchestrator claims 'sponsoring'.
    expect(error.feature).toBe('backend');
    expect(error.cause).toHaveProperty('body', body);
  });
});

describe('api key handling', () => {
  it('folds a directly configured `apiKey` into x-api-key and sends it to any target, including a per-call baseURL', async () => {
    // Direct construction carries no inherited-key gating (that applies only to the instance key
    // `BackendApiService` passes in): this key is the consumer's own config for their own origin.
    const service = makeService({ apiKey: 'secret-key' });
    mockFetch.mockResolvedValueOnce(okResponse(CONFIG_BODY));

    await service.getStellarSponsorConfig({ baseURL: 'http://localhost:3011' });

    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://localhost:3011/sponsorships/stellar/config');
    expect(init.headers['x-api-key']).toBe('secret-key');
    // The per-call override routes only that call.
    expect(service.getBaseURL()).toBe(BASE);
  });

  it('lets an explicit header win over `apiKey` (a consumer proxying through their own backend), and sends none unconfigured', async () => {
    const cases: [string, Partial<SponsoringApiConfig>, string | undefined][] = [
      ['explicit header', { apiKey: 'from-field', headers: { 'x-api-key': 'from-headers' } }, 'from-headers'],
      ['nothing configured', {}, undefined],
    ];
    for (const [label, overrides, expected] of cases) {
      mockFetch.mockReset().mockResolvedValueOnce(okResponse(CONFIG_BODY));

      await makeService(overrides).getStellarSponsorConfig();

      const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(init.headers['x-api-key'], label).toBe(expected);
    }
  });

  it('is NOT reached by BackendApiService.setHeaders — that origin is not this one', async () => {
    // Base API credentials must not egress to the sponsoring origin.
    const { BackendApiService } = await import('./BackendApiService.js');
    const api = new BackendApiService(
      { baseApiConfig: { baseURL: 'https://backend.mydapp.com', timeout: 5000, headers: {} } },
      silentLogger,
    );
    api.setHeaders({ Authorization: 'Bearer USER_JWT' });
    mockFetch.mockResolvedValueOnce(okResponse(CONFIG_BODY));

    await api.sponsoring.getStellarSponsorConfig();

    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url.startsWith('https://backend.mydapp.com')).toBe(false);
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('applies setHeaders to subsequent calls; a repeated mixed-casing update sends the newest value', async () => {
    // Updating an existing object key does NOT move it in insertion order, so a raw
    // `headers[name] = value` would leave the older casing last and let it win the merge.
    const service = makeService({ apiKey: 'v1' });
    service.setHeaders({ 'X-Api-Key': 'v2' });
    service.setHeaders({ 'x-api-key': 'v3' });
    mockFetch.mockResolvedValueOnce(okResponse(CONFIG_BODY));

    await service.getStellarSponsorConfig();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('v3');
  });
});

// The deployment owns the version prefix; the SDK route stays version-free.
describe('deployment prefixes', () => {
  // A bare origin (local service) is pinned by the per-call baseURL test under api key handling.
  it('resolves a versioned gateway path with a trailing slash', async () => {
    const baseURL: HttpUrl = 'https://api.sodax.com/v1/';
    const service = makeService({ baseURL });
    mockFetch.mockResolvedValueOnce(okResponse(CONFIG_BODY));

    await service.getStellarSponsorConfig();

    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.sodax.com/v1/sponsorships/stellar/config');
  });
});
