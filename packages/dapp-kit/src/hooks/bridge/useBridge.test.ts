/**
 * `useBridge` wire test for the per-action API key: `extras.apiKey` in the mutation vars must reach
 * the backend submit-tx leg as `x-api-key` — on the POST and on the status poll — beating the
 * instance-level key.
 *
 * Follows the package convention of testing hooks without a renderer (captured `mutationFn`), with
 * the SDK stubbed at the same seams its own backend submit-tx tests use: `createBridgeIntent` is
 * spied on a real keyed `Sodax` so no wallet or chain is touched, while `POST /bridge/submit-tx`
 * and `GET /bridge/submit-tx/status` run call-through to a stubbed global fetch serving the
 * schema-valid fixtures from packages/sdk/src/bridge/BridgeService.test.ts.
 */

import { ChainKeys, Sodax } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { useBridge } = await import('./useBridge.js');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const jsonOk = (data: unknown): Response =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

const BRIDGE_PARAMS = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcToken: '0x4444444444444444444444444444444444444444',
  dstToken: '0x5555555555555555555555555555555555555555',
  amount: 1_000_000n,
  srcAddress: '0x1111111111111111111111111111111111111111',
  recipient: '0x2222222222222222222222222222222222222222',
};

const SUBMIT_ACCEPTED = { success: true, data: { status: 'inserted', message: 'accepted' } };
const STATUS_EXECUTED = {
  success: true,
  data: {
    txHash: '0xspokeTx',
    srcChainKey: ChainKeys.BSC_MAINNET,
    status: 'executed',
    processingAttempts: 1,
    result: { dstIntentTxHash: '0xDST' },
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe('useBridge — extras.apiKey on the backend submit-tx wire', () => {
  it('lands the per-action key on the submit-tx POST and the status poll, beating the instance key', async () => {
    vi.spyOn(sodax.bridge, 'createBridgeIntent').mockResolvedValueOnce({
      ok: true,
      value: {
        tx: '0xspokeTx',
        relayData: { address: '0x1111111111111111111111111111111111111111', payload: '0xpay' },
      },
    } as never);
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/v1/bridge/submit-tx/status' && init?.method === 'GET') return jsonOk(STATUS_EXECUTED);
      if (pathname === '/v1/bridge/submit-tx' && init?.method === 'POST') return jsonOk(SUBMIT_ACCEPTED);
      throw new Error(`unexpected fetch: ${String(url)}`);
    });

    useBridge();
    const result = await captured.mutationFn({
      params: BRIDGE_PARAMS,
      extras: { apiKey: 'action-key' },
      walletProvider: {},
    });

    // Completed on the backend path: TxHashPair from the executed status, no relay fallback fetches.
    expect(result).toEqual({ srcChainTxHash: '0xspokeTx', dstChainTxHash: '0xDST' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const submit = fetchMock.mock.calls.find(
      ([url, init]) => new URL(String(url)).pathname === '/v1/bridge/submit-tx' && init?.method === 'POST',
    );
    const poll = fetchMock.mock.calls.find(
      ([url, init]) => new URL(String(url)).pathname === '/v1/bridge/submit-tx/status' && init?.method === 'GET',
    );
    expect(submit).toBeDefined();
    expect(poll).toBeDefined();
    expect(new Headers(submit?.[1]?.headers).get('x-api-key')).toBe('action-key');
    expect(new Headers(poll?.[1]?.headers).get('x-api-key')).toBe('action-key');
  });
});
