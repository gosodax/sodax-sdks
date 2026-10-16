import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { type FeeBumpTransaction, type Horizon, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { AnalyticsEvent, IStellarWalletProvider, StellarSponsorConfig } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import { SPONSOR_CONFIG_TTL_MS } from './SponsoringService.js';

const SPONSOR = Keypair.random();
const USER = Keypair.random();
const SPONSORING_BASE_URL = 'https://sponsoring.example.com';

const SPONSOR_CONFIG: StellarSponsorConfig = {
  sponsorAccount: SPONSOR.publicKey(),
  networkPassphrase: Networks.PUBLIC,
  minTotalFeeStroops: '3000',
  maxTotalFeeStroops: '10000',
  operationCount: 3,
  minPerOperationFeeStroops: '1000',
  maxPerOperationFeeStroops: '3333',
  recommendedPerOperationFeeStroops: '1000',
  maxTimeboundSeconds: 3600,
  requiredStartingBalance: '0',
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jsonOk = (data: unknown) => ({ ok: true, status: 200, json: vi.fn().mockResolvedValue(data) });
const jsonErr = (status: number, body: unknown) => ({
  ok: false,
  status,
  text: vi.fn().mockResolvedValue(JSON.stringify(body)),
});

const horizonNotFound = () => Object.assign(new Error('Not Found'), { response: { status: 404 } });
const horizonDown = () => Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });

const sponsorAccountResponse = (
  sequence: string,
  xlm = '0',
  reserve: { subentry_count?: number; num_sponsoring?: number; num_sponsored?: number } = {},
) => ({
  sequenceNumber: () => sequence,
  balances: [{ asset_type: 'native', balance: xlm }],
  ...reserve,
});

const sponsoredAccountResponse = (xlm: string, subentryCount = 0) =>
  sponsorAccountResponse('1', xlm, { num_sponsored: 2, subentry_count: subentryCount });

function makeWallet(
  options: { keypair?: Keypair; network?: string; rejectOnCall?: number } = {},
): IStellarWalletProvider {
  const keypair = options.keypair ?? USER;
  const network = options.network ?? Networks.PUBLIC;
  let calls = 0;
  return {
    chainType: 'STELLAR',
    getWalletAddress: vi.fn().mockResolvedValue(keypair.publicKey()),
    waitForTransactionReceipt: vi.fn(),
    signTransaction: vi.fn(async (xdr: string, _options?: { address?: string }) => {
      calls += 1;
      if (calls === options.rejectOnCall) throw new Error('User rejected the request');
      const tx = TransactionBuilder.fromXDR(xdr, network) as Exclude<
        ReturnType<typeof TransactionBuilder.fromXDR>,
        FeeBumpTransaction
      >;
      tx.sign(keypair);
      return tx.toXDR();
    }),
  } as unknown as IStellarWalletProvider;
}

function makeSodax(keys: { instanceApiKey?: string; sponsoringApiKey?: string } = { sponsoringApiKey: 'test-key' }) {
  // Install analytics in every test because disabled emitters do not evaluate payload builders.
  const events: AnalyticsEvent[] = [];
  const sodax = new Sodax({
    ...(keys.instanceApiKey ? { apiKey: keys.instanceApiKey } : {}),
    api: {
      sponsoringApiConfig: {
        baseURL: SPONSORING_BASE_URL,
        timeout: 5000,
        headers: {},
        ...(keys.sponsoringApiKey ? { apiKey: keys.sponsoringApiKey } : {}),
      },
    },
    logger: 'silent',
    analytics: { tracker: event => void events.push(event) },
  });
  const loadAccount = vi.spyOn(sodax.spoke.stellar.server, 'loadAccount');
  // Horizon's ledger endpoint carries the network base reserve; never let a test reach it.
  const ledgers = vi.spyOn(sodax.spoke.stellar.server, 'ledgers');
  stubBaseReserve(ledgers, 5_000_000);
  const failureData = () => events.find(e => e.phase === 'failure')?.data;
  const successData = () => events.find(e => e.phase === 'success')?.data;
  return { sodax, loadAccount, ledgers, events, failureData, successData };
}

/** Stub the `.order().limit().call()` chain the base-reserve read walks. */
function stubBaseReserve(
  ledgers: MockInstance<Horizon.Server['ledgers']>,
  baseReserveInStroops: number | undefined,
): void {
  const call = vi.fn(async () => ({
    records: baseReserveInStroops === undefined ? [] : [{ base_reserve_in_stroops: baseReserveInStroops }],
  }));
  ledgers.mockReturnValue({ order: () => ({ limit: () => ({ call }) }) } as never);
}

// Horizon uses its own HTTP client, so stub it independently of global fetch.
function stubHorizon(loadAccount: MockInstance<Horizon.Server['loadAccount']>, sequence = '100'): void {
  loadAccount.mockImplementation(async (address: string) => {
    if (address === SPONSOR.publicKey()) return sponsorAccountResponse(sequence) as never;
    throw horizonNotFound();
  });
}

const configRequests = () => mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/config'));
const accountRequests = () => mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/accounts'));

beforeEach(() => {
  mockFetch.mockReset();
});

describe('activateStellarAccount', () => {
  it('activates an account: one config read, one prompt, one submit', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
    });

    expect(result).toEqual({ ok: true, value: { status: 'submitted', hash: 'abc123', attempts: 1 } });
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(accountRequests()).toHaveLength(1);
  });

  it('names the account that must sign, so the wallet cannot use whatever is active', async () => {
    // The sponsor sources the transaction, but the created account must sign it.
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));
    const wallet = makeWallet();

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: wallet });

    expect(wallet.signTransaction).toHaveBeenCalledWith(expect.any(String), { address: USER.publicKey() });
  });

  it('sends the api key and EXACTLY `{ data }` — the endpoint rejects any extra field', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    const [url, init] = accountRequests()[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe(`${SPONSORING_BASE_URL}/sponsorships/stellar/accounts`);
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(Object.keys(JSON.parse(init.body))).toEqual(['data']);
  });

  it('submits a fee inside the published band, end to end', async () => {
    // TransactionBuilder takes a per-operation fee while the server validates the total.
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    const [, init] = accountRequests()[0] as [string, { body: string }];
    const submitted = TransactionBuilder.fromXDR(JSON.parse(init.body).data, Networks.PUBLIC);
    expect(BigInt(submitted.fee)).toBeGreaterThanOrEqual(3000n);
    expect(BigInt(submitted.fee)).toBeLessThanOrEqual(10000n);
    expect(submitted.fee).not.toBe('300');
  });

  it('treats an already-active account as success and NEVER prompts the wallet', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValue(sponsorAccountResponse('100') as never);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
    });

    expect(result).toEqual({ ok: true, value: { status: 'alreadyActive', hash: null, attempts: 0 } });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(accountRequests()).toHaveLength(0);
  });

  it('treats a post-submit already-active race as success', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: null, alreadyActive: true }));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(result).toEqual({ ok: true, value: { status: 'alreadyActive', hash: null, attempts: 1 } });
  });
});

describe('sequence conflict handling', () => {
  const conflict = () =>
    jsonErr(409, {
      statusCode: 409,
      error: 'SPONSOR_SEQUENCE_CONFLICT',
      message: 'sponsor account sequence conflict (tx_bad_seq)',
    });

  it('rebuilds from a FRESH sequence, re-signs once, and reports the extra attempt', async () => {
    const { sodax, loadAccount } = makeSodax();
    let sponsorReads = 0;
    loadAccount.mockImplementation(async (address: string) => {
      if (address === SPONSOR.publicKey()) return sponsorAccountResponse(String(100 + sponsorReads++)) as never;
      throw horizonNotFound();
    });
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonOk({ hash: 'second-try', alreadyActive: false }));

    const onSignatureRequired = vi.fn();
    const wallet = makeWallet();
    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
      onSignatureRequired,
    });

    expect(result).toEqual({ ok: true, value: { status: 'submitted', hash: 'second-try', attempts: 2 } });
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2);
    // Notify before each wallet prompt so the UI can explain the re-signature.
    expect(onSignatureRequired).toHaveBeenNthCalledWith(1, { attempt: 1, reason: 'initial' });
    expect(onSignatureRequired).toHaveBeenNthCalledWith(2, { attempt: 2, reason: 'sequenceConflict' });

    const [first, second] = accountRequests().map(([, init]) => JSON.parse((init as { body: string }).body).data);
    expect(first).not.toBe(second);
  });

  it('rebuilds from the 409 sponsorSequence hint, skipping the extra Horizon read', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount, '100');
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(
        jsonErr(409, {
          statusCode: 409,
          error: 'SPONSOR_SEQUENCE_CONFLICT',
          message: 'conflict',
          sponsorSequence: '777',
        }),
      )
      .mockResolvedValueOnce(jsonOk({ hash: 'second-try', alreadyActive: false }));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(result.ok).toBe(true);
    const sponsorReads = loadAccount.mock.calls.filter(([a]) => a === SPONSOR.publicKey());
    expect(sponsorReads).toHaveLength(1);
    const [, second] = accountRequests().map(([, init]) => JSON.parse((init as { body: string }).body).data);
    const secondTx = TransactionBuilder.fromXDR(second, Networks.PUBLIC) as Exclude<
      ReturnType<typeof TransactionBuilder.fromXDR>,
      FeeBumpTransaction
    >;
    expect(secondTx.sequence).toBe('778');
  });

  it('falls back to a Horizon read when the 409 carries no hint', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount, '100');
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(jsonOk({ hash: 'second-try', alreadyActive: false }));

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    expect(loadAccount.mock.calls.filter(([a]) => a === SPONSOR.publicKey())).toHaveLength(2);
  });

  it('ignores a malformed sponsorSequence rather than feeding it to the builder', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount, '100');
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(
        jsonErr(409, { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'x', sponsorSequence: 'abc' }),
      )
      .mockResolvedValueOnce(jsonOk({ hash: 'ok', alreadyActive: false }));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(result.ok).toBe(true);
    expect(loadAccount.mock.calls.filter(([a]) => a === SPONSOR.publicKey())).toHaveLength(2);
  });

  it('gives up after exactly one retry — never loops on a user signature', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(conflict());
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
    });

    expect(result.ok).toBe(false);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2);
    if (!result.ok) {
      expect(result.error.context?.nextAction).toBe('rebuildAndResign');
      expect(result.error.context?.requiresNewSignature).toBe(true);
      expect(result.error.context?.status).toBe(409);
    }
  });

  it('honours allowSequenceRetry: false with a single prompt', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG)).mockResolvedValueOnce(conflict());
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
      allowSequenceRetry: false,
    });

    expect(result.ok).toBe(false);
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('failure handling', () => {
  it('classifies a wallet cancellation as USER_REJECTED and never submits', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));
    const wallet = makeWallet();
    vi.mocked(wallet.signTransaction).mockRejectedValueOnce(new Error('User rejected the request'));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('USER_REJECTED');
    expect(accountRequests()).toHaveLength(0);
  });

  it('catches a wallet signing on the WRONG network locally, without submitting', async () => {
    // Network-mismatched signatures are valid XDR but invalid for this transaction.
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet({ network: Networks.TESTNET }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toMatch(/different Stellar network/);
    }
    expect(accountRequests()).toHaveLength(0);
  });

  it('fails without prompting when the SPONSOR account cannot be read', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockImplementation(async (address: string) => {
      if (address === SPONSOR.publicKey()) throw horizonDown();
      throw horizonNotFound();
    });
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LOOKUP_FAILED');
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it('PROCEEDS when the destination pre-flight read fails — it is only an optimisation', async () => {
    // Destination pre-flight is optional because the server repeats the authoritative check.
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockImplementation(async (address: string) => {
      if (address === SPONSOR.publicKey()) return sponsorAccountResponse('100') as never;
      throw horizonDown();
    });
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(result.ok).toBe(true);
  });

  it('re-submits the IDENTICAL payload on a transient upstream failure, with no new prompt', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonErr(503, { statusCode: 503, error: 'HORIZON_UNAVAILABLE', message: 'unavailable' }))
      .mockResolvedValueOnce(jsonOk({ hash: 'after-retry', alreadyActive: false }));
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
      maxHorizonRetries: 1,
    });

    expect(result).toEqual({ ok: true, value: { status: 'submitted', hash: 'after-retry', attempts: 1 } });
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    const [first, second] = accountRequests().map(([, init]) => JSON.parse((init as { body: string }).body).data);
    expect(first).toBe(second);
  });

  it('does NOT retry a rate limit — that is a load signal, not a transient fault', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonErr(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }));

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.context?.nextAction).toBe('backoff');
      expect(result.error.context?.retryable).toBe(true);
    }
    expect(accountRequests()).toHaveLength(1);
  });

  it('surfaces a budget-exhausted sponsor as needing an operator, not a retry', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(
        jsonErr(503, { statusCode: 503, error: 'SPONSOR_BUDGET_EXHAUSTED', message: 'below the configured floor' }),
      );

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.context?.nextAction).toBe('contactOperator');
      expect(result.error.context?.retryable).toBe(false);
    }
  });
});

describe('published config validation', () => {
  it.each([
    ['a malformed sponsor account', { sponsorAccount: 'not-a-stellar-account' }, /ed25519 public key/],
    ['the wrong network', { networkPassphrase: Networks.TESTNET }, /public network/],
    ['an unsatisfiable fee band', { recommendedPerOperationFeeStroops: '99999' }, /accepted per-operation band/],
  ])('rejects %s locally, without reading Horizon for the sponsor sequence', async (_label, overrides, message) => {
    // A bad sponsorAccount would otherwise surface as that lookup's 404.
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk({ ...SPONSOR_CONFIG, ...overrides }));
    const wallet = makeWallet();

    const result = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: wallet,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toMatch(message);
    }
    // Only the existence pre-flight ran; the sponsor account was never loaded.
    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(loadAccount).not.toHaveBeenCalledWith(SPONSOR.publicKey());
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });
});

describe('sponsor config caching', () => {
  it('serves a second call from cache', async () => {
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));

    await sodax.sponsoring.getStellarSponsorConfig();
    await sodax.sponsoring.getStellarSponsorConfig();

    expect(configRequests()).toHaveLength(1);
  });

  it('de-duplicates concurrent callers into ONE request', async () => {
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));

    await Promise.all([sodax.sponsoring.getStellarSponsorConfig(), sodax.sponsoring.getStellarSponsorConfig()]);

    expect(configRequests()).toHaveLength(1);
  });

  it('refetches when forceRefresh is set', async () => {
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));

    await sodax.sponsoring.getStellarSponsorConfig();
    await sodax.sponsoring.getStellarSponsorConfig({ forceRefresh: true });

    expect(configRequests()).toHaveLength(2);
  });

  it('keeps a header-scoped config out of the default path', async () => {
    // Headers can select a different response from the same URL, so the two must not share an entry.
    const { sodax } = makeSodax();
    mockFetch
      .mockResolvedValueOnce(jsonOk({ ...SPONSOR_CONFIG, networkPassphrase: Networks.TESTNET }))
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));

    const scoped = await sodax.sponsoring.getStellarSponsorConfig({
      requestConfig: { headers: { 'x-mock-scenario': 'config-testnet' } },
    });
    const plain = await sodax.sponsoring.getStellarSponsorConfig();

    expect(scoped.ok && scoped.value.networkPassphrase).toBe(Networks.TESTNET);
    expect(plain.ok && plain.value.networkPassphrase).toBe(Networks.PUBLIC);
    expect(configRequests()).toHaveLength(2);
  });

  it('keeps two per-request API keys on separate entries', async () => {
    // A key scoped to another deployment selects another sponsor account; sharing one entry would
    // serve one caller's config to the other.
    const { sodax } = makeSodax();
    mockFetch
      .mockResolvedValueOnce(jsonOk({ ...SPONSOR_CONFIG, networkPassphrase: Networks.TESTNET }))
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));

    const first = await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { apiKey: 'key-a' } });
    const second = await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { apiKey: 'key-b' } });

    expect(first.ok && first.value.networkPassphrase).toBe(Networks.TESTNET);
    expect(second.ok && second.value.networkPassphrase).toBe(Networks.PUBLIC);
    expect(configRequests()).toHaveLength(2);
  });

  it('shares one entry between apiKey and the equivalent raw x-api-key header', async () => {
    // Both spell the same wire request, so the second must be served from the first one's entry.
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));

    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { apiKey: 'same-key' } });
    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { headers: { 'X-Api-Key': 'same-key' } } });

    expect(configRequests()).toHaveLength(1);
  });

  it('still caches per header set, so a repeated override is not refetched', async () => {
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));
    const requestConfig = { headers: { 'x-mock-scenario': 'config-ok' } };

    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig });
    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { headers: { 'X-Mock-Scenario': 'config-ok' } } });

    // Header names are case-insensitive on the wire, so they must not key separately.
    expect(configRequests()).toHaveLength(1);
  });

  it('does not accumulate an entry per distinct header set', async () => {
    // Header-scoped keys are unbounded, so expired ones must not pile up.
    vi.useFakeTimers();
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));
    const cache = (sodax.sponsoring as unknown as { configCache: Map<string, unknown> }).configCache;

    for (const trace of ['a', 'b', 'c']) {
      await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { headers: { 'x-trace': trace } } });
    }
    expect(cache.size).toBe(3);

    vi.advanceTimersByTime(SPONSOR_CONFIG_TTL_MS + 1);
    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { headers: { 'x-trace': 'd' } } });

    expect(cache.size).toBe(1);
    vi.useRealTimers();
  });

  it('never caches a failure', async () => {
    const { sodax } = makeSodax();
    mockFetch
      .mockResolvedValueOnce(jsonErr(503, { statusCode: 503, message: 'down' }))
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));

    const first = await sodax.sponsoring.getStellarSponsorConfig();
    const second = await sodax.sponsoring.getStellarSponsorConfig();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(configRequests()).toHaveLength(2);
  });

  it('invalidates the cache after a 400 so the next call self-corrects on a rotated sponsor', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonErr(400, { statusCode: 400, error: 'INVALID_SPONSOR_XDR', message: 'bad source' }))
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'ok', alreadyActive: false }));

    const failed = await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });
    expect(failed.ok).toBe(false);

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });
    expect(configRequests()).toHaveLength(2);
  });
});

describe('per-request credentials on the wire', () => {
  it('sends requestConfig.apiKey as x-api-key on the config request, over the configured slice key', async () => {
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));

    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { apiKey: 'call-key' } });

    expect(configRequests()).toHaveLength(1);
    const [url, init] = configRequests()[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${SPONSORING_BASE_URL}/sponsorships/stellar/config`);
    expect(new Headers(init.headers).get('x-api-key')).toBe('call-key');
  });

  it('sends a raw X-Api-Key header as the ONLY key header on the config request', async () => {
    const { sodax } = makeSodax();
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG));

    // forceRefresh guards against a cache hit ever serving this call without a request.
    await sodax.sponsoring.getStellarSponsorConfig({
      forceRefresh: true,
      requestConfig: { headers: { 'X-Api-Key': 'raw-key' } },
    });

    expect(configRequests()).toHaveLength(1);
    const [url, init] = configRequests()[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${SPONSORING_BASE_URL}/sponsorships/stellar/config`);
    expect(Object.keys(init.headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(init.headers).get('x-api-key')).toBe('raw-key');
  });

  it('forwards requestConfig.apiKey to the account-creation POST', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
      requestConfig: { apiKey: 'call-key' },
    });

    expect(accountRequests()).toHaveLength(1);
    const [url, init] = accountRequests()[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${SPONSORING_BASE_URL}/sponsorships/stellar/accounts`);
    expect(new Headers(init.headers).get('x-api-key')).toBe('call-key');
  });

  it('forwards a raw X-Api-Key header as the ONLY key header to the account-creation POST', async () => {
    const { sodax, loadAccount } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
      requestConfig: { headers: { 'X-Api-Key': 'raw-key' } },
    });

    expect(accountRequests()).toHaveLength(1);
    const [url, init] = accountRequests()[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${SPONSORING_BASE_URL}/sponsorships/stellar/accounts`);
    expect(Object.keys(init.headers).filter(h => h.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(init.headers).get('x-api-key')).toBe('raw-key');
  });

  it('carries explicit per-request credentials to a custom origin the inherited instance key never reaches', async () => {
    // Instance key only — no slice key — while sponsoring points off the allowed roots.
    const { sodax } = makeSodax({ instanceApiKey: 'instance-key' });
    mockFetch.mockResolvedValue(jsonOk(SPONSOR_CONFIG));

    await sodax.sponsoring.getStellarSponsorConfig();
    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { apiKey: 'explicit-key' } });
    await sodax.sponsoring.getStellarSponsorConfig({ requestConfig: { headers: { 'X-Api-Key': 'explicit-raw-key' } } });

    // Distinct keys keep the three calls on separate cache entries, so each provably hit fetch.
    expect(configRequests()).toHaveLength(3);
    const sentKeys = configRequests().map(([url, init]) => {
      expect(url).toBe(`${SPONSORING_BASE_URL}/sponsorships/stellar/config`);
      return new Headers((init as { headers: Record<string, string> }).headers).get('x-api-key');
    });
    expect(sentKeys).toEqual([null, 'explicit-key', 'explicit-raw-key']);
  });
});

describe('isStellarAccountActive', () => {
  it('reports true for a funded account and false for a 404', async () => {
    const { sodax, loadAccount } = makeSodax();

    loadAccount.mockResolvedValueOnce(sponsorAccountResponse('1') as never);
    await expect(sodax.sponsoring.isStellarAccountActive({ address: USER.publicKey() })).resolves.toEqual({
      ok: true,
      value: true,
    });

    loadAccount.mockRejectedValueOnce(horizonNotFound());
    await expect(sodax.sponsoring.isStellarAccountActive({ address: USER.publicKey() })).resolves.toEqual({
      ok: true,
      value: false,
    });
  });

  it('surfaces a transport failure as an error rather than reporting "not active"', async () => {
    // A transport failure must not masquerade as a missing account.
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockRejectedValueOnce(horizonDown());

    const result = await sodax.sponsoring.isStellarAccountActive({ address: USER.publicKey() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LOOKUP_FAILED');
  });
});

describe('getStellarAccountStatus', () => {
  it('reports a missing account as absent rather than as a failure', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockRejectedValueOnce(horizonNotFound());

    await expect(sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() })).resolves.toEqual({
      ok: true,
      value: {
        exists: false,
        nativeBalanceStroops: 0n,
        availableBalanceStroops: 0n,
        canAffordTrustline: false,
        trustlineMinXlmStroops: 5_100_000n,
      },
    });
  });

  it('reports a freshly activated 0-XLM account as existing but unable to afford a trustline', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('0') as never);

    await expect(sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() })).resolves.toEqual({
      ok: true,
      value: {
        exists: true,
        nativeBalanceStroops: 0n,
        availableBalanceStroops: 0n,
        canAffordTrustline: false,
        trustlineMinXlmStroops: 5_100_000n,
      },
    });
  });

  it.each([
    ['just below the threshold', '0.5099999', false],
    ['exactly at the threshold', '0.51', true],
    ['comfortably above', '10', true],
  ])('parses %s exactly and gates canAffordTrustline on it', async (_label, xlm, affordable) => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse(xlm as string) as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.canAffordTrustline).toBe(affordable);
  });

  it('parses a large balance without floating-point loss', async () => {
    // Number.parseFloat would lose the trailing stroop.
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValueOnce(sponsorAccountResponse('1', '922337203685.4775807') as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nativeBalanceStroops).toBe(9223372036854775807n);
  });

  it('subtracts the reserve already locked by existing trustlines (available, not total)', async () => {
    // Affordability uses spendable balance after existing subentry reserves.
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('0.6', 1) as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nativeBalanceStroops).toBe(6_000_000n);
      expect(result.value.availableBalanceStroops).toBe(1_000_000n);
      expect(result.value.canAffordTrustline).toBe(false);
    }
  });

  it('allows another trustline once the balance covers the already-locked reserve too', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('1.2', 1) as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.availableBalanceStroops).toBe(7_000_000n);
      expect(result.value.canAffordTrustline).toBe(true);
    }
  });

  it('subtracts selling liabilities from the spendable balance', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockResolvedValueOnce({
      sequenceNumber: () => '1',
      balances: [{ asset_type: 'native', balance: '1.0', selling_liabilities: '0.9' }],
      num_sponsored: 2,
      subentry_count: 0,
    } as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.availableBalanceStroops).toBe(1_000_000n);
      expect(result.value.canAffordTrustline).toBe(false);
    }
  });

  it('follows the network base reserve rather than assuming 0.5 XLM', async () => {
    // A validator vote can move the base reserve; 1 XLM locks 3 XLM across the account's 3 units.
    const { sodax, loadAccount, ledgers } = makeSodax();
    stubBaseReserve(ledgers, 10_000_000);
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('3.5', 1) as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trustlineMinXlmStroops).toBe(10_100_000n);
      expect(result.value.availableBalanceStroops).toBe(25_000_000n);
      // The hardcoded 0.5 XLM reserve would have reported 0.6 XLM as enough.
      expect(result.value.canAffordTrustline).toBe(true);
    }
  });

  it('reads the base reserve once and reuses it across calls', async () => {
    const { sodax, loadAccount, ledgers } = makeSodax();
    loadAccount.mockResolvedValue(sponsoredAccountResponse('1') as never);

    await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });
    await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(ledgers).toHaveBeenCalledTimes(1);
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });

  it('degrades to the published base reserve when the ledger read fails', async () => {
    // A UI hint must not become an error just because one Horizon endpoint is down.
    const { sodax, loadAccount, ledgers } = makeSodax();
    ledgers.mockImplementation(() => {
      throw horizonDown();
    });
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('0.61') as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trustlineMinXlmStroops).toBe(5_100_000n);
      expect(result.value.canAffordTrustline).toBe(true);
    }
  });

  it('ignores a nonsensical base reserve instead of computing reserves from it', async () => {
    const { sodax, loadAccount, ledgers } = makeSodax();
    stubBaseReserve(ledgers, undefined);
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('0') as never);

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trustlineMinXlmStroops).toBe(5_100_000n);
  });

  it('does not read the base reserve for an existence check', async () => {
    // isStellarAccountActive and the activation pre-flight need no reserve accounting.
    const { sodax, loadAccount, ledgers } = makeSodax();
    loadAccount.mockResolvedValueOnce(sponsoredAccountResponse('0') as never);

    await sodax.sponsoring.isStellarAccountActive({ address: USER.publicKey() });

    expect(ledgers).not.toHaveBeenCalled();
  });

  it('RETURNS a validation failure for an empty address instead of throwing', async () => {
    const { sodax } = makeSodax();

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    await expect(sodax.sponsoring.isStellarAccountActive({ address: '' })).resolves.toMatchObject({ ok: false });
  });

  it('surfaces a transport failure as an error', async () => {
    const { sodax, loadAccount } = makeSodax();
    loadAccount.mockRejectedValueOnce(horizonDown());

    const result = await sodax.sponsoring.getStellarAccountStatus({ address: USER.publicKey() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LOOKUP_FAILED');
      // Report the public caller, not the shared private reader.
      expect(result.error.context?.method).toBe('getStellarAccountStatus');
    }
  });
});

describe('activation analytics', () => {
  const conflictBody = () => jsonErr(409, { statusCode: 409, error: 'SPONSOR_SEQUENCE_CONFLICT', message: 'conflict' });

  it('carries the sequence conflict into a failure caused by something else', async () => {
    // Preserve a retried 409 in analytics when the final failure has another cause.
    const { sodax, loadAccount, failureData } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(conflictBody())
      .mockResolvedValueOnce(
        jsonErr(503, { statusCode: 503, error: 'SPONSOR_BUDGET_EXHAUSTED', message: 'below floor' }),
      );

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    expect(failureData()).toEqual({
      code: 'EXTERNAL_API_ERROR',
      attempts: 2,
      httpStatus: 503,
      nextAction: 'contactOperator',
    });
  });

  it('distinguishes a suppressed sequence retry from a burned one', async () => {
    const suppressed = makeSodax();
    stubHorizon(suppressed.loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG)).mockResolvedValueOnce(conflictBody());
    await suppressed.sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
      allowSequenceRetry: false,
    });

    mockFetch.mockReset();
    const burned = makeSodax();
    stubHorizon(burned.loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(conflictBody())
      .mockResolvedValueOnce(conflictBody());
    await burned.sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
    });

    expect(suppressed.failureData()).toMatchObject({ attempts: 1, httpStatus: 409 });
    expect(burned.failureData()).toMatchObject({ attempts: 2, httpStatus: 409 });
    expect(suppressed.failureData()).not.toEqual(burned.failureData());
  });

  it('attributes a cancelled second prompt to the second attempt', async () => {
    const { sodax, loadAccount, failureData } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG)).mockResolvedValueOnce(conflictBody());

    await sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet({ rejectOnCall: 2 }),
    });

    expect(failureData()).toMatchObject({ code: 'USER_REJECTED', attempts: 2 });
  });

  it('reports attempts 0 when the flow never reached an attempt', async () => {
    const { sodax, failureData } = makeSodax();
    mockFetch.mockResolvedValueOnce(jsonErr(503, { statusCode: 503, message: 'config down' }));

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    expect(failureData()).toMatchObject({ attempts: 0 });
  });

  it('keeps success reporting the attempts the caller actually got', async () => {
    const { sodax, loadAccount, successData } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    expect(successData()).toEqual({ status: 'submitted', attempts: 1, hash: 'abc123' });
  });

  it('never emits a property that is a string on success and a number on failure', async () => {
    // Keep domain status and HTTP status type-stable for analytics sinks.
    const { sodax, loadAccount, successData } = makeSodax();
    stubHorizon(loadAccount);
    mockFetch
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));
    await sodax.sponsoring.activateStellarAccount({ address: USER.publicKey(), walletProvider: makeWallet() });

    mockFetch.mockReset();
    const failed = makeSodax();
    stubHorizon(failed.loadAccount);
    mockFetch.mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG)).mockResolvedValueOnce(conflictBody());
    await failed.sodax.sponsoring.activateStellarAccount({
      address: USER.publicKey(),
      walletProvider: makeWallet(),
      allowSequenceRetry: false,
    });

    expect(typeof successData()?.status).toBe('string');
    expect(failed.failureData()).not.toHaveProperty('status');
    expect(typeof failed.failureData()?.httpStatus).toBe('number');
  });
});
