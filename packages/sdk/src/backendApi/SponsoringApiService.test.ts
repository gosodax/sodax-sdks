import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpUrl, SponsoringApiConfig } from '@sodax/types';
import { SponsoringApiService } from './SponsoringApiService.js';
import { silentLogger } from '../shared/logger.js';

const BASE = 'https://sponsoring.example.com';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jsonOk = (data: unknown) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });
const jsonErr = (status: number, body: unknown) => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

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
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

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
      mockFetch.mockResolvedValueOnce(jsonOk(body));
      const result = await service.getStellarSponsorConfig();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.context?.reason).toBe('invalid_response_shape');
    }
  });
});

describe('createStellarSponsoredAccount', () => {
  it.each([
    ['a fresh activation', { hash: 'abc', alreadyActive: false }],
    ['an already-active account', { hash: null, alreadyActive: true }],
  ])('POSTs exactly `{ data }` (the endpoint 400s on any extra field) and accepts %s', async (_label, body) => {
    const service = makeService();
    mockFetch.mockResolvedValueOnce(jsonOk(body));

    await expect(service.createStellarSponsoredAccount({ data: 'XDR' })).resolves.toEqual({ ok: true, value: body });

    const [url, init] = mockFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe(`${BASE}/sponsorships/stellar/accounts`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ data: 'XDR' });
  });

  it('rejects an uncorrelated hash/alreadyActive pair the union claims is impossible', async () => {
    // Preserve the wire correlation required by the discriminated union.
    const service = makeService();
    mockFetch.mockResolvedValueOnce(jsonOk({ hash: 'abc', alreadyActive: true }));

    const result = await service.createStellarSponsoredAccount({ data: 'XDR' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.context?.reason).toBe('invalid_response_shape');
  });

  it('surfaces the HTTP status on the error context and keeps the body on the cause', async () => {
    const service = makeService();
    const body = { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'conflict' };
    mockFetch.mockResolvedValueOnce(jsonErr(409, body));

    const result = await service.createStellarSponsoredAccount({ data: 'XDR' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_API_ERROR');
      // The transport layer tags `feature: 'backend'`; only the orchestrator claims 'sponsoring'.
      expect(result.error.feature).toBe('backend');
      expect(result.error.context?.api).toBe('sponsoring');
      expect(result.error.context?.status).toBe(409);
      expect((result.error.cause as { body: unknown }).body).toEqual(body);
    }
  });
});

describe('api key handling', () => {
  it('folds a directly configured `apiKey` into x-api-key and sends it to any target, including a per-call baseURL', async () => {
    // Direct construction carries no inherited-key gating (that applies only to the instance key
    // `BackendApiService` passes in): this key is the consumer's own config for their own origin.
    const service = makeService({ apiKey: 'secret-key' });
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

    await service.getStellarSponsorConfig({ baseURL: 'http://localhost:3011' });

    const [url, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('http://localhost:3011/sponsorships/stellar/config');
    expect(init.headers['x-api-key']).toBe('secret-key');
    // The per-call override routes only that call.
    expect(service.getBaseURL()).toBe(BASE);
  });

  it('lets an explicit header win, so a consumer proxying through their own backend can override it', async () => {
    const service = makeService({ apiKey: 'from-field', headers: { 'x-api-key': 'from-headers' } });
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

    await service.getStellarSponsorConfig();

    const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers['x-api-key']).toBe('from-headers');
  });

  it('sends no x-api-key when none is configured', async () => {
    const service = makeService();
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

    await service.getStellarSponsorConfig();

    const [, init] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  it('is NOT reached by BackendApiService.setHeaders — that origin is not this one', async () => {
    // Base API credentials must not egress to the sponsoring origin.
    const { BackendApiService } = await import('./BackendApiService.js');
    const api = new BackendApiService(
      { baseApiConfig: { baseURL: 'https://backend.mydapp.com', timeout: 5000, headers: {} } },
      silentLogger,
    );
    api.setHeaders({ Authorization: 'Bearer USER_JWT' });
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

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
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

    await service.getStellarSponsorConfig();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('v3');
  });
});

// The deployment owns the version prefix; the SDK route stays version-free.
describe('deployment prefixes', () => {
  const cases: Array<[label: string, baseURL: HttpUrl, expected: string]> = [
    ['a bare origin (local service)', 'http://localhost:3011', 'http://localhost:3011/sponsorships/stellar/config'],
    [
      'a versioned gateway path with a trailing slash',
      'https://api.sodax.com/v1/',
      'https://api.sodax.com/v1/sponsorships/stellar/config',
    ],
  ];

  it.each(cases)('resolves %s', async (_label, baseURL, expected) => {
    const service = makeService({ baseURL });
    mockFetch.mockResolvedValueOnce(jsonOk(CONFIG_BODY));

    await service.getStellarSponsorConfig();

    expect(mockFetch.mock.calls[0]?.[0]).toBe(expected);
  });
});
