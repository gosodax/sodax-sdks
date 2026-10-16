/**
 * `useActivateStellarAccount` wire test for the per-request API key: `requestConfig.apiKey` in the
 * mutation vars must reach the sponsoring `/accounts` POST as `x-api-key`, beating the
 * instance-level key.
 *
 * Follows the package convention of testing hooks without a renderer (captured `mutationFn`),
 * driving a real keyed `Sodax` end to end the way packages/sdk/src/sponsoring/SponsoringService.test.ts
 * does: Horizon is stubbed on the instance, the wallet signs with a real throwaway keypair, and the
 * config GET + account POST run call-through to a stubbed global fetch.
 *
 * `@stellar/stellar-sdk` is not a dapp-kit dependency, so it is loaded through `@sodax/sdk`'s own
 * module graph — the same copy the SDK builds and verifies the transaction with.
 */

import { createRequire } from 'node:module';
import { Sodax } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkRequire = createRequire(createRequire(import.meta.url).resolve('@sodax/sdk/package.json'));
const { Keypair, Networks, TransactionBuilder } = sdkRequire('@stellar/stellar-sdk');

// biome-ignore lint/suspicious/noExplicitAny: the captured mutation options are driven directly.
let captured: any;

const sodax = new Sodax({ apiKey: 'instance-key', logger: 'silent' });

vi.mock('../shared/useSodaxContext.js', () => ({ useSodaxContext: () => ({ sodax }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the real wrapper's opaque options bag.
  useSafeMutation: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useActivateStellarAccount } = await import('./useActivateStellarAccount.js');

const SPONSOR = Keypair.random();
const USER = Keypair.random();

const SPONSOR_CONFIG = {
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

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const jsonOk = (data: unknown): Response =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

// The account being created signs; the wallet parses and re-emits the SDK-built envelope as XDR.
const wallet = {
  chainType: 'STELLAR',
  getWalletAddress: vi.fn(async () => USER.publicKey()),
  waitForTransactionReceipt: vi.fn(),
  signTransaction: vi.fn(async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    tx.sign(USER);
    return tx.toXDR();
  }),
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useActivateStellarAccount — requestConfig.apiKey on the sponsoring wire', () => {
  it('lands the per-request key on the /accounts POST, beating the instance key', async () => {
    // Horizon uses its own HTTP client, so stub it on the instance rather than through fetch.
    vi.spyOn(sodax.spoke.stellar.server, 'loadAccount').mockImplementation(async (address: string) => {
      if (address === SPONSOR.publicKey()) return { sequenceNumber: () => '100' } as never;
      throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    });
    fetchMock
      .mockResolvedValueOnce(jsonOk(SPONSOR_CONFIG))
      .mockResolvedValueOnce(jsonOk({ hash: 'abc123', alreadyActive: false }));

    useActivateStellarAccount();
    const result = await captured.mutationFn({
      address: USER.publicKey(),
      walletProvider: wallet,
      requestConfig: { apiKey: 'hook-key' },
    });

    expect(result).toEqual({ status: 'submitted', hash: 'abc123', attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/sponsorships/stellar/accounts'));
    expect(post).toBeDefined();
    expect(post?.[1]?.method).toBe('POST');
    const headers = post?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).filter(name => name.toLowerCase() === 'x-api-key')).toHaveLength(1);
    expect(new Headers(headers).get('x-api-key')).toBe('hook-key');

    // The same requestConfig rides the preceding sponsor-config GET.
    const configGet = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/sponsorships/stellar/config'));
    expect(new Headers(configGet?.[1]?.headers).get('x-api-key')).toBe('hook-key');
  });
});
